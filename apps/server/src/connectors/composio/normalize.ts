import type { ComposioToolkit, NormalizedMessage } from "@reelrelay/shared";

export interface ComposioTriggerEnvelope {
  id: string;
  type: string;
  timestamp: string;
  metadata: {
    trigger_slug: string;
    trigger_id?: string;
    connected_account_id: string;
    auth_config_id?: string;
    user_id: string;
  };
  data: Record<string, unknown>;
}

function at(data: unknown, path: string): unknown {
  let value = data;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function firstString(data: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = at(data, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function sender(data: Record<string, unknown>): { id: string; label: string } {
  const id = firstString(data, ["sender.email", "sender.id", "from.email", "from.address", "from", "user", "user_id", "author.id", "contact.wa_id", "wa_id"]) ?? "unknown";
  const label = firstString(data, ["sender.name", "sender.email", "from.name", "from.email", "from.address", "from", "author.name", "profile.name", "contact.profile.name"]) ?? id;
  return { id, label };
}

function content(data: Record<string, unknown>): string | null {
  const subject = firstString(data, ["subject", "message.subject"]);
  const body = firstString(data, [
    "text", "message.text", "message_text", "body", "body.text", "body.content", "message.body", "message.body.text",
    "content", "snippet", "payload.text", "entry.text",
  ]);
  if (!body) return subject;
  return subject && !body.includes(subject) ? `Subject: ${subject}\n\n${body}` : body;
}

export function normalizeComposioTrigger(envelope: ComposioTriggerEnvelope, toolkit: ComposioToolkit, connectionId: string): NormalizedMessage | null {
  const text = content(envelope.data);
  if (!text) return null;
  const from = sender(envelope.data);
  const externalMessageId = firstString(envelope.data, ["message_id", "messageId", "id", "message.id", "ts", "sid"]) ?? envelope.id;
  const externalChannelId = firstString(envelope.data, ["thread_id", "threadId", "channel_id", "channel", "conversation_id", "chat_id", "to"]) ?? toolkit;
  const threadId = firstString(envelope.data, ["thread_id", "threadId", "message.thread_id", "conversation_id"]);
  const dateValue = firstString(envelope.data, ["received_at", "receivedAt", "date", "timestamp"]);
  const parsedDate = dateValue ? new Date(/^\d+$/.test(dateValue) ? Number(dateValue) * (dateValue.length <= 10 ? 1000 : 1) : dateValue) : new Date(envelope.timestamp);
  return {
    provider: toolkit,
    connectionId,
    externalMessageId,
    externalChannelId,
    externalThreadId: threadId,
    senderExternalId: from.id,
    senderDisplayName: from.label,
    text: text.slice(0, 100_000),
    receivedAt: Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
  };
}
