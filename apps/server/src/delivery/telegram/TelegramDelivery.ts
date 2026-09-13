// Dev B. DeliveryConnector for Telegram (PLAN.md §10, §15). Formatting helpers are pure and exported for tests.
import { readFile } from "node:fs/promises";
import type { DeliveryConnector, DeliveryPlan, MessageInterpretation, ReelArtifact, ReplyDraft } from "@reelrelay/shared";
import { Input, type Telegraf } from "telegraf";
import type { InlineKeyboardMarkup } from "telegraf/types";
import { config } from "../../config.js";
import { getDb } from "../../db/client.js";
import { getArtifact } from "../../db/queries/artifacts.js";
import { getTelegramChatIdForUser, upsertTelegramConnection } from "../../db/queries/connections.js";
import { consumePairingCode, upsertSession } from "../../db/queries/telegram.js";
import { draftKeyboard, reelKeyboard, retrySendKeyboard } from "./keyboards.js";
import type { StoredMessage } from "./store.js";

/** Telegram limits. */
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_TEXT_LIMIT = 4096;
/** We split long cards at this length to leave headroom for HTML entities. */
export const TELEGRAM_TEXT_SOFT_LIMIT = 4000;
/** Hosted Bot API upload cap (PLAN.md §10, unverified) — above this we send a signed link instead. */
export const TELEGRAM_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
/** Backoff for withRetry (sendDraft / bot replies). sendReel is single-attempt: Dev A's worker retries it 4× with these delays. */
export const TELEGRAM_RETRY_DELAYS_MS: readonly number[] = [1000, 3000, 9000];
/** Lifetime of the signed link sent instead of a video that exceeds the upload cap. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export const AI_TRANSLATION_LABEL = "AI-assisted translation";
export const AI_DRAFT_LABEL = "AI-assisted draft — review before sending";
export const MOCK_LABEL = "⚠️ demo-injected";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sourceLabel(source: ReelArtifact["source"]): string {
  return source === "mock" ? "Slack (demo)" : "Slack";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function formatTime(iso: string, timeZone = "America/Toronto"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Pivot 03: one line that explains the triage decision (`⚡ / ⏰ / ☀️ <reasonText>`), or "" when there is no plan. */
export function formatPlanLine(plan: DeliveryPlan | undefined, followUp = false): string {
  if (!plan) return "";
  if (plan.mode === "instant") return followUp ? "🎬 Full reel for the card above" : `⚡ ${escapeHtml(plan.reasonText)}`;
  const icon = plan.mode === "digest" ? "☀️" : plan.deliverAfter ? "⏰" : "";
  return icon ? `${icon} ${escapeHtml(plan.reasonText)}` : "";
}

/** `🎬 <sender> · Slack · <urgency>\n<shortTitle>\n[plan line]\nAI-assisted translation` + `\n⚠️ demo-injected` when isMock. */
export function formatReelCaption(artifact: ReelArtifact): string {
  const planLine = formatPlanLine(artifact.plan, Boolean(artifact.replyToMessageId));
  const caption =
    `🎬 ${escapeHtml(artifact.senderDisplayName)} · ${sourceLabel(artifact.source)} · ${artifact.interpretation.urgency}` +
    `\n${escapeHtml(artifact.interpretation.shortTitle)}` +
    (planLine ? `\n${planLine}` : "") +
    `\n${AI_TRANSLATION_LABEL}` +
    (artifact.isMock ? `\n${MOCK_LABEL}` : "");
  return truncate(caption, TELEGRAM_CAPTION_LIMIT);
}

/**
 * Pivot 03: the instant card (HTML). Sent BEFORE voicing/rendering for high urgency, near deadlines and sensitive messages
 * from authority figures: header, why it was sent now, the action list, then a note that the reel follows.
 */
export function formatInstantCard(artifact: ReelArtifact, plan: DeliveryPlan): string {
  const interp = artifact.interpretation;
  const parts = [
    `⚡ <b>${escapeHtml(artifact.senderDisplayName)}</b> · ${sourceLabel(artifact.source)} · ${interp.urgency}\n<b>${escapeHtml(interp.shortTitle)}</b>`,
    `<i>${escapeHtml(plan.reasonText)}</i>`,
    escapeHtml(interp.hook),
    `✅ <b>Actions</b>\n${formatActions(interp)}`,
    ["🎬 Full reel is on its way", `<i>${AI_TRANSLATION_LABEL}</i>`, artifact.isMock ? MOCK_LABEL : ""].filter((p) => p.length > 0).join("\n"),
  ];
  return parts.join("\n\n");
}

/** `1. <text> — 📅 <dueText> — "<evidenceQuote>"`, negations prefixed 🚫, then `⚠️ Unclear:` ambiguities. HTML-escaped. */
export function formatActions(interp: MessageInterpretation): string {
  const lines: string[] = [];
  if (interp.actionItems.length === 0) {
    lines.push("No action items.");
  } else {
    interp.actionItems.forEach((item, i) => {
      const due = item.dueText ? ` — 📅 ${escapeHtml(item.dueText)}` : "";
      const neg = item.isNegation ? "🚫 " : "";
      lines.push(`${i + 1}. ${neg}${escapeHtml(item.text)}${due} — "${escapeHtml(item.evidenceQuote)}"`);
    });
  }
  if (interp.ambiguities.length > 0) {
    lines.push("");
    lines.push("⚠️ Unclear:");
    for (const a of interp.ambiguities) lines.push(escapeHtml(a));
  }
  return lines.join("\n");
}

/**
 * True when the interpretation itself is unavailable (LLM failure / no analysis): the card must show the verbatim original and
 * never call it a translation (Dev A handoff). Other errors (RENDER, NARRATION_TOO_LONG, …) keep the full text card — hook,
 * narration, every action — behind a warning line (PLAN.md §15: Remotion error → "text card with hook, narration, all actions").
 */
export function isTranslationFailure(artifact: ReelArtifact): boolean {
  const code = artifact.error?.code ?? "";
  return Boolean(artifact.error) && (code.startsWith("LLM_") || artifact.interpretation.sourceLanguage === "und");
}

/** First lines of the failure card: `⚠️ <error.message>` then the sender header (no urgency — the interpretation may be a placeholder). */
function errorLead(artifact: ReelArtifact, error: NonNullable<ReelArtifact["error"]>): string {
  return `⚠️ ${escapeHtml(error.message)}\n\n🎬 <b>${escapeHtml(artifact.senderDisplayName)}</b> · ${sourceLabel(artifact.source)}`;
}

/**
 * Header + hook + narration (part 1) and the action list (part 2) of the text card, so a long card can be split.
 * When `artifact.error` is set (translation or rendering failed) the card leads with `⚠️ <error.message>`, shows the
 * ORIGINAL text verbatim and carries no translation label; `actions` is then empty.
 */
export function formatTextCardParts(artifact: ReelArtifact): { summary: string; actions: string } {
  const interp = artifact.interpretation;
  const mockLine = artifact.isMock ? MOCK_LABEL : "";

  if (artifact.error && isTranslationFailure(artifact)) {
    const parts = [errorLead(artifact, artifact.error), `<pre>${escapeHtml(artifact.originalText)}</pre>`, mockLine];
    return { summary: parts.filter((p) => p.length > 0).join("\n\n"), actions: "" };
  }

  const header = `🎬 <b>${escapeHtml(artifact.senderDisplayName)}</b> · ${sourceLabel(artifact.source)} · ${interp.urgency}`;
  const planLine = formatPlanLine(artifact.plan, Boolean(artifact.replyToMessageId));
  const footer = [planLine, `<i>${AI_TRANSLATION_LABEL}</i>`, mockLine].filter((p) => p.length > 0).join("\n");
  // A non-translation failure (video render, narration length, …) still gets the complete card, led by the notice.
  const notice = artifact.error ? `⚠️ ${escapeHtml(artifact.error.message)}\n\n` : "";
  const summary = [
    `${notice}${header}\n<b>${escapeHtml(interp.shortTitle)}</b>`,
    escapeHtml(interp.hook),
    escapeHtml(interp.spokenSegments.join(" ")),
  ].join("\n\n");
  const actions = [`✅ <b>Actions</b>\n${formatActions(interp)}`, footer].join("\n\n");
  return { summary, actions };
}

/** text_only fallback card (HTML): hook, narration (spokenSegments joined), full action list, AI-assisted label, MOCK marker. */
export function formatTextCard(artifact: ReelArtifact): string {
  const { summary, actions } = formatTextCardParts(artifact);
  return actions ? `${summary}\n\n${actions}` : summary;
}

/** Verbatim original in <pre>, sender + time. HTML-escaped. */
export function formatOriginal(message: StoredMessage, timeZone?: string): string {
  const header = `📄 <b>${escapeHtml(message.senderDisplayName)}</b> · ${escapeHtml(formatTime(message.receivedAt, timeZone))}`;
  return `${header}\n<pre>${escapeHtml(message.originalText)}</pre>`;
}

function statusLine(draft: ReplyDraft): string | null {
  switch (draft.status) {
    case "failed":
      return `❌ Couldn't send${draft.errorDetail ? ` (${escapeHtml(draft.errorDetail)})` : ""}`;
    case "send_uncertain":
      return "⏳ Checking… the reply may have gone through";
    case "sent":
      return "Sent ✅";
    case "cancelled":
      return "Cancelled ❌";
    case "approved":
      return "📤 Sending…";
    default:
      return null;
  }
}

/** `你写的: …` / `English draft: …` / `意思核对: …` + warnings + label `AI-assisted draft — review before sending`. */
export function formatDraft(draft: ReplyDraft): string {
  const lines: string[] = [];
  lines.push(`你写的: ${escapeHtml(draft.userInputOriginal)}`);
  lines.push("");
  lines.push(`English draft: ${escapeHtml(draft.draftEnglish)}`);
  if (draft.meaningCheck) {
    lines.push("");
    lines.push(`意思核对: ${escapeHtml(draft.meaningCheck)}`);
  }
  const warnings = (draft.warnings ?? []).filter((w) => w.trim().length > 0);
  if (warnings.length > 0) {
    lines.push("");
    for (const w of warnings) lines.push(`⚠️ ${escapeHtml(w)}`);
  }
  const status = statusLine(draft);
  if (status) {
    lines.push("");
    lines.push(status);
  }
  lines.push("");
  lines.push(`<i>${AI_DRAFT_LABEL}</i>`);
  return lines.join("\n");
}

/** Splits HTML-free-ish text into ≤ limit chunks on line boundaries (falls back to hard cuts). */
export function splitLines(text: string, limit = TELEGRAM_TEXT_SOFT_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > limit) {
      if (current) chunks.push(current);
      current = "";
      for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TelegramErrorLike {
  response?: { error_code?: number; parameters?: { retry_after?: number } };
  code?: number;
}

/** 4xx from Telegram (other than 429) will not succeed on retry: bad chat id, blocked bot, malformed markup. */
function isPermanentTelegramError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as TelegramErrorLike;
  const code = e.response?.error_code ?? e.code;
  return typeof code === "number" && code >= 400 && code < 500 && code !== 429;
}

function retryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const secs = (err as TelegramErrorLike).response?.parameters?.retry_after;
  return typeof secs === "number" && secs > 0 ? Math.min(secs, 30) * 1000 : null;
}

/**
 * Runs fn; on failure waits delays[i] and retries, once per delay (PLAN.md §15: 1 s, 3 s, 9 s). Rethrows the last error.
 * Used by sendDraft and the bot; NOT by sendReel, which Dev A's worker already retries.
 */
export async function withRetry<T>(fn: () => Promise<T>, delays: readonly number[] = TELEGRAM_RETRY_DELAYS_MS): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === delays.length || isPermanentTelegramError(err)) break;
      const wait = retryAfterMs(err) ?? delays[attempt] ?? 1000;
      console.warn(`[telegram] call failed (attempt ${attempt + 1}/${delays.length + 1}), retrying in ${wait} ms: ${errorText(err)}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shared by the /start handler and pair(): consume the code, then link chat ↔ user. */
export async function pairChat(chatId: string, pairingCode: string): Promise<{ userId: string } | null> {
  const consumed = await consumePairingCode(pairingCode);
  if (!consumed) return null;
  await upsertTelegramConnection({ userId: consumed.userId, chatId: String(chatId) });
  await upsertSession(String(chatId), consumed.userId);
  return consumed;
}

interface LoadedVideo {
  bytes: Buffer;
  /** Set when the bytes came from storage (so a signed link can be made without another lookup). */
  storageKey: string | null;
}

export class TelegramDelivery implements DeliveryConnector {
  private readonly bot: Telegraf;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  /**
   * Validates + consumes the code and upserts connection + session (same path as the /start handler).
   * `target` is the Telegram chat id; when it is a userId (uuid) the chat id must be passed as the third argument.
   */
  async pair(target: string, pairingCode: string, chatId?: string): Promise<void> {
    const resolvedChat = chatId ?? (UUID_RE.test(target) ? null : target);
    if (!resolvedChat) throw new Error("no_telegram_chat_id");
    const paired = await pairChat(resolvedChat, pairingCode);
    if (!paired) throw new Error("invalid_or_expired_code");
    if (UUID_RE.test(target) && paired.userId !== target) {
      // The code belonged to somebody else: undo nothing (the code is consumed) but refuse to report success.
      throw new Error("code_user_mismatch");
    }
  }

  /**
   * deliveryTargetId = telegram chat id (if it looks like a uuid it is treated as a userId and resolved via getTelegramChatIdForUser).
   * remotion/captions_only → sendVideo(bytes of the LOCAL artifact.videoPath; storage copy when the file is gone) with caption +
   * reelKeyboard; > 50 MB → sendMessage with a 1-hour signed link. text_only or `artifact.error` → sendMessage(formatTextCard)
   * with reelKeyboard. Single attempt: Dev A's worker retries sendReel 4× (1 s, 3 s, 9 s) and persists the delivery id.
   * Returns String(message_id).
   */
  async sendReel(deliveryTargetId: string, artifact: ReelArtifact): Promise<string> {
    const chatId = await this.resolveChatId(deliveryTargetId);
    const keyboard = reelKeyboard(artifact.messageId);
    // Pivot 03: a reel that follows an instant card threads under it (best effort: Telegram rejects a deleted target).
    const threading = this.replyParameters(artifact);
    const wantsVideo = artifact.renderMode !== "text_only" && !artifact.error;
    if (!wantsVideo) return this.sendTextCard(chatId, artifact, keyboard, threading);

    const video = await this.loadVideo(artifact);
    if (!video) {
      console.warn(`[telegram] video for message ${artifact.messageId} unavailable; sending the text card instead`);
      return this.sendTextCard(chatId, artifact, keyboard);
    }
    const caption = formatReelCaption(artifact);

    if (video.bytes.length > TELEGRAM_UPLOAD_LIMIT_BYTES) {
      const storageKey = video.storageKey ?? (await this.storageKeyFor(artifact.messageId));
      const url = storageKey ? await this.signedUrl(storageKey) : null;
      if (!url) {
        console.warn(`[telegram] video for message ${artifact.messageId} is ${video.bytes.length} bytes and cannot be linked; sending the text card`);
        return this.sendTextCard(chatId, artifact, keyboard);
      }
      const text = `${caption}\n\n<a href="${escapeHtml(url)}">▶️ Watch the reel</a> (link valid for 1 hour)`;
      const sent = await this.bot.telegram.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard, ...threading });
      return String(sent.message_id);
    }

    const sent = await this.bot.telegram.sendVideo(chatId, Input.fromBuffer(video.bytes, `${artifact.messageId}.mp4`), {
      caption,
      parse_mode: "HTML",
      reply_markup: keyboard,
      supports_streaming: true,
      ...threading,
    });
    return String(sent.message_id);
  }

  /**
   * Pivot 03: the instant card. One HTML message with the reel keyboard, so 📄 / ✅ / ✍️ / 👍 work before the reel exists.
   * Sent with a notification (everything else stays quiet); the reel arrives later as a reply to this message.
   */
  async sendInstantCard(deliveryTargetId: string, artifact: ReelArtifact, plan: DeliveryPlan): Promise<string> {
    const chatId = await this.resolveChatId(deliveryTargetId);
    const keyboard = reelKeyboard(artifact.messageId);
    const text = formatInstantCard(artifact, plan);
    const sent = await withRetry(() => this.bot.telegram.sendMessage(chatId, truncate(text, TELEGRAM_TEXT_LIMIT), { parse_mode: "HTML", reply_markup: keyboard }));
    return String(sent.message_id);
  }

  /** Pivot 03: plain line (digest header). Silent notification. */
  async sendText(deliveryTargetId: string, text: string): Promise<string> {
    const chatId = await this.resolveChatId(deliveryTargetId);
    const sent = await withRetry(() => this.bot.telegram.sendMessage(chatId, truncate(text, TELEGRAM_TEXT_LIMIT), { disable_notification: true }));
    return String(sent.message_id);
  }

  private replyParameters(artifact: ReelArtifact): { reply_parameters?: { message_id: number; allow_sending_without_reply: true } } {
    const id = Number(artifact.replyToMessageId);
    return Number.isInteger(id) && id > 0 ? { reply_parameters: { message_id: id, allow_sending_without_reply: true } } : {};
  }

  /** sendMessage(formatDraft) with draftKeyboard (or retrySendKeyboard for failed/send_uncertain). Returns String(message_id). */
  async sendDraft(deliveryTargetId: string, draft: ReplyDraft): Promise<string> {
    const chatId = await this.resolveChatId(deliveryTargetId);
    const text = formatDraft(draft);
    let reply_markup: InlineKeyboardMarkup | undefined;
    if (draft.status === "draft") reply_markup = draftKeyboard(draft.id);
    else if (draft.status === "failed" || draft.status === "send_uncertain") reply_markup = retrySendKeyboard(draft.id);
    const sent = await withRetry(() =>
      this.bot.telegram.sendMessage(chatId, truncate(text, TELEGRAM_TEXT_LIMIT), { parse_mode: "HTML", reply_markup }),
    );
    return String(sent.message_id);
  }

  /** A uuid-looking target is a userId → connections.external_account_id; anything else is already a chat id. */
  async resolveChatId(target: string): Promise<string> {
    const t = String(target ?? "").trim();
    if (!t) throw new Error("no_telegram_target");
    if (!UUID_RE.test(t)) return t;
    const chatId = await getTelegramChatIdForUser(t);
    if (!chatId) throw new Error("no_telegram_target");
    return chatId;
  }

  private async sendTextCard(chatId: string, artifact: ReelArtifact, keyboard: InlineKeyboardMarkup, threading: ReturnType<TelegramDelivery["replyParameters"]> = {}): Promise<string> {
    const html = { parse_mode: "HTML" as const };
    const { summary, actions } = formatTextCardParts(artifact);
    const full = actions ? `${summary}\n\n${actions}` : summary;

    if (full.length <= TELEGRAM_TEXT_SOFT_LIMIT) {
      const sent = await this.bot.telegram.sendMessage(chatId, full, { ...html, reply_markup: keyboard, ...threading });
      return String(sent.message_id);
    }

    let lastId = "";
    if (artifact.error && isTranslationFailure(artifact)) {
      // Very long original: warning + header as HTML, then the byte-exact original in plain chunks (no parse mode, so a
      // <pre> block can never be cut in half); the keyboard rides on the last message.
      await this.bot.telegram.sendMessage(chatId, errorLead(artifact, artifact.error), html);
      const chunks = splitLines(artifact.originalText);
      for (const [i, chunk] of chunks.entries()) {
        const isLast = i === chunks.length - 1 && !artifact.isMock;
        const sent = await this.bot.telegram.sendMessage(chatId, chunk, isLast ? { reply_markup: keyboard } : {});
        lastId = String(sent.message_id);
      }
      if (artifact.isMock) {
        const sent = await this.bot.telegram.sendMessage(chatId, MOCK_LABEL, { reply_markup: keyboard });
        lastId = String(sent.message_id);
      }
      return lastId;
    }

    // Too long for one message: hook + narration first, then the action list (which carries the keyboard).
    for (const chunk of splitLines(summary)) {
      await this.bot.telegram.sendMessage(chatId, chunk, html);
    }
    const actionChunks = splitLines(actions || `<i>${AI_TRANSLATION_LABEL}</i>`);
    for (const [i, chunk] of actionChunks.entries()) {
      const isLast = i === actionChunks.length - 1;
      const sent = await this.bot.telegram.sendMessage(chatId, chunk, isLast ? { ...html, reply_markup: keyboard } : html);
      lastId = String(sent.message_id);
    }
    return lastId;
  }

  /** The worker hands over a LOCAL mp4; when it is gone (restart, cleaned build dir) fall back to the storage copy. */
  private async loadVideo(artifact: ReelArtifact): Promise<LoadedVideo | null> {
    if (artifact.videoPath) {
      try {
        return { bytes: await readFile(artifact.videoPath), storageKey: null };
      } catch (err) {
        console.warn(`[telegram] could not read ${artifact.videoPath}: ${errorText(err)}; falling back to storage`);
      }
    }
    const storageKey = await this.storageKeyFor(artifact.messageId);
    if (!storageKey) return null;
    try {
      const { data, error } = await getDb().storage.from(config.SUPABASE_STORAGE_BUCKET).download(storageKey);
      if (error || !data) throw new Error(error?.message ?? "no data");
      return { bytes: Buffer.from(await data.arrayBuffer()), storageKey };
    } catch (err) {
      console.warn(`[telegram] storage download of ${storageKey} failed: ${errorText(err)}`);
      return null;
    }
  }

  /** reel_artifacts.video_path (a STORAGE key, unlike artifact.videoPath) for the message, or null. */
  private async storageKeyFor(messageId: string): Promise<string | null> {
    try {
      return (await getArtifact(messageId))?.video_path ?? null;
    } catch (err) {
      console.warn(`[telegram] artifact lookup for ${messageId} failed: ${errorText(err)}`);
      return null;
    }
  }

  private async signedUrl(storageKey: string): Promise<string | null> {
    try {
      const { data, error } = await getDb().storage.from(config.SUPABASE_STORAGE_BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
      if (error || !data?.signedUrl) throw new Error(error?.message ?? "no url");
      return data.signedUrl;
    } catch (err) {
      console.warn(`[telegram] signed url for ${storageKey} failed: ${errorText(err)}`);
      return null;
    }
  }
}
