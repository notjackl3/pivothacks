// Dev B. Read-only lookups of `messages` / `reel_artifacts` scoped by user, for the bot handlers and the reply flow.
import { MessageInterpretationSchema, type MessageInterpretation, type NormalizedMessage } from "@reelrelay/shared";
import { supabase } from "../../db/client.js";

export interface StoredMessage {
  id: string;
  userId: string;
  connectionId: string;
  externalMessageId: string;
  externalChannelId: string;
  externalThreadId: string | null;
  senderExternalId: string;
  senderDisplayName: string;
  originalText: string;
  receivedAt: string;
  isMock: boolean;
  provider: "slack" | "mock";
}

/** Raw `messages` row (snake_case) as returned by supabase-js. */
export interface MessageRow {
  id: string;
  user_id: string;
  connection_id: string;
  external_message_id: string;
  external_channel_id: string;
  external_thread_id: string | null;
  sender_external_id: string;
  sender_display_name: string;
  original_text: string;
  received_at: string;
  is_mock: boolean;
  created_at: string;
}

const MESSAGE_COLUMNS =
  "id, user_id, connection_id, external_message_id, external_channel_id, external_thread_id, sender_external_id, sender_display_name, original_text, received_at, is_mock, created_at";

const PREFIX_RE = /^[0-9a-f]{8}$/;

export function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    userId: row.user_id,
    connectionId: row.connection_id,
    externalMessageId: row.external_message_id,
    externalChannelId: row.external_channel_id,
    externalThreadId: row.external_thread_id ?? null,
    senderExternalId: row.sender_external_id,
    senderDisplayName: row.sender_display_name,
    originalText: row.original_text,
    receivedAt: new Date(row.received_at).toISOString(),
    isMock: Boolean(row.is_mock),
    provider: row.is_mock ? "mock" : "slack",
  };
}

export async function getMessageForUser(messageId: string, userId: string): Promise<StoredMessage | null> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("id", messageId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`messages lookup failed: ${error.message}`);
  return data ? toStoredMessage(data as unknown as MessageRow) : null;
}

/** uuid range filter on the 8-char prefix (see db/queries/drafts.ts). Newest wins on collision. */
export async function findMessageByPrefixForUser(prefix8: string, userId: string): Promise<StoredMessage | null> {
  const p = prefix8.toLowerCase();
  if (!PREFIX_RE.test(p)) return null;
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("user_id", userId)
    .gte("id", `${p}-0000-0000-0000-000000000000`)
    .lte("id", `${p}-ffff-ffff-ffff-ffffffffffff`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`messages prefix lookup failed: ${error.message}`);
  const row = (data as unknown as MessageRow[] | null)?.[0];
  return row ? toStoredMessage(row) : null;
}

/** reel_artifacts.interpretation_json for the message, or null when no artifact yet. */
export async function getInterpretationForMessage(messageId: string): Promise<MessageInterpretation | null> {
  const { data, error } = await supabase
    .from("reel_artifacts")
    .select("interpretation_json")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw new Error(`reel_artifacts lookup failed: ${error.message}`);
  const raw = (data as { interpretation_json?: unknown } | null)?.interpretation_json;
  if (!raw || typeof raw !== "object") return null;
  const parsed = MessageInterpretationSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`[telegram:store] interpretation_json for message ${messageId} does not match the schema; ignoring`);
    return null;
  }
  return parsed.data;
}

export function toNormalizedMessage(m: StoredMessage): NormalizedMessage {
  return {
    provider: m.isMock ? "mock" : "slack",
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
