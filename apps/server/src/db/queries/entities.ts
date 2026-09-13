// Dev B. Queries for `tracked_entities`.
import type { TrackedEntity } from "@reelrelay/shared";
import { supabase } from "../client.js";

export interface TrackedEntityRow {
  id: string;
  user_id: string;
  connection_id: string;
  entity_type: "person" | "channel";
  external_entity_id: string;
  display_name: string;
  enabled: boolean;
}

const TRACKED_ENTITY_COLUMNS = "id, user_id, connection_id, entity_type, external_entity_id, display_name, enabled";

/** Query files must not import from routes: the api error handler maps any { statusCode, code } error to the envelope. */
function dbError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 500, code: "db_error" });
}

export function toApiTrackedEntity(row: TrackedEntityRow): TrackedEntity {
  return {
    id: row.id,
    connectionId: row.connection_id,
    entityType: row.entity_type,
    externalEntityId: row.external_entity_id,
    displayName: row.display_name,
    enabled: row.enabled,
  };
}

export async function listTrackedEntitiesForUser(userId: string): Promise<TrackedEntityRow[]> {
  const { data, error } = await supabase
    .from("tracked_entities")
    .select(TRACKED_ENTITY_COLUMNS)
    .eq("user_id", userId)
    .order("connection_id", { ascending: true })
    .order("entity_type", { ascending: true })
    .order("display_name", { ascending: true });
  if (error) throw dbError(error.message);
  return (data ?? []) as TrackedEntityRow[];
}

/** Enabled tracked entity for (connection, type, external id) or null. Used by the Slack webhook filter (PLAN.md §4.3 step 6). */
export async function findTrackedEntity(
  connectionId: string,
  entityType: "person" | "channel",
  externalEntityId: string,
): Promise<TrackedEntityRow | null> {
  const { data, error } = await supabase
    .from("tracked_entities")
    .select(TRACKED_ENTITY_COLUMNS)
    .eq("connection_id", connectionId)
    .eq("entity_type", entityType)
    .eq("external_entity_id", externalEntityId)
    .eq("enabled", true)
    .maybeSingle();
  if (error) throw dbError(error.message);
  return (data as TrackedEntityRow | null) ?? null;
}

/** MVP: one tracked entity per (connection, type). Deletes the others, then inserts/updates this one. */
export async function replaceTrackedEntity(input: {
  userId: string;
  connectionId: string;
  entityType: "person" | "channel";
  externalEntityId: string;
  displayName: string;
}): Promise<TrackedEntityRow> {
  const { userId, connectionId, entityType, externalEntityId, displayName } = input;

  // Drop the other entities of this type first: if the upsert below fails, nothing is tracked
  // rather than two senders at once.
  const { error: deleteError } = await supabase
    .from("tracked_entities")
    .delete()
    .eq("user_id", userId)
    .eq("connection_id", connectionId)
    .eq("entity_type", entityType)
    .neq("external_entity_id", externalEntityId);
  if (deleteError) throw dbError(deleteError.message);

  const { data, error } = await supabase
    .from("tracked_entities")
    .upsert(
      {
        user_id: userId,
        connection_id: connectionId,
        entity_type: entityType,
        external_entity_id: externalEntityId,
        display_name: displayName,
        enabled: true,
      },
      { onConflict: "connection_id,entity_type,external_entity_id" },
    )
    .select(TRACKED_ENTITY_COLUMNS)
    .single();
  if (error) throw dbError(error.message);
  return data as TrackedEntityRow;
}
