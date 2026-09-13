import { randomInt } from "node:crypto";
import { supabase } from "../client.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z2-9]{8}$/;
export const INSTAGRAM_PAIRING_TTL_MS = 10 * 60 * 1000;

function dbError(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 500, code: "db_error" });
}

export function generateInstagramPairingCode(): string {
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET.charAt(randomInt(0, ALPHABET.length));
  return code;
}

export function normalizeInstagramPairingCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export async function createInstagramPairingCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInstagramPairingCode();
    const expiresAt = new Date(Date.now() + INSTAGRAM_PAIRING_TTL_MS).toISOString();
    const { error } = await supabase.from("instagram_pairings").insert({ code, user_id: userId, expires_at: expiresAt, used_at: null });
    if (!error) return { code, expiresAt };
    if (error.code !== "23505") throw dbError(`Instagram pairing code creation failed: ${error.message}`);
  }
  throw dbError("Instagram pairing code creation failed after retries");
}

export async function consumeInstagramPairingCode(value: string): Promise<{ userId: string } | null> {
  const code = normalizeInstagramPairingCode(value);
  if (!code) return null;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("instagram_pairings").update({ used_at: now }).eq("code", code).is("used_at", null).gt("expires_at", now).select("user_id");
  if (error) throw dbError(`Instagram pairing code consume failed: ${error.message}`);
  const row = (data as Array<{ user_id: string }> | null)?.[0];
  return row ? { userId: row.user_id } : null;
}
