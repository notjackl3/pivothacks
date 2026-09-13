// Dev B. Queries for `telegram_pairings` and `telegram_sessions`.
import { randomInt } from "node:crypto";
import { supabase } from "../client.js";

/** Query files must not import from routes; a coded error lets the API scope's handler map it to a 500 envelope. */
function dbError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 500, code: "db_error" });
}

export interface TelegramSessionRow {
  chat_id: string;
  user_id: string;
  state: "idle" | "awaiting_reply";
  active_message_id: string | null;
  updated_at: string;
}

/** Unambiguous alphabet: no 0/O, 1/I. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RE = /^[A-Z2-9]{8}$/;

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET.charAt(randomInt(0, CODE_ALPHABET.length));
  }
  return code;
}

/** Normalizes user input: trims, uppercases, and maps the ambiguous glyphs the alphabet excludes (0→O is not in the alphabet, so 0/O → nothing). */
export function normalizePairingCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Inserts a one-time code (8 chars, unambiguous alphabet), valid 10 minutes. */
export async function createPairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  let lastError: string | null = null;
  // The code space is 32^8; a collision is practically impossible, but the PK makes it a hard failure, so retry a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
    const { error } = await supabase.from("telegram_pairings").insert({ code, user_id: userId, expires_at: expiresAt, used_at: null });
    if (!error) return { code, expiresAt };
    lastError = error.message;
    if (error.code !== "23505") break; // not a unique violation → do not retry
  }
  throw dbError(`could not create pairing code: ${lastError ?? "unknown error"}`);
}

/** Atomic: UPDATE telegram_pairings SET used_at=now() WHERE code=$1 AND used_at IS NULL AND expires_at > now() RETURNING user_id. */
export async function consumePairingCode(code: string): Promise<{ userId: string } | null> {
  const normalized = normalizePairingCode(code);
  if (!normalized) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("telegram_pairings")
    .update({ used_at: now })
    .eq("code", normalized)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id");
  if (error) throw dbError(`pairing code consume failed: ${error.message}`);
  const row = (data as { user_id: string }[] | null)?.[0];
  return row ? { userId: row.user_id } : null;
}

export async function upsertSession(chatId: string, userId: string): Promise<TelegramSessionRow> {
  const row = {
    chat_id: String(chatId),
    user_id: userId,
    state: "idle" as const,
    active_message_id: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("telegram_sessions").upsert(row, { onConflict: "chat_id" }).select("*").single();
  if (error) throw dbError(`telegram session upsert failed: ${error.message}`);
  return data as TelegramSessionRow;
}

export async function getSession(chatId: string): Promise<TelegramSessionRow | null> {
  const { data, error } = await supabase.from("telegram_sessions").select("*").eq("chat_id", String(chatId)).maybeSingle();
  if (error) throw dbError(`telegram session lookup failed: ${error.message}`);
  return (data as TelegramSessionRow | null) ?? null;
}

export async function setSessionState(
  chatId: string,
  state: "idle" | "awaiting_reply",
  activeMessageId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("telegram_sessions")
    .update({ state, active_message_id: activeMessageId, updated_at: new Date().toISOString() })
    .eq("chat_id", String(chatId));
  if (error) throw dbError(`telegram session update failed: ${error.message}`);
}

/** Every session for a user (a user normally has one chat, but the same account may pair from two devices). */
export async function listSessionsForUser(userId: string): Promise<TelegramSessionRow[]> {
  const { data, error } = await supabase.from("telegram_sessions").select("*").eq("user_id", userId);
  if (error) throw dbError(`telegram session list failed: ${error.message}`);
  return (data as TelegramSessionRow[] | null) ?? [];
}
