import type { NormalizedMessage } from "@reelrelay/shared";
import { getDb } from "../client.js";

export type MessageRow = {
  id: string; user_id: string; connection_id: string; external_message_id: string;
  external_channel_id: string; external_thread_id: string | null; sender_external_id: string;
  sender_display_name: string; original_text: string; received_at: string; is_mock: boolean; created_at: string;
};
export async function getMessage(userId: string, messageId: string): Promise<MessageRow | null> {
  const { data, error } = await getDb().from("messages").select("*").eq("user_id", userId).eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data as MessageRow | null;
}
/** Internal worker lookup. Never use this unscoped lookup in an HTTP/callback handler. */
export async function getWorkerMessage(messageId: string): Promise<MessageRow | null> {
  const { data, error } = await getDb().from("messages").select("*").eq("id", messageId).maybeSingle();
  if (error) throw error;
  return data as MessageRow | null;
}
export async function listMessages(userId: string, limit = 50): Promise<MessageRow[]> {
  const { data, error } = await getDb().from("messages").select("*").eq("user_id", userId).order("received_at", { ascending: false }).order("id", { ascending: false }).limit(Math.min(limit, 100));
  if (error) throw error;
  return data as MessageRow[];
}
/** Returns the existing row on duplicate delivery so a missing job can be repaired. */
export async function persistMessage(userId: string, message: NormalizedMessage, isMock = message.provider === "mock"): Promise<{ message: MessageRow; inserted: boolean }> {
  const { data: connection, error: connectionError } = await getDb().from("connections").select("id,provider").eq("id", message.connectionId).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.provider !== message.provider) throw Object.assign(new Error("Connection not available."), { statusCode: 404, code: "NOT_FOUND" });
  const row = {
    user_id: userId, connection_id: message.connectionId, external_message_id: message.externalMessageId,
    external_channel_id: message.externalChannelId, external_thread_id: message.externalThreadId,
    sender_external_id: message.senderExternalId, sender_display_name: message.senderDisplayName,
    original_text: message.text, received_at: message.receivedAt, is_mock: isMock,
  };
  const { data, error } = await getDb().from("messages").upsert(row, { onConflict: "connection_id,external_message_id", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw error;
  if (data) return { message: data as MessageRow, inserted: true };
  const existing = await getDb().from("messages").select("*").eq("user_id", userId).eq("connection_id", message.connectionId).eq("external_message_id", message.externalMessageId).single();
  if (existing.error) throw existing.error;
  return { message: existing.data as MessageRow, inserted: false };
}
export function normalizeStoredMessage(row: MessageRow): NormalizedMessage {
  return { provider: row.is_mock ? "mock" : "slack", connectionId: row.connection_id, externalMessageId: row.external_message_id, externalChannelId: row.external_channel_id, externalThreadId: row.external_thread_id, senderExternalId: row.sender_external_id, senderDisplayName: row.sender_display_name, text: row.original_text, receivedAt: row.received_at };
}
