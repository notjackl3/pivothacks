// Dev B. Inline keyboards + callback data codec (PLAN.md §10). Callback data ≤ 64 bytes: `<kind>:<id8>`.
import type { InlineKeyboardMarkup } from "telegraf/types";

export type MessageCallbackKind = "o" | "a" | "r" | "k"; // Original, Actions, Reply, Got it
export type DraftCallbackKind = "s" | "g" | "c" | "y"; // Send, Regenerate, Cancel, retrY send
export type CallbackKind = MessageCallbackKind | DraftCallbackKind;

export const MESSAGE_KINDS: readonly MessageCallbackKind[] = ["o", "a", "r", "k"];
export const DRAFT_KINDS: readonly DraftCallbackKind[] = ["s", "g", "c", "y"];

const CALLBACK_RE = /^([oarksgcy]):([0-9a-f]{8})$/;

export function isMessageKind(kind: CallbackKind): kind is MessageCallbackKind {
  return (MESSAGE_KINDS as readonly string[]).includes(kind);
}

export function isDraftKind(kind: CallbackKind): kind is DraftCallbackKind {
  return (DRAFT_KINDS as readonly string[]).includes(kind);
}

/** First 8 hex chars of a uuid (lowercase). */
export function idPrefix(uuid: string): string {
  return uuid.trim().slice(0, 8).toLowerCase();
}

export function encodeCallback(kind: CallbackKind, uuid: string): string {
  return `${kind}:${idPrefix(uuid)}`;
}

/** "r:6f1a2b3c" → { kind: "r", prefix: "6f1a2b3c" }; anything else → null. */
export function parseCallback(data: string | undefined): { kind: CallbackKind; prefix: string } | null {
  if (typeof data !== "string") return null;
  const m = CALLBACK_RE.exec(data);
  const kind = m?.[1];
  const prefix = m?.[2];
  if (!kind || !prefix) return null;
  return { kind: kind as CallbackKind, prefix };
}

function button(text: string, kind: CallbackKind, uuid: string): { text: string; callback_data: string } {
  return { text, callback_data: encodeCallback(kind, uuid) };
}

/** [📄 Original] [✅ Actions] / [✍️ Reply] [👍 Got it] */
export function reelKeyboard(messageId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button("📄 Original", "o", messageId), button("✅ Actions", "a", messageId)],
      [button("✍️ Reply", "r", messageId), button("👍 Got it", "k", messageId)],
    ],
  };
}

/** [📤 Send] [🔁 Regenerate] [❌ Cancel] */
export function draftKeyboard(draftId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [button("📤 Send", "s", draftId), button("🔁 Regenerate", "g", draftId), button("❌ Cancel", "c", draftId)],
    ],
  };
}

/** [🔁 Retry send] — for failed / send_uncertain drafts. */
export function retrySendKeyboard(draftId: string): InlineKeyboardMarkup {
  return { inline_keyboard: [[button("🔁 Retry send", "y", draftId)]] };
}
