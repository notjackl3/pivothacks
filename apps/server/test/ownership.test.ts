// Callback ownership check (PLAN.md §10, §13 task 6): the chat's session user must own the referenced row, else "Not available".
import { describe, expect, it } from "vitest";
import type { ReplyDraftRecord } from "@reelrelay/shared";
import { encodeCallback, idPrefix, parseCallback, reelKeyboard, draftKeyboard, retrySendKeyboard } from "../src/delivery/telegram/keyboards.js";
import { resolveOwnedTarget, type OwnershipStore } from "../src/delivery/telegram/session.js";
import type { StoredMessage } from "../src/delivery/telegram/store.js";
import type { TelegramSessionRow } from "../src/db/queries/telegram.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const CHAT = "111111111";
const FOREIGN_CHAT = "222222222";

const MESSAGE: StoredMessage = {
  id: "6f1a2b3c-0000-4000-8000-000000000000",
  userId: USER,
  connectionId: "33333333-3333-4333-8333-333333333333",
  externalMessageId: "D0000EXAMPLE:1757772131.000200",
  externalChannelId: "D0000EXAMPLE",
  externalThreadId: null,
  senderExternalId: "U0000PROFESSOR",
  senderDisplayName: "Professor Chen",
  originalText: "Hi Jack — the project deadline has moved.",
  receivedAt: "2026-09-13T14:02:11.000Z",
  isMock: false,
  provider: "slack",
};

const FOREIGN_MESSAGE: StoredMessage = { ...MESSAGE, id: "abcdef12-0000-4000-8000-000000000000", userId: OTHER_USER };

function draft(partial: Partial<ReplyDraftRecord>): ReplyDraftRecord {
  return {
    id: "7a7a7a7a-0000-4000-8000-000000000000",
    messageId: MESSAGE.id,
    userId: USER,
    userInputOriginal: "好的",
    draftEnglish: "Understood.",
    meaningCheck: null,
    tone: "respectful_student",
    status: "draft",
    approvedAt: null,
    sentExternalMessageId: null,
    errorDetail: null,
    createdAt: "2026-09-13T14:05:00.000Z",
    updatedAt: "2026-09-13T14:05:00.000Z",
    ...partial,
  };
}

const OWN_DRAFT = draft({});
const FOREIGN_DRAFT = draft({ id: "9b9b9b9b-0000-4000-8000-000000000000", userId: OTHER_USER });

/** Fake store that behaves like the real user-scoped queries: rows only resolve for their owner. */
function fakeStore(): OwnershipStore & { calls: string[] } {
  const sessions = new Map<string, TelegramSessionRow>([
    [CHAT, { chat_id: CHAT, user_id: USER, state: "idle", active_message_id: null, updated_at: "2026-09-13T14:00:00.000Z" }],
    [FOREIGN_CHAT, { chat_id: FOREIGN_CHAT, user_id: OTHER_USER, state: "idle", active_message_id: null, updated_at: "2026-09-13T14:00:00.000Z" }],
  ]);
  const messages = [MESSAGE, FOREIGN_MESSAGE];
  const drafts = [OWN_DRAFT, FOREIGN_DRAFT];
  const calls: string[] = [];
  return {
    calls,
    async getSession(chatId) {
      calls.push(`session:${chatId}`);
      return sessions.get(chatId) ?? null;
    },
    async findMessageByPrefixForUser(prefix8, userId) {
      calls.push(`message:${prefix8}:${userId}`);
      return messages.find((m) => idPrefix(m.id) === prefix8 && m.userId === userId) ?? null;
    },
    async findDraftByPrefixForUser(prefix8, userId) {
      calls.push(`draft:${prefix8}:${userId}`);
      return drafts.find((d) => idPrefix(d.id) === prefix8 && d.userId === userId) ?? null;
    },
  };
}

describe("callback codec", () => {
  it("encodes <kind>:<id8> and parses it back", () => {
    expect(idPrefix(MESSAGE.id)).toBe("6f1a2b3c");
    expect(encodeCallback("r", MESSAGE.id)).toBe("r:6f1a2b3c");
    expect(parseCallback("r:6f1a2b3c")).toEqual({ kind: "r", prefix: "6f1a2b3c" });
    expect(encodeCallback("s", OWN_DRAFT.id).length).toBeLessThanOrEqual(64);
  });

  it("rejects malformed data", () => {
    for (const bad of [undefined, "", "r", "r:", "x:6f1a2b3c", "r:6F1A2B3C", "r:6f1a2b3", "r:6f1a2b3c9", "r:6f1a2b3c; drop", "r:zzzzzzzz"]) {
      expect(parseCallback(bad)).toBeNull();
    }
  });

  it("keyboards carry the expected buttons and callback data", () => {
    const reel = reelKeyboard(MESSAGE.id).inline_keyboard;
    expect(reel.map((row) => row.map((b) => b.text))).toEqual([
      ["📄 Original", "✅ Actions"],
      ["✍️ Reply", "👍 Got it"],
    ]);
    expect(reel.flat().map((b) => (b as { callback_data: string }).callback_data)).toEqual(["o:6f1a2b3c", "a:6f1a2b3c", "r:6f1a2b3c", "k:6f1a2b3c"]);
    const d = draftKeyboard(OWN_DRAFT.id).inline_keyboard;
    expect(d.map((row) => row.map((b) => b.text))).toEqual([["📤 Send", "🔁 Regenerate", "❌ Cancel"]]);
    expect(d.flat().map((b) => (b as { callback_data: string }).callback_data)).toEqual(["s:7a7a7a7a", "g:7a7a7a7a", "c:7a7a7a7a"]);
    const r = retrySendKeyboard(OWN_DRAFT.id).inline_keyboard;
    expect(r).toEqual([[{ text: "🔁 Retry send", callback_data: "y:7a7a7a7a" }]]);
  });
});

describe("resolveOwnedTarget", () => {
  it("returns null when the chat has no session", async () => {
    const store = fakeStore();
    expect(await resolveOwnedTarget("555555555", "o:6f1a2b3c", store)).toBeNull();
    // No row lookups happen without a session.
    expect(store.calls.some((c) => c.startsWith("message:") || c.startsWith("draft:"))).toBe(false);
  });

  it("returns null for malformed callback data without touching the store", async () => {
    const store = fakeStore();
    expect(await resolveOwnedTarget(CHAT, undefined, store)).toBeNull();
    expect(await resolveOwnedTarget(CHAT, "garbage", store)).toBeNull();
    expect(await resolveOwnedTarget(CHAT, "o:6F1A2B3C", store)).toBeNull();
    expect(store.calls).toEqual([]);
  });

  it("returns null when the message belongs to another user (foreign callback → Not available)", async () => {
    const store = fakeStore();
    expect(await resolveOwnedTarget(CHAT, encodeCallback("o", FOREIGN_MESSAGE.id), store)).toBeNull();
    expect(await resolveOwnedTarget(CHAT, encodeCallback("r", FOREIGN_MESSAGE.id), store)).toBeNull();
    // The lookup was scoped by the session's user, not by the row's owner.
    expect(store.calls).toContain(`message:abcdef12:${USER}`);
  });

  it("returns null when the draft belongs to another user", async () => {
    const store = fakeStore();
    for (const kind of ["s", "g", "c", "y"] as const) {
      expect(await resolveOwnedTarget(CHAT, encodeCallback(kind, FOREIGN_DRAFT.id), store)).toBeNull();
    }
    // …and the same data from the owner's chat resolves.
    const owned = await resolveOwnedTarget(FOREIGN_CHAT, encodeCallback("s", FOREIGN_DRAFT.id), store);
    expect(owned).toMatchObject({ kind: "s", userId: OTHER_USER, draft: { id: FOREIGN_DRAFT.id } });
  });

  it("resolves an owned message to { kind, message }", async () => {
    const store = fakeStore();
    for (const kind of ["o", "a", "r", "k"] as const) {
      const target = await resolveOwnedTarget(CHAT, encodeCallback(kind, MESSAGE.id), store);
      expect(target).not.toBeNull();
      expect(target).toMatchObject({ kind, userId: USER, session: { chat_id: CHAT, user_id: USER }, message: MESSAGE });
      expect(target && "draft" in target).toBe(false);
    }
  });

  it("resolves an owned draft to { kind, draft }", async () => {
    const store = fakeStore();
    for (const kind of ["s", "g", "c", "y"] as const) {
      const target = await resolveOwnedTarget(CHAT, encodeCallback(kind, OWN_DRAFT.id), store);
      expect(target).not.toBeNull();
      expect(target).toMatchObject({ kind, userId: USER, session: { chat_id: CHAT }, draft: OWN_DRAFT });
      expect(target && "message" in target).toBe(false);
    }
  });

  it("accepts numeric-looking chat ids passed as strings and rejects empty ones", async () => {
    const store = fakeStore();
    expect(await resolveOwnedTarget("", "o:6f1a2b3c", store)).toBeNull();
    expect(await resolveOwnedTarget(CHAT, "k:6f1a2b3c", store)).toMatchObject({ kind: "k" });
  });
});
