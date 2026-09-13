import type { ComposioSourceState, ComposioSourceStatus, ComposioToolkit } from "@reelrelay/shared";
import { getDb } from "../client.js";

export interface ComposioSourceRow {
  id: string; user_id: string; toolkit: ComposioToolkit; auth_config_id: string;
  connected_account_id: string; trigger_id: string | null; trigger_slug: string;
  status: ComposioSourceStatus; label: string | null; error_detail: string | null;
  created_at: string; updated_at: string;
}

function fail(operation: string, message: string): never {
  throw Object.assign(new Error(`composio_sources.${operation}: ${message}`), { code: "db_error", statusCode: 500 });
}

export function toComposioSourceState(row: ComposioSourceRow): ComposioSourceState {
  return { id: row.id, toolkit: row.toolkit, connectedAccountId: row.connected_account_id, triggerId: row.trigger_id, status: row.status, label: row.label, errorDetail: row.error_detail };
}

export async function upsertComposioSource(input: { userId: string; toolkit: ComposioToolkit; authConfigId: string; connectedAccountId: string; triggerSlug: string }): Promise<ComposioSourceRow> {
  const row = { user_id: input.userId, toolkit: input.toolkit, auth_config_id: input.authConfigId, connected_account_id: input.connectedAccountId, trigger_slug: input.triggerSlug, status: "pending", error_detail: null, updated_at: new Date().toISOString() };
  const { data, error } = await getDb().from("composio_sources").upsert(row, { onConflict: "connected_account_id" }).select("*").single();
  if (error) fail("upsert", error.message);
  return data as ComposioSourceRow;
}

export async function listComposioSources(userId: string): Promise<ComposioSourceRow[]> {
  const { data, error } = await getDb().from("composio_sources").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) fail("list", error.message);
  return (data ?? []) as ComposioSourceRow[];
}

export async function getComposioSourceForUser(id: string, userId: string): Promise<ComposioSourceRow | null> {
  const { data, error } = await getDb().from("composio_sources").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) fail("getForUser", error.message);
  return (data as ComposioSourceRow | null) ?? null;
}

export async function getComposioSourceByAccount(connectedAccountId: string): Promise<ComposioSourceRow | null> {
  const { data, error } = await getDb().from("composio_sources").select("*").eq("connected_account_id", connectedAccountId).maybeSingle();
  if (error) fail("getByAccount", error.message);
  return (data as ComposioSourceRow | null) ?? null;
}

export async function updateComposioSource(id: string, patch: Partial<Pick<ComposioSourceRow, "trigger_id" | "status" | "label" | "error_detail">>): Promise<ComposioSourceRow> {
  const { data, error } = await getDb().from("composio_sources").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) fail("update", error.message);
  return data as ComposioSourceRow;
}

/** Claims a webhook id before side effects. False means Composio retried an event already seen. */
export async function claimComposioEvent(eventId: string, connectedAccountId: string, triggerSlug: string): Promise<boolean> {
  const { error } = await getDb().from("composio_events").insert({ event_id: eventId, connected_account_id: connectedAccountId, trigger_slug: triggerSlug });
  if (!error) return true;
  if (error.code === "23505") return false;
  fail("claimEvent", error.message);
}

export async function finishComposioEvent(eventId: string, errorDetail: string | null = null): Promise<void> {
  const { error } = await getDb().from("composio_events").update({ processed_at: new Date().toISOString(), error_detail: errorDetail }).eq("event_id", eventId);
  if (error) fail("finishEvent", error.message);
}

export async function releaseComposioEvent(eventId: string): Promise<void> {
  const { error } = await getDb().from("composio_events").delete().eq("event_id", eventId).is("processed_at", null);
  if (error) fail("releaseEvent", error.message);
}
