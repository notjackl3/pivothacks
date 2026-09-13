// Approval gate (PLAN.md §4.5, §13 task 13/14, §14): sendReply is called exactly once for two concurrent approves,
// never from draft/regenerate/cancel; api_error → failed, network → send_uncertain (+ reconcile), retry from failed re-sends once.
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ComprehensionEngine, NormalizedMessage, ReplyDraftRecord, ReplyDraftStatus, ReplyTone, UserPreferences } from "@reelrelay/shared";
import { createReplyFlow, type ReplyFlowDeps } from "../src/delivery/telegram/reply.js";
import type { StoredMessage } from "../src/delivery/telegram/store.js";
import type { TelegramSessionRow } from "../src/db/queries/telegram.js";

/** Mirrors connectors/slack/SlackConnector.ts#SlackSendError without importing the connector module. */
class FakeSlackSendError extends Error {
  kind: "api_error" | "network";
  slackError: string | null;
  constructor(kind: "api_error" | "network", message: string, slackError: string | null = null) {
    super(message);
    this.name = "SlackSendError";
    this.kind = kind;
    this.slackError = slackError;
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const CHAT = "111111111";

const MESSAGE: StoredMessage = {
  id: "6f1a2b3c-0000-4000-8000-000000000000",
  userId: USER,
  connectionId: "33333333-3333-4333-8333-333333333333",
  externalMessageId: "D0000EXAMPLE:1757772131.000200",
  externalChannelId: "D0000EXAMPLE",
  externalThreadId: null,
  senderExternalId: "U0000PROFESSOR",
  senderDisplayName: "Professor Chen",
  originalText: "Hi Jack — the project deadline has moved to Friday at 5:00 PM.",
  receivedAt: "2026-09-13T14:02:11.000Z",
  isMock: false,
  provider: "slack",
};

const PREFS: UserPreferences = { targetLanguage: "zh-CN", timezone: "America/Toronto", replyTone: "respectful_student", quietStart: "22:00", quietEnd: "08:00" };

function toNormalized(m: StoredMessage): NormalizedMessage {
  return {
    provider: m.provider,
    connectionId: m.connectionId,
    externalMessageId: m.externalMessageId,
    externalChannelId: m.externalChannelId,
    externalThreadId: m.externalThreadId,
    senderExternalId: m.senderExternalId,
    senderDisplayName: m.senderDisplayName,
    text: m.originalText,
    receivedAt: m.receivedAt,
  };
}

/** In-memory reply_drafts with a synchronous check-and-set claim (the equivalent of the conditional UPDATE). */
class DraftStore {
  rows = new Map<string, ReplyDraftRecord>();

  seed(partial: Partial<ReplyDraftRecord> = {}): ReplyDraftRecord {
    const now = new Date().toISOString();
    const row: ReplyDraftRecord = {
      id: randomUUID(),
      messageId: MESSAGE.id,
      userId: USER,
      userInputOriginal: "好的，我会在周五下午五点前提交。",
      draftEnglish: "Hi Professor Chen,\n\nUnderstood, I will submit by Friday at 5:00 PM.\n\nBest regards,\nJack",
      meaningCheck: "我会在周五下午五点前提交。",
      tone: "respectful_student",
      status: "draft",
      approvedAt: null,
      sentExternalMessageId: null,
      errorDetail: null,
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
    this.rows.set(row.id, row);
    return row;
  }

  deps(): ReplyFlowDeps["drafts"] {
    return {
      insertDraft: async (input) =>
        this.seed({
          messageId: input.messageId,
          userId: input.userId,
          userInputOriginal: input.userInputOriginal,
          draftEnglish: input.draftEnglish,
          meaningCheck: input.meaningCheck,
          tone: input.tone,
        }),
      getDraftForUser: async (id, userId) => {
        const row = this.rows.get(id);
        return row && row.userId === userId ? { ...row } : null;
      },
      claimDraftForSend: async (id, userId, from: ReplyDraftStatus[] = ["draft"]) => {
        // No await before the check-and-set: two concurrent callers are serialized by the event loop, like the DB row lock.
        const row = this.rows.get(id);
        if (!row || row.userId !== userId || !from.includes(row.status)) return null;
        const now = new Date().toISOString();
        const claimed: ReplyDraftRecord = {
          ...row,
          status: "approved",
          updatedAt: now,
          approvedAt: from.includes("draft") ? now : row.approvedAt,
        };
        this.rows.set(id, claimed);
        return { ...claimed };
      },
      markDraft: async (id, patch) => {
        const row = this.rows.get(id);
        if (!row) throw new Error("missing draft");
        const next: ReplyDraftRecord = { ...row, status: patch.status, updatedAt: new Date().toISOString() };
        if (patch.sentExternalMessageId !== undefined) next.sentExternalMessageId = patch.sentExternalMessageId;
        if (patch.errorDetail !== undefined) next.errorDetail = patch.errorDetail;
        this.rows.set(id, next);
        return { ...next };
      },
      cancelDraft: async (id, userId) => {
        const row = this.rows.get(id);
        if (!row || row.userId !== userId || row.status !== "draft") return false;
        this.rows.set(id, { ...row, status: "cancelled", updatedAt: new Date().toISOString() });
        return true;
      },
    };
  }
}

interface Harness {
  flow: ReturnType<typeof createReplyFlow>;
  drafts: DraftStore;
  sessions: Map<string, TelegramSessionRow>;
  sendReply: ReturnType<typeof vi.fn<ReplyFlowDeps["slack"]["sendReply"]>>;
  reconcile: ReturnType<typeof vi.fn<ReplyFlowDeps["slack"]["reconcileUncertainSend"]>>;
  draftReply: ReturnType<typeof vi.fn<ComprehensionEngine["draftReply"]>>;
}

function harness(opts: { sendDelayMs?: number } = {}): Harness {
  const drafts = new DraftStore();
  const sessions = new Map<string, TelegramSessionRow>();
  const sendReply = vi.fn<ReplyFlowDeps["slack"]["sendReply"]>(async () => {
    if (opts.sendDelayMs) await new Promise((r) => setTimeout(r, opts.sendDelayMs));
    return { externalMessageId: "1757772422.000300" };
  });
  const reconcile = vi.fn<ReplyFlowDeps["slack"]["reconcileUncertainSend"]>(async () => ({ found: false as const }));
  const draftReply = vi.fn<ComprehensionEngine["draftReply"]>(async (ctx, userInput, tone: ReplyTone) => ({
    detectedInputLanguage: "zh-CN",
    draftEnglish: `[${tone}] ${userInput} — ${ctx.studentName}`,
    meaningCheck: "意思核对",
    warnings: ["你没有回答老师关于延期的问题。"],
  }));
  const engine: ComprehensionEngine = {
    analyze: async () => {
      throw new Error("not used");
    },
    draftReply,
  };

  const deps: ReplyFlowDeps = {
    drafts: drafts.deps(),
    store: {
      getMessageForUser: async (messageId, userId) => (messageId === MESSAGE.id && userId === USER ? MESSAGE : null),
      getInterpretationForMessage: async () => null,
      toNormalizedMessage: toNormalized,
    },
    sessions: {
      getSession: async (chatId) => sessions.get(chatId) ?? null,
      setSessionState: async (chatId, state, activeMessageId) => {
        const existing = sessions.get(chatId);
        if (!existing) throw new Error("no session");
        sessions.set(chatId, { ...existing, state, active_message_id: activeMessageId, updated_at: new Date().toISOString() });
      },
    },
    prefs: { getPreferences: async () => PREFS, studentName: async () => "Jack" },
    slack: { sendReply, reconcileUncertainSend: reconcile },
    engine: () => engine,
  };
  return { flow: createReplyFlow(deps), drafts, sessions, sendReply, reconcile, draftReply };
}

function pairedSession(h: Harness, state: TelegramSessionRow["state"] = "idle", active: string | null = null): void {
  h.sessions.set(CHAT, { chat_id: CHAT, user_id: USER, state, active_message_id: active, updated_at: new Date().toISOString() });
}

describe("approval gate", () => {
  it("calls sendReply exactly once for two concurrent approves; the loser gets already_handled", async () => {
    const h = harness({ sendDelayMs: 20 });
    const draft = h.drafts.seed();

    const [a, b] = await Promise.all([h.flow.approveAndSend(draft.id, USER), h.flow.approveAndSend(draft.id, USER)]);

    expect(h.sendReply).toHaveBeenCalledTimes(1);
    const winner = [a, b].find((o) => o.ok);
    const loser = [a, b].find((o) => !o.ok);
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    if (!winner?.ok) throw new Error("no winner");
    expect(winner.draft.status).toBe("sent");
    expect(winner.draft.sentExternalMessageId).toBe("1757772422.000300");
    expect(winner.draft.approvedAt).not.toBeNull();
    expect(winner.message.id).toBe(MESSAGE.id);
    if (loser?.ok !== false) throw new Error("no loser");
    expect(loser.code).toBe("already_handled");
    expect(loser.draft?.status).toMatch(/approved|sent/);
    expect(h.drafts.rows.get(draft.id)?.status).toBe("sent");
  });

  it("a second approve after the first completed is already_handled and does not send again", async () => {
    const h = harness();
    const draft = h.drafts.seed();
    const first = await h.flow.approveAndSend(draft.id, USER);
    expect(first.ok).toBe(true);
    const second = await h.flow.approveAndSend(draft.id, USER);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unexpected");
    expect(second.code).toBe("already_handled");
    expect(second.draft?.status).toBe("sent");
    expect(h.sendReply).toHaveBeenCalledTimes(1);
  });

  it("approve of an unknown or foreign draft is not_found and never sends", async () => {
    const h = harness();
    const draft = h.drafts.seed({ userId: OTHER_USER });
    const foreign = await h.flow.approveAndSend(draft.id, USER);
    expect(foreign).toEqual({ ok: false, code: "not_found", draft: null });
    const missing = await h.flow.approveAndSend(randomUUID(), USER);
    expect(missing).toEqual({ ok: false, code: "not_found", draft: null });
    expect(h.sendReply).not.toHaveBeenCalled();
    expect(h.drafts.rows.get(draft.id)?.status).toBe("draft");
  });

  it("sends exactly the draft text to the thread of the original message", async () => {
    const h = harness();
    const draft = h.drafts.seed();
    await h.flow.approveAndSend(draft.id, USER);
    expect(h.sendReply).toHaveBeenCalledWith(toNormalized(MESSAGE), draft.draftEnglish);
  });
});

describe("draft, regenerate, cancel never send", () => {
  it("handleText drafts only while awaiting_reply and returns the session to idle", async () => {
    const h = harness();
    pairedSession(h, "idle");
    expect(await h.flow.handleText(CHAT, USER, "好的")).toBeNull();
    expect(h.draftReply).not.toHaveBeenCalled();

    await h.flow.startReply(CHAT, MESSAGE);
    expect(h.sessions.get(CHAT)).toMatchObject({ state: "awaiting_reply", active_message_id: MESSAGE.id });

    const draft = await h.flow.handleText(CHAT, USER, "好的，我会在周五下午五点前提交。");
    expect(draft).not.toBeNull();
    expect(draft?.status).toBe("draft");
    expect(draft?.tone).toBe(PREFS.replyTone);
    expect(draft?.warnings).toEqual(["你没有回答老师关于延期的问题。"]);
    expect(draft?.draftEnglish).toContain("Jack");
    expect(h.draftReply).toHaveBeenCalledTimes(1);
    const ctx = h.draftReply.mock.calls[0]?.[0];
    expect(ctx).toMatchObject({ studentName: "Jack", preferences: PREFS });
    // No reel artifact yet → the engine gets a placeholder interpretation that carries only the original text.
    expect(ctx?.interpretation).toMatchObject({ faithfulTranslation: MESSAGE.originalText, shortTitle: "Translation unavailable", sourceLanguage: "und", actionItems: [] });
    expect(h.sessions.get(CHAT)).toMatchObject({ state: "idle", active_message_id: null });
    expect(h.sendReply).not.toHaveBeenCalled();

    // Session for a different chat/user never drafts.
    expect(await h.flow.handleText("999", USER, "hi")).toBeNull();
    expect(await h.flow.handleText(CHAT, OTHER_USER, "hi")).toBeNull();
  });

  it("regenerate creates a new draft (with the requested tone) and cancels the old one, without sending", async () => {
    const h = harness();
    const old = h.drafts.seed();
    const fresh = await h.flow.regenerate(old.id, USER, "direct");
    expect(fresh).not.toBeNull();
    expect(fresh?.id).not.toBe(old.id);
    expect(fresh?.status).toBe("draft");
    expect(fresh?.tone).toBe("direct");
    expect(fresh?.userInputOriginal).toBe(old.userInputOriginal);
    expect(h.drafts.rows.get(old.id)?.status).toBe("cancelled");
    expect(h.sendReply).not.toHaveBeenCalled();

    // Regenerating a failed draft keeps the failed row as-is (only 'draft' rows get cancelled).
    const failed = h.drafts.seed({ status: "failed", errorDetail: "channel_not_found", approvedAt: new Date().toISOString() });
    const again = await h.flow.regenerate(failed.id, USER);
    expect(again?.tone).toBe(failed.tone);
    expect(h.drafts.rows.get(failed.id)?.status).toBe("failed");

    // Sent drafts cannot be regenerated; foreign drafts are invisible.
    const sent = h.drafts.seed({ status: "sent" });
    expect(await h.flow.regenerate(sent.id, USER)).toBeNull();
    const foreign = h.drafts.seed({ userId: OTHER_USER });
    expect(await h.flow.regenerate(foreign.id, USER)).toBeNull();
    expect(h.sendReply).not.toHaveBeenCalled();
  });

  it("cancel moves draft → cancelled, is a no-op otherwise, and never sends", async () => {
    const h = harness();
    const draft = h.drafts.seed();
    expect(await h.flow.cancel(draft.id, USER)).toBe(true);
    expect(h.drafts.rows.get(draft.id)?.status).toBe("cancelled");
    expect(await h.flow.cancel(draft.id, USER)).toBe(false);
    const sent = h.drafts.seed({ status: "sent" });
    expect(await h.flow.cancel(sent.id, USER)).toBe(false);
    expect(h.sendReply).not.toHaveBeenCalled();
  });
});

describe("failure classification (PLAN.md §15)", () => {
  it("Slack api_error → failed with the Slack error as errorDetail", async () => {
    const h = harness();
    h.sendReply.mockRejectedValueOnce(new FakeSlackSendError("api_error", "chat.postMessage failed: channel_not_found", "channel_not_found"));
    const draft = h.drafts.seed();
    const outcome = await h.flow.approveAndSend(draft.id, USER);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("failed");
    expect(outcome.draft.errorDetail).toBe("channel_not_found");
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it("unknown error → failed with the error message", async () => {
    const h = harness();
    h.sendReply.mockRejectedValueOnce(new Error("boom"));
    const draft = h.drafts.seed();
    const outcome = await h.flow.approveAndSend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("failed");
    expect(outcome.draft.errorDetail).toBe("boom");
  });

  it("network error → send_uncertain when reconcile finds nothing", async () => {
    const h = harness();
    h.sendReply.mockRejectedValueOnce(new FakeSlackSendError("network", "socket hang up"));
    const draft = h.drafts.seed();
    const outcome = await h.flow.approveAndSend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("send_uncertain");
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.reconcile.mock.calls[0]?.[1]).toBe(draft.draftEnglish);
    expect(h.reconcile.mock.calls[0]?.[2]).toBe(outcome.draft.approvedAt);
    expect(h.sendReply).toHaveBeenCalledTimes(1);
  });

  it("network error → sent when the immediate reconcile finds the message", async () => {
    const h = harness();
    h.sendReply.mockRejectedValueOnce(new FakeSlackSendError("network", "ETIMEDOUT"));
    h.reconcile.mockResolvedValueOnce({ found: true, externalMessageId: "1757772500.000400" });
    const draft = h.drafts.seed();
    const outcome = await h.flow.approveAndSend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("sent");
    expect(outcome.draft.sentExternalMessageId).toBe("1757772500.000400");
    expect(h.sendReply).toHaveBeenCalledTimes(1);
  });
});

describe("retrySend", () => {
  it("from failed sends again exactly once and marks sent", async () => {
    const h = harness();
    const approvedAt = "2026-09-13T14:07:02.000Z";
    const draft = h.drafts.seed({ status: "failed", errorDetail: "channel_not_found", approvedAt });
    const outcome = await h.flow.retrySend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("sent");
    expect(outcome.draft.approvedAt).toBe(approvedAt); // the original approval time is kept
    expect(outcome.draft.errorDetail).toBeNull();
    expect(h.sendReply).toHaveBeenCalledTimes(1);
    expect(h.reconcile).not.toHaveBeenCalled();

    // Concurrent retries: only one send.
    const failedAgain = h.drafts.seed({ status: "failed", approvedAt });
    h.sendReply.mockClear();
    const [a, b] = await Promise.all([h.flow.retrySend(failedAgain.id, USER), h.flow.retrySend(failedAgain.id, USER)]);
    expect(h.sendReply).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  it("from send_uncertain reconciles first and does not re-send when found", async () => {
    const h = harness();
    h.reconcile.mockResolvedValueOnce({ found: true, externalMessageId: "1757772600.000500" });
    const draft = h.drafts.seed({ status: "send_uncertain", approvedAt: "2026-09-13T14:07:02.000Z" });
    const outcome = await h.flow.retrySend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("sent");
    expect(outcome.draft.sentExternalMessageId).toBe("1757772600.000500");
    expect(h.reconcile).toHaveBeenCalledWith(toNormalized(MESSAGE), draft.draftEnglish, "2026-09-13T14:07:02.000Z");
    expect(h.sendReply).not.toHaveBeenCalled();
  });

  it("from send_uncertain re-sends once when reconcile finds nothing", async () => {
    const h = harness();
    const draft = h.drafts.seed({ status: "send_uncertain", approvedAt: "2026-09-13T14:07:02.000Z" });
    const outcome = await h.flow.retrySend(draft.id, USER);
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.draft.status).toBe("sent");
    expect(h.reconcile).toHaveBeenCalledTimes(1);
    expect(h.sendReply).toHaveBeenCalledTimes(1);
  });

  it("refuses drafts that are not failed / send_uncertain", async () => {
    const h = harness();
    const sent = h.drafts.seed({ status: "sent" });
    const outcome = await h.flow.retrySend(sent.id, USER);
    expect(outcome).toMatchObject({ ok: false, code: "already_handled" });
    const plain = h.drafts.seed();
    expect(await h.flow.retrySend(plain.id, USER)).toMatchObject({ ok: false, code: "already_handled" });
    expect(await h.flow.retrySend(randomUUID(), USER)).toEqual({ ok: false, code: "not_found", draft: null });
    expect(h.sendReply).not.toHaveBeenCalled();
  });
});
