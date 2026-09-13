// Dev B. Queries for `connections` (PLAN.md §7). All functions use the service-role client from db/client.ts.
import type { ConnectionMode, ConnectionStatus } from "@reelrelay/shared";
import { supabase } from "../client.js";

export interface ConnectionRow {
  id: string;
  user_id: string;
  provider: "slack" | "telegram" | "instagram" | "whatsapp" | "sms" | "mock";
  external_account_id: string; // slack team_id | telegram chat_id
  external_user_id: string | null; // slack authed user id
  encrypted_access_token: string | null;
  scopes: string[];
  status: ConnectionStatus;
  mode: ConnectionMode;
  created_at: string;
  display_label: string | null;
  last_inbound_at: string | null;
}

const TABLE = "connections";
/** unique (user_id, provider, external_account_id) in 0001_init.sql */
const UNIQUE_KEY = "user_id,provider,external_account_id";

function fail(op: string, error: { message: string }): never {
  throw new Error(`connections.${op}: ${error.message}`);
}

export async function upsertConnection(input: {
  userId: string;
  provider: ConnectionRow["provider"];
  externalAccountId: string;
  externalUserId?: string | null;
  encryptedAccessToken?: string | null;
  scopes?: string[];
  mode?: ConnectionMode;
  displayLabel?: string | null;
  lastInboundAt?: string | null;
}): Promise<ConnectionRow> {
  const row = {
    user_id: input.userId,
    provider: input.provider,
    external_account_id: input.externalAccountId,
    external_user_id: input.externalUserId ?? null,
    encrypted_access_token: input.encryptedAccessToken ?? null,
    scopes: input.scopes ?? [],
    status: "active" as const,
    mode: input.mode ?? "user_token",
    display_label: input.displayLabel ?? null,
    last_inbound_at: input.lastInboundAt ?? null,
  };
  const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: UNIQUE_KEY }).select("*").single();
  if (error) fail("upsertConnection", error);
  return data as ConnectionRow;
}

/** Insert or update the Slack connection for (user, team). Token must already be encrypted. */
export async function upsertSlackConnection(input: {
  userId: string;
  teamId: string;
  authedUserId: string;
  encryptedAccessToken: string;
  scopes: string[];
  mode?: ConnectionMode;
}): Promise<ConnectionRow> {
  const row = {
    user_id: input.userId,
    provider: "slack" as const,
    external_account_id: input.teamId,
    external_user_id: input.authedUserId,
    encrypted_access_token: input.encryptedAccessToken,
    scopes: input.scopes,
    status: "active" as const, // a fresh token clears any earlier 'error'/'revoked'
    mode: input.mode ?? "user_token",
  };
  const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: UNIQUE_KEY }).select("*").single();
  if (error) fail("upsertSlackConnection", error);
  return data as ConnectionRow;
}

/**
 * PLAN.md §4.3 step 5: provider='slack' AND external_account_id=team_id AND external_user_id=authorizations[0].user_id.
 * When authedUserId is null (Slack omitted authorizations, or the authorization is the bot user in bot mode)
 * fall back to the single active connection for the team.
 *
 * Status choice: 'active' rows win. An 'error' row (token flagged revoked by a failed send) is still returned so the
 * caller can tell "connected but broken" from "never connected"; Dev A's persistMessage only stores messages for an
 * 'active' connection, so the webhook reports such an event as no_connection. 'revoked' (explicit disconnect) is never
 * returned.
 */
export async function findSlackConnectionForEvent(teamId: string, authedUserId: string | null): Promise<ConnectionRow | null> {
  let query = supabase.from(TABLE).select("*").eq("provider", "slack").eq("external_account_id", teamId).in("status", ["active", "error"]);
  if (authedUserId) query = query.eq("external_user_id", authedUserId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
  if (error) fail("findSlackConnectionForEvent", error);
  const rows = (data ?? []) as ConnectionRow[];
  return rows.find((r) => r.status === "active") ?? rows[0] ?? null;
}

export async function getConnectionForUser(connectionId: string, userId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", connectionId).eq("user_id", userId).maybeSingle();
  if (error) fail("getConnectionForUser", error);
  return (data as ConnectionRow | null) ?? null;
}

export async function getConnectionById(connectionId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", connectionId).maybeSingle();
  if (error) fail("getConnectionById", error);
  return (data as ConnectionRow | null) ?? null;
}

export async function listConnectionsForUser(userId: string): Promise<ConnectionRow[]> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) fail("listConnectionsForUser", error);
  return (data ?? []) as ConnectionRow[];
}

/** Most recent Slack connection for the user (any status), or null. */
export async function getSlackConnectionForUser(userId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "slack")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("getSlackConnectionForUser", error);
  return (data as ConnectionRow | null) ?? null;
}

/** Telegram chat id (connections.external_account_id where provider='telegram') for the user, or null. Dev A's worker uses this. */
export async function getTelegramChatIdForUser(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("external_account_id")
    .eq("user_id", userId)
    .eq("provider", "telegram")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("getTelegramChatIdForUser", error);
  const chatId = (data as { external_account_id?: string } | null)?.external_account_id;
  return typeof chatId === "string" && chatId.length > 0 ? chatId : null;
}

/** Upsert connections(provider='telegram', external_account_id=chatId) for the user; status back to 'active'. */
export async function upsertTelegramConnection(input: { userId: string; chatId: string }): Promise<ConnectionRow> {
  const row = {
    user_id: input.userId,
    provider: "telegram" as const,
    external_account_id: input.chatId,
    status: "active" as const,
  };
  const { data, error } = await supabase.from(TABLE).upsert(row, { onConflict: UNIQUE_KEY }).select("*").single();
  if (error) fail("upsertTelegramConnection", error);
  return data as ConnectionRow;
}

export async function upsertInstagramConnection(input: {
  userId: string;
  recipientId: string;
  username?: string | null;
  lastInboundAt?: string;
}): Promise<ConnectionRow> {
  return upsertConnection({
    userId: input.userId,
    provider: "instagram",
    externalAccountId: input.recipientId,
    displayLabel: input.username ?? null,
    lastInboundAt: input.lastInboundAt ?? new Date().toISOString(),
  });
}

export async function findInstagramConnectionByRecipient(recipientId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("provider", "instagram").eq("external_account_id", recipientId).eq("status", "active").maybeSingle();
  if (error) fail("findInstagramConnectionByRecipient", error);
  return (data as ConnectionRow | null) ?? null;
}

export async function touchInstagramInbound(recipientId: string, username?: string | null): Promise<void> {
  const patch: Record<string, string> = { last_inbound_at: new Date().toISOString() };
  if (username) patch.display_label = username;
  const { error } = await supabase.from(TABLE).update(patch).eq("provider", "instagram").eq("external_account_id", recipientId);
  if (error) fail("touchInstagramInbound", error);
}

export async function setConnectionStatus(connectionId: string, status: ConnectionStatus): Promise<void> {
  const { error } = await supabase.from(TABLE).update({ status }).eq("id", connectionId);
  if (error) fail("setConnectionStatus", error);
}

/** Deletes the connection (cascades to tracked_entities, messages, …). Returns false when not found for the user. */
export async function deleteConnectionForUser(connectionId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).delete().eq("id", connectionId).eq("user_id", userId).select("id");
  if (error) fail("deleteConnectionForUser", error);
  return Array.isArray(data) && data.length > 0;
}
