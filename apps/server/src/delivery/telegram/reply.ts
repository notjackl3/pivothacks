// Dev B. Reply flow (PLAN.md §4.5, §10, §15). Used by the Telegram bot AND routes/api/replies.ts.
// Only approveAndSend / retrySend may call slack.sendReply (PLAN.md task 13 acceptance).
import type {
  ComprehensionEngine,
  ConversationContext,
  MessageInterpretation,
  NormalizedMessage,
  ReplyDraftRecord,
  ReplyDraftStatus,
  ReplyTone,
  UserPreferences,
} from "@reelrelay/shared";
import type { StoredMessage } from "./store.js";
import { cancelDraft, claimDraftForSend, getDraftForUser, insertDraft, markDraft } from "../../db/queries/drafts.js";
import { getSession, setSessionState } from "../../db/queries/telegram.js";
import { getPreferences, getUserProfile, studentNameFor } from "../../db/queries/preferences.js";
import { getSlackConnector } from "../../connectors/slack/SlackConnector.js";
import { getEngine } from "../../engine/index.js";
import { getInterpretationForMessage, getMessageForUser, toNormalizedMessage } from "./store.js";

export interface ReplyFlowDeps {
  drafts: {
    insertDraft: typeof import("../../db/queries/drafts.js").insertDraft;
    getDraftForUser: typeof import("../../db/queries/drafts.js").getDraftForUser;
    claimDraftForSend: typeof import("../../db/queries/drafts.js").claimDraftForSend;
    markDraft: typeof import("../../db/queries/drafts.js").markDraft;
    cancelDraft: typeof import("../../db/queries/drafts.js").cancelDraft;
  };
  store: {
    getMessageForUser: (messageId: string, userId: string) => Promise<StoredMessage | null>;
    getInterpretationForMessage: typeof import("./store.js").getInterpretationForMessage;
    toNormalizedMessage: (m: StoredMessage) => NormalizedMessage;
  };
  sessions: {
    getSession: typeof import("../../db/queries/telegram.js").getSession;
    setSessionState: typeof import("../../db/queries/telegram.js").setSessionState;
  };
  prefs: {
    getPreferences: (userId: string) => Promise<UserPreferences>;
    studentName: (userId: string) => Promise<string>;
  };
  slack: {
    sendReply: (message: NormalizedMessage, text: string) => Promise<{ externalMessageId: string }>;
    reconcileUncertainSend: (
      message: NormalizedMessage,
      text: string,
      approvedAtIso: string,
    ) => Promise<{ found: true; externalMessageId: string } | { found: false }>;
  };
  engine: () => ComprehensionEngine;
}

export type ApproveOutcome =
  | { ok: true; draft: ReplyDraftRecord; message: StoredMessage }
  | { ok: false; code: "already_handled" | "not_found"; draft: ReplyDraftRecord | null };

export interface ReplyFlow {
  /** [Reply] tap: session → awaiting_reply with active_message_id. */
  startReply(chatId: string, message: StoredMessage): Promise<void>;
  /** Text while awaiting_reply → engine.draftReply → reply_drafts(draft). Returns null when idle (caller says "Tap ✍️ Reply under a reel first."). */
  handleText(chatId: string, userId: string, text: string): Promise<ReplyDraftRecord | null>;
  /** Atomic approve (draft → approved) then Slack send → sent | failed | send_uncertain. Second concurrent call → already_handled. */
  approveAndSend(draftId: string, userId: string): Promise<ApproveOutcome>;
  /** From failed → re-send. From send_uncertain → reconcile first; re-send only if not found. */
  retrySend(draftId: string, userId: string): Promise<ApproveOutcome>;
  /** New draft from the same input (optionally a different tone); the old draft → cancelled. */
  regenerate(draftId: string, userId: string, tone?: ReplyTone): Promise<ReplyDraftRecord | null>;
  cancel(draftId: string, userId: string): Promise<boolean>;
}

export const TERMINAL_DRAFT_STATUSES: readonly ReplyDraftStatus[] = ["sent", "cancelled"];

/** Statuses a draft may be regenerated from. */
export const REGENERATABLE_STATUSES: readonly ReplyDraftStatus[] = ["draft", "failed", "cancelled"];

/** Statuses a draft may be re-sent from (PLAN.md §15). */
export const RETRYABLE_STATUSES: readonly ReplyDraftStatus[] = ["failed", "send_uncertain"];

/**
 * ConversationContext.interpretation is required. When the message has no reel artifact yet (analysis failed or still
 * running) drafting must still work, so the engine gets a minimal placeholder that carries only the original text.
 */
export function placeholderInterpretation(message: StoredMessage): MessageInterpretation {
  return {
    sourceLanguage: "und",
    targetLanguage: "und",
    faithfulTranslation: message.originalText,
    shortTitle: "Translation unavailable",
    hook: "Please review the original message.",
    spokenSegments: ["Translation unavailable.", "Please review the original message."],
    senderIntent: "Interpretation unavailable.",
    urgency: "medium",
    isSensitive: true,
    actionItems: [],
    preservedFacts: [],
    ambiguities: [],
    suggestedClarifyingQuestions: [],
  };
}

/** Structural check so the flow does not depend on the connector module (tests inject fakes). Mirrors SlackSendError. */
interface SendErrorLike {
  kind: "api_error" | "network";
  slackError: string | null;
  message: string;
}

function asSendError(err: unknown): SendErrorLike | null {
  if (!err || typeof err !== "object") return null;
  const kind = (err as { kind?: unknown }).kind;
  if (kind !== "api_error" && kind !== "network") return null;
  const slackError = (err as { slackError?: unknown }).slackError;
  const message = (err as { message?: unknown }).message;
  return {
    kind,
    slackError: typeof slackError === "string" ? slackError : null,
    message: typeof message === "string" ? message : String(err),
  };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}

function withWarnings(draft: ReplyDraftRecord, warnings: string[] | undefined): ReplyDraftRecord {
  return warnings && warnings.length > 0 ? { ...draft, warnings } : draft;
}

export function createReplyFlow(deps: ReplyFlowDeps): ReplyFlow {
  async function buildContext(userId: string, message: StoredMessage): Promise<{ ctx: ConversationContext; prefs: UserPreferences }> {
    const [prefs, studentName, interpretation] = await Promise.all([
      deps.prefs.getPreferences(userId),
      deps.prefs.studentName(userId),
      deps.store.getInterpretationForMessage(message.id),
    ]);
    return {
      prefs,
      ctx: {
        message: deps.store.toNormalizedMessage(message),
        interpretation: interpretation ?? placeholderInterpretation(message),
        preferences: prefs,
        studentName,
      },
    };
  }

  async function draftFor(userId: string, message: StoredMessage, userInput: string, tone?: ReplyTone): Promise<ReplyDraftRecord> {
    const { ctx, prefs } = await buildContext(userId, message);
    const effectiveTone = tone ?? prefs.replyTone;
    const out = await deps.engine().draftReply(ctx, userInput, effectiveTone);
    const draft = await deps.drafts.insertDraft({
      messageId: message.id,
      userId,
      userInputOriginal: userInput,
      draftEnglish: out.draftEnglish,
      meaningCheck: out.meaningCheck || null,
      tone: effectiveTone,
    });
    return withWarnings(draft, out.warnings);
  }

  async function notClaimed(draftId: string, userId: string): Promise<ApproveOutcome> {
    const existing = await deps.drafts.getDraftForUser(draftId, userId);
    return { ok: false, code: existing ? "already_handled" : "not_found", draft: existing };
  }

  async function loadMessageForClaimed(claimed: ReplyDraftRecord, userId: string): Promise<StoredMessage | ApproveOutcome> {
    const message = await deps.store.getMessageForUser(claimed.messageId, userId);
    if (message) return message;
    const failed = await deps.drafts.markDraft(claimed.id, { status: "failed", errorDetail: "message_missing" });
    return { ok: false, code: "not_found", draft: failed };
  }

  function isOutcome(v: StoredMessage | ApproveOutcome): v is ApproveOutcome {
    return typeof (v as ApproveOutcome).ok === "boolean";
  }

  async function reconcile(
    claimed: ReplyDraftRecord,
    message: StoredMessage,
    normalized: NormalizedMessage,
    approvedAtIso: string,
  ): Promise<ApproveOutcome | null> {
    const found = await deps.slack.reconcileUncertainSend(normalized, claimed.draftEnglish, approvedAtIso);
    if (!found.found) return null;
    const sent = await deps.drafts.markDraft(claimed.id, {
      status: "sent",
      sentExternalMessageId: found.externalMessageId,
      errorDetail: null,
    });
    return { ok: true, draft: sent, message };
  }

  /** The ONLY place slack.sendReply is invoked. Reached from approveAndSend and retrySend. */
  async function performSend(claimed: ReplyDraftRecord, message: StoredMessage): Promise<ApproveOutcome> {
    const normalized = deps.store.toNormalizedMessage(message);
    try {
      const { externalMessageId } = await deps.slack.sendReply(normalized, claimed.draftEnglish);
      const sent = await deps.drafts.markDraft(claimed.id, { status: "sent", sentExternalMessageId: externalMessageId, errorDetail: null });
      return { ok: true, draft: sent, message };
    } catch (err) {
      const sendErr = asSendError(err);
      if (sendErr?.kind === "network") {
        // The request may have left: never re-send blindly. Mark uncertain, then try one immediate reconcile (PLAN.md §15).
        const uncertain = await deps.drafts.markDraft(claimed.id, { status: "send_uncertain", errorDetail: sendErr.message });
        const approvedAt = claimed.approvedAt ?? uncertain.approvedAt ?? new Date().toISOString();
        try {
          const reconciled = await reconcile(claimed, message, normalized, approvedAt);
          if (reconciled) return reconciled;
        } catch (reconcileErr) {
          console.warn(`[reply] reconcile after network error failed for draft ${claimed.id}: ${errorText(reconcileErr)}`);
        }
        return { ok: true, draft: uncertain, message };
      }
      const detail = sendErr ? (sendErr.slackError ?? sendErr.message) : errorText(err);
      const failed = await deps.drafts.markDraft(claimed.id, { status: "failed", errorDetail: detail });
      return { ok: true, draft: failed, message };
    }
  }

  return {
    async startReply(chatId, message) {
      await deps.sessions.setSessionState(String(chatId), "awaiting_reply", message.id);
    },

    async handleText(chatId, userId, text) {
      const session = await deps.sessions.getSession(String(chatId));
      if (!session || session.user_id !== userId) return null;
      if (session.state !== "awaiting_reply" || !session.active_message_id) return null;
      const message = await deps.store.getMessageForUser(session.active_message_id, userId);
      if (!message) {
        // The referenced message is gone (deleted or foreign); drop the stale state so the next tap starts clean.
        await deps.sessions.setSessionState(String(chatId), "idle", null);
        return null;
      }
      const input = text.trim();
      if (!input) return null;
      const draft = await draftFor(userId, message, input);
      await deps.sessions.setSessionState(String(chatId), "idle", null);
      return draft;
    },

    async approveAndSend(draftId, userId) {
      const claimed = await deps.drafts.claimDraftForSend(draftId, userId, ["draft"]);
      if (!claimed) return notClaimed(draftId, userId);
      const loaded = await loadMessageForClaimed(claimed, userId);
      if (isOutcome(loaded)) return loaded;
      return performSend(claimed, loaded);
    },

    async retrySend(draftId, userId) {
      const previous = await deps.drafts.getDraftForUser(draftId, userId);
      if (!previous) return { ok: false, code: "not_found", draft: null };
      const claimed = await deps.drafts.claimDraftForSend(draftId, userId, [...RETRYABLE_STATUSES]);
      if (!claimed) return notClaimed(draftId, userId);
      const loaded = await loadMessageForClaimed(claimed, userId);
      if (isOutcome(loaded)) return loaded;
      const message = loaded;

      if (previous.status === "send_uncertain") {
        const normalized = deps.store.toNormalizedMessage(message);
        // The reconcile window starts at the first approval; fall back to the row's own timestamps when it was never stamped.
        const approvedAt = claimed.approvedAt ?? previous.approvedAt ?? previous.updatedAt ?? previous.createdAt;
        try {
          const reconciled = await reconcile(claimed, message, normalized, approvedAt);
          if (reconciled) return reconciled;
        } catch (err) {
          // Still no answer from Slack: stay uncertain rather than risk a duplicate reply.
          console.warn(`[reply] reconcile on retry failed for draft ${claimed.id}: ${errorText(err)}`);
          const uncertain = await deps.drafts.markDraft(claimed.id, { status: "send_uncertain", errorDetail: errorText(err) });
          return { ok: true, draft: uncertain, message };
        }
      }
      return performSend(claimed, message);
    },

    async regenerate(draftId, userId, tone) {
      const old = await deps.drafts.getDraftForUser(draftId, userId);
      if (!old) return null;
      if (!REGENERATABLE_STATUSES.includes(old.status)) return null;
      const message = await deps.store.getMessageForUser(old.messageId, userId);
      if (!message) return null;
      const fresh = await draftFor(userId, message, old.userInputOriginal, tone ?? old.tone);
      if (old.status === "draft") await deps.drafts.cancelDraft(old.id, userId);
      return fresh;
    },

    async cancel(draftId, userId) {
      return deps.drafts.cancelDraft(draftId, userId);
    },
  };
}

let singleton: ReplyFlow | null = null;

/** Singleton wired to the real modules. */
export function getReplyFlow(): ReplyFlow {
  if (!singleton) {
    singleton = createReplyFlow({
      drafts: { insertDraft, getDraftForUser, claimDraftForSend, markDraft, cancelDraft },
      store: { getMessageForUser, getInterpretationForMessage, toNormalizedMessage },
      sessions: { getSession, setSessionState },
      prefs: {
        getPreferences,
        studentName: async (userId) => studentNameFor(await getUserProfile(userId)),
      },
      slack: {
        sendReply: (message, text) => getSlackConnector().sendReply(message, text),
        reconcileUncertainSend: (message, text, approvedAtIso) => getSlackConnector().reconcileUncertainSend(message, text, approvedAtIso),
      },
      engine: getEngine,
    });
  }
  return singleton;
}
