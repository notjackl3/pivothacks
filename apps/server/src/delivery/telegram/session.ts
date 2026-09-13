// Dev B. Callback ownership check (PLAN.md §10): chat_id → telegram_sessions.user_id → the referenced row must belong to that user.
import type { ReplyDraftRecord } from "@reelrelay/shared";
import { isMessageKind, parseCallback, type CallbackKind } from "./keyboards.js";
import { findMessageByPrefixForUser, type StoredMessage } from "./store.js";
import { findDraftByPrefixForUser } from "../../db/queries/drafts.js";
import { getSession, type TelegramSessionRow } from "../../db/queries/telegram.js";

/** Data access the check needs; defaults come from db/queries + store. Injected in tests. */
export interface OwnershipStore {
  getSession(chatId: string): Promise<TelegramSessionRow | null>;
  findMessageByPrefixForUser(prefix8: string, userId: string): Promise<StoredMessage | null>;
  findDraftByPrefixForUser(prefix8: string, userId: string): Promise<ReplyDraftRecord | null>;
}

export type OwnedTarget =
  | { kind: "o" | "a" | "r" | "k"; userId: string; session: TelegramSessionRow; message: StoredMessage }
  | { kind: "s" | "g" | "c" | "y"; userId: string; session: TelegramSessionRow; draft: ReplyDraftRecord };

/**
 * Resolves callback data for a chat. Returns null (→ answerCallbackQuery("Not available")) when the chat has no session,
 * the data is malformed, or the row is not owned by the session's user.
 */
export async function resolveOwnedTarget(
  chatId: string,
  data: string | undefined,
  store: OwnershipStore = defaultOwnershipStore(),
): Promise<OwnedTarget | null> {
  const parsed = parseCallback(data);
  if (!parsed) return null;
  if (!chatId) return null;

  const session = await store.getSession(String(chatId));
  if (!session) return null;
  const userId = session.user_id;

  if (isMessageKind(parsed.kind)) {
    // Every lookup is scoped by the session's user_id, so a foreign row simply does not resolve.
    const message = await store.findMessageByPrefixForUser(parsed.prefix, userId);
    if (!message || message.userId !== userId) return null;
    return { kind: parsed.kind, userId, session, message };
  }

  const draft = await store.findDraftByPrefixForUser(parsed.prefix, userId);
  if (!draft || draft.userId !== userId) return null;
  return { kind: parsed.kind, userId, session, draft };
}

let defaultStore: OwnershipStore | null = null;

export function defaultOwnershipStore(): OwnershipStore {
  if (!defaultStore) {
    defaultStore = { getSession, findMessageByPrefixForUser, findDraftByPrefixForUser };
  }
  return defaultStore;
}

export { type CallbackKind };
