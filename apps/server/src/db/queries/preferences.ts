// Dev B. Queries for `preferences` and the `users` profile row.
import { ReplyToneSchema, UserPreferencesSchema, type UserPreferences } from "@reelrelay/shared";
import { supabase } from "../client.js";

const PREFERENCE_COLUMNS = "target_language, timezone, reply_tone, quiet_start, quiet_end";

/** Query files must not import from routes: the api error handler maps any { statusCode, code } error to the envelope. */
function dbError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 500, code: "db_error" });
}

/** Mirrors the column defaults in supabase/migrations/0001_init.sql. */
const DEFAULT_PREFERENCES: UserPreferences = UserPreferencesSchema.parse({});

/** Postgres SQLSTATE surfaced by PostgREST when the public.users row is missing. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

interface PreferencesRow {
  target_language: string;
  timezone: string;
  reply_tone: string;
  /** Pivot 03 (migration 0002); null until the migration runs. */
  quiet_start?: string | null;
  quiet_end?: string | null;
}

interface UsersRow {
  id: string;
  email: string | null;
  display_name: string | null;
}

function toApiPreferences(row: PreferencesRow): UserPreferences {
  const tone = ReplyToneSchema.safeParse(row.reply_tone);
  return {
    targetLanguage: row.target_language || DEFAULT_PREFERENCES.targetLanguage,
    timezone: row.timezone || DEFAULT_PREFERENCES.timezone,
    replyTone: tone.success ? tone.data : DEFAULT_PREFERENCES.replyTone,
    quietStart: row.quiet_start || DEFAULT_PREFERENCES.quietStart,
    quietEnd: row.quiet_end || DEFAULT_PREFERENCES.quietEnd,
  };
}

/** Returns preferences, inserting the default row if the signup trigger did not create one. */
export async function getPreferences(userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from("preferences")
    .select(PREFERENCE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw dbError(error.message);
  if (data) return toApiPreferences(data as PreferencesRow);

  // No row yet: persist the defaults. ignoreDuplicates keeps a concurrent first call harmless.
  const { data: inserted, error: insertError } = await supabase
    .from("preferences")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
    .select(PREFERENCE_COLUMNS)
    .maybeSingle();
  if (insertError) {
    // public.users row missing (signup trigger not applied): nothing to persist against, serve the defaults.
    if (insertError.code === PG_FOREIGN_KEY_VIOLATION) return { ...DEFAULT_PREFERENCES };
    throw dbError(insertError.message);
  }
  return inserted ? toApiPreferences(inserted as PreferencesRow) : { ...DEFAULT_PREFERENCES };
}

/** Upserts only the provided keys (plus updated_at) and returns the full preferences object. */
export async function updatePreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
  const row: Record<string, string> = { user_id: userId, updated_at: new Date().toISOString() };
  if (patch.targetLanguage !== undefined) row.target_language = patch.targetLanguage;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.replyTone !== undefined) row.reply_tone = patch.replyTone;
  if (patch.quietStart !== undefined) row.quiet_start = patch.quietStart;
  if (patch.quietEnd !== undefined) row.quiet_end = patch.quietEnd;

  // PostgREST's upsert only writes the columns present in the payload, so absent keys keep their stored
  // values (or take the column defaults when the row is created here).
  const { data, error } = await supabase
    .from("preferences")
    .upsert(row, { onConflict: "user_id" })
    .select(PREFERENCE_COLUMNS)
    .single();
  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) {
      throw dbError("User profile row is missing; apply the signup trigger from supabase/migrations/0001_init.sql");
    }
    throw dbError(error.message);
  }
  return toApiPreferences(data as PreferencesRow);
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
}

/** public.users row. Missing row (trigger not applied) → { id, email: "", displayName: null }. */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const { data, error } = await supabase
    .from("users")
    .select("id, email, display_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw dbError(error.message);
  if (!data) return { id: userId, email: "", displayName: null };
  const row = data as UsersRow;
  return { id: row.id, email: row.email ?? "", displayName: row.display_name ?? null };
}

/** displayName, else the local part of the email, else "Student". Used for "Sign as {{studentName}}" and bot-mode prefix. */
export function studentNameFor(profile: UserProfile): string {
  const display = profile.displayName?.trim();
  if (display) return display;
  const at = profile.email.indexOf("@");
  const local = (at >= 0 ? profile.email.slice(0, at) : profile.email).trim();
  if (local) return local;
  return "Student";
}
