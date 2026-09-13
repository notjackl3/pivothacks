// Dev B. Telegraf long-polling bot: /start <code> pairing, /help, callback buttons, text → reply flow (PLAN.md §10).
import { Telegraf, type Context } from "telegraf";
import { callbackQuery, message } from "telegraf/filters";
import type { ReplyDraft } from "@reelrelay/shared";
import { config } from "../../config.js";
import { getSession } from "../../db/queries/telegram.js";
import { getDelivery } from "../index.js";
import { retrySendKeyboard } from "./keyboards.js";
import { getReplyFlow, type ApproveOutcome } from "./reply.js";
import { resolveOwnedTarget, type OwnedTarget } from "./session.js";
import { escapeHtml, formatActions, formatOriginal, pairChat, splitLines, TELEGRAM_TEXT_SOFT_LIMIT } from "./TelegramDelivery.js";
import { getInterpretationForMessage, type StoredMessage } from "./store.js";

// ─── Copy strings (PLAN.md §10 / CONTRACT) ──────────────────────────────────────────────────────────────
export const COPY = {
  replyPrompt: "请用中文写下你的回复，我会帮你起草英文。\nType your reply in Chinese; I will draft it in English for your review.",
  idle: "Tap ✍️ Reply under a reel first.",
  notAvailable: "Not available",
  alreadyHandled: "Already handled",
  paired: "Paired ✅ Your reels will arrive here. Open the Setup page to pick who to follow.",
  badCode: "This code is invalid or expired. Get a new one from the Setup page.",
  pairFirst: "Pair first: open the Setup page and tap Open Telegram.",
  help:
    "ReelRelay turns Slack messages into short reels you can understand at a glance.\n\n" +
    "/start <code> — pair this chat using the code from the Setup page\n" +
    "/help — this message\n\n" +
    "Under each reel: 📄 Original, ✅ Actions, ✍️ Reply (write in Chinese, I draft English), 👍 Got it.",
  cancelled: "Cancelled ❌",
  translationUnavailable: "Translation unavailable — showing the original:",
  sending: "Sending…",
  retrying: "Retrying…",
  regenerating: "Regenerating…",
  checking: "Checking… the reply may have gone through",
} as const;

const HANDLER_TIMEOUT_MS = 90_000;
const GET_ME_TIMEOUT_MS = 10_000;

let bot: Telegraf | null | undefined;
let started = false;

/** TELEGRAM_BOT_TOKEN is optional in config; empty and placeholder values mean "no bot". */
function tokenUsable(token: string | undefined): token is string {
  const t = (token ?? "").trim();
  return t.length > 0 && !t.toLowerCase().includes("placeholder");
}

/** The bot instance (null when TELEGRAM_BOT_TOKEN is empty/placeholder). Handlers are attached lazily by startTelegramBot. */
export function getBot(): Telegraf | null {
  if (bot !== undefined) return bot;
  const token = config.TELEGRAM_BOT_TOKEN;
  bot = tokenUsable(token) ? new Telegraf(token, { handlerTimeout: HANDLER_TIMEOUT_MS }) : null;
  return bot;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Wraps a handler so one failure logs and never kills polling. */
function safe<C extends Context>(name: string, fn: (ctx: C) => Promise<void>): (ctx: C) => Promise<void> {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (err) {
      console.error(`telegram: handler ${name} failed: ${errorText(err)}`);
    }
  };
}

/** Attaches handlers and launches polling. Never throws: a bad token logs `telegram: not started (<reason>)` and returns. */
export async function startTelegramBot(): Promise<void> {
  const instance = getBot();
  if (!instance) {
    console.log("telegram: not started (no token)");
    return;
  }
  if (started) return;

  let username = "";
  try {
    const me = await withTimeout(instance.telegram.getMe(), GET_ME_TIMEOUT_MS, "getMe");
    instance.botInfo = me;
    username = me.username;
  } catch (err) {
    console.log(`telegram: not started (${errorText(err)})`);
    return;
  }

  registerHandlers(instance);
  started = true;

  // launch() resolves only when polling stops (telegraf 4.16), so it must not be awaited.
  instance.launch({ dropPendingUpdates: false }).catch((err: unknown) => {
    started = false;
    console.error(`telegram: polling stopped: ${errorText(err)}`);
  });
  console.log(`telegram: polling as @${username}`);

  const stop = (signal: string) => {
    try {
      instance.stop(signal);
    } catch {
      // not running (never launched or already stopped)
    }
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

// ─── Handlers ───────────────────────────────────────────────────────────────────────────────────────────

function registerHandlers(instance: Telegraf): void {
  const flow = getReplyFlow();

  instance.start(
    safe("start", async (ctx) => {
      const code = (ctx.payload ?? "").trim();
      const chatId = String(ctx.chat.id);
      if (!code) {
        await ctx.reply(COPY.help);
        return;
      }
      const paired = await pairChat(chatId, code);
      if (!paired) {
        await ctx.reply(COPY.badCode);
        return;
      }
      console.log(`telegram: chat ${chatId} paired with user ${paired.userId}`);
      await ctx.reply(COPY.paired);
    }),
  );

  instance.help(safe("help", async (ctx) => void (await ctx.reply(COPY.help))));

  instance.on(
    callbackQuery("data"),
    safe("callback", async (ctx) => {
      const data = ctx.callbackQuery.data;
      const chat = ctx.callbackQuery.message?.chat;
      const chatId = chat ? String(chat.id) : String(ctx.from.id);

      const target = await resolveOwnedTarget(chatId, data);
      if (!target) {
        await ctx.answerCbQuery(COPY.notAvailable);
        console.warn(`telegram: callback rejected (chat ${chatId}, data ${JSON.stringify(data ?? null)})`);
        return;
      }
      await handleCallback(ctx, target, chatId, flow);
    }),
  );

  instance.on(
    message("text"),
    safe("text", async (ctx) => {
      const text = ctx.message.text;
      if (text.startsWith("/")) return; // commands are handled above (or unknown)
      const chatId = String(ctx.chat.id);
      const session = await getSession(chatId);
      if (!session) {
        await ctx.reply(COPY.pairFirst);
        return;
      }
      console.log(`telegram: text from chat ${chatId}: ${JSON.stringify(text.slice(0, 80))}`);
      const draft = await flow.handleText(chatId, session.user_id, text);
      if (!draft) {
        await ctx.reply(COPY.idle);
        return;
      }
      await getDelivery().sendDraft(chatId, draft);
    }),
  );

  instance.catch((err, ctx) => {
    console.error(`telegram: unhandled error on update ${ctx.update.update_id}: ${errorText(err)}`);
  });
}

type CallbackCtx = Context & { callbackQuery: { data: string } };

async function handleCallback(ctx: CallbackCtx, target: OwnedTarget, chatId: string, flow: ReturnType<typeof getReplyFlow>): Promise<void> {
  // Every branch answers the callback query exactly once, as early as possible, so the client stops its spinner.
  let answered = false;
  const answer = async (text?: string): Promise<void> => {
    if (answered) return;
    answered = true;
    try {
      await ctx.answerCbQuery(text);
    } catch (err) {
      console.warn(`telegram: answerCbQuery failed: ${errorText(err)}`);
    }
  };
  const sendHtml = (html: string, reply_markup?: ReturnType<typeof retrySendKeyboard>) =>
    ctx.telegram.sendMessage(chatId, html, { parse_mode: "HTML", reply_markup });

  switch (target.kind) {
    case "o": {
      await answer();
      await sendOriginal(ctx, chatId, target.message);
      return;
    }
    case "a": {
      await answer();
      const interp = await getInterpretationForMessage(target.message.id);
      if (interp) {
        for (const chunk of splitLines(formatActions(interp))) await sendHtml(chunk);
      } else {
        await sendHtml(`${COPY.translationUnavailable}\n<pre>${escapeHtml(target.message.originalText)}</pre>`);
      }
      return;
    }
    case "r": {
      await answer();
      await flow.startReply(chatId, target.message);
      await ctx.telegram.sendMessage(chatId, COPY.replyPrompt);
      return;
    }
    case "k": {
      await answer("👍");
      return;
    }
    case "s": {
      if (target.draft.status !== "draft") {
        await answer(COPY.alreadyHandled);
        return;
      }
      await answer(COPY.sending);
      const outcome = await flow.approveAndSend(target.draft.id, target.userId);
      await reportSendOutcome(ctx, chatId, outcome);
      return;
    }
    case "y": {
      if (target.draft.status !== "failed" && target.draft.status !== "send_uncertain") {
        await answer(COPY.alreadyHandled);
        return;
      }
      await answer(COPY.retrying);
      const outcome = await flow.retrySend(target.draft.id, target.userId);
      await reportSendOutcome(ctx, chatId, outcome);
      return;
    }
    case "g": {
      await answer(COPY.regenerating);
      const fresh = await flow.regenerate(target.draft.id, target.userId);
      if (!fresh) {
        await ctx.telegram.sendMessage(chatId, COPY.notAvailable);
        return;
      }
      await removeKeyboard(ctx);
      await getDelivery().sendDraft(chatId, fresh);
      return;
    }
    case "c": {
      await answer();
      const cancelled = await flow.cancel(target.draft.id, target.userId);
      if (!cancelled) {
        await ctx.telegram.sendMessage(chatId, COPY.alreadyHandled);
        return;
      }
      try {
        await ctx.editMessageText(COPY.cancelled);
      } catch {
        await ctx.telegram.sendMessage(chatId, COPY.cancelled);
      }
      return;
    }
  }
}

async function removeKeyboard(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {
    // The card may already be edited or too old; not important.
  }
}

async function sendOriginal(ctx: Context, chatId: string, message: StoredMessage): Promise<void> {
  const html = formatOriginal(message);
  if (html.length <= TELEGRAM_TEXT_SOFT_LIMIT) {
    await ctx.telegram.sendMessage(chatId, html, { parse_mode: "HTML" });
    return;
  }
  // Very long original: header as HTML, then the byte-exact text in plain chunks (no parse mode, so nothing needs escaping).
  await ctx.telegram.sendMessage(chatId, `📄 <b>${escapeHtml(message.senderDisplayName)}</b>`, { parse_mode: "HTML" });
  for (const chunk of splitLines(message.originalText)) await ctx.telegram.sendMessage(chatId, chunk);
}

async function reportSendOutcome(ctx: Context, chatId: string, outcome: ApproveOutcome): Promise<void> {
  if (!outcome.ok) {
    await ctx.telegram.sendMessage(chatId, outcome.code === "already_handled" ? COPY.alreadyHandled : COPY.notAvailable);
    return;
  }
  const { draft, message } = outcome;
  await removeKeyboard(ctx);
  const text = sendOutcomeText(draft, message.senderDisplayName);
  const reply_markup = draft.status === "failed" || draft.status === "send_uncertain" ? retrySendKeyboard(draft.id) : undefined;
  await ctx.telegram.sendMessage(chatId, text, { parse_mode: "HTML", reply_markup });
}

export function sendOutcomeText(draft: ReplyDraft, senderDisplayName: string): string {
  switch (draft.status) {
    case "sent":
      return `Sent ✅ in the thread under ${escapeHtml(senderDisplayName)}'s message`;
    case "failed":
      return `❌ Couldn't send (${escapeHtml(draft.errorDetail ?? "unknown error")})`;
    case "send_uncertain":
      return COPY.checking;
    default:
      return `Status: ${escapeHtml(draft.status)}`;
  }
}
