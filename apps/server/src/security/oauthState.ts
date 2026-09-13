import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { requireConfig } from "../config.js";

const StateSchema = z.object({ userId: z.string().uuid(), nonce: z.string().min(20), exp: z.number().int() });
export type OAuthState = z.infer<typeof StateSchema>;
function sign(payload: string, secret: string): Buffer {
  if (secret.length < 32) throw new Error("OAUTH_STATE_SECRET must contain at least 32 random characters.");
  return createHmac("sha256", secret).update(payload).digest();
}
export function createOAuthState(userId: string, secret = requireConfig("OAUTH_STATE_SECRET"), now = Date.now()): string {
  const state = StateSchema.parse({ userId, nonce: randomBytes(24).toString("base64url"), exp: Math.floor(now / 1000) + 600 });
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}
export function verifyOAuthState(encoded: string, secret = requireConfig("OAUTH_STATE_SECRET"), now = Date.now()): OAuthState {
  const [payload, signature, extra] = encoded.split(".");
  if (!payload || !signature || extra || encoded.length > 2048) throw new Error("Invalid OAuth state.");
  const received = Buffer.from(signature, "base64url");
  const expected = sign(payload, secret);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("Invalid OAuth state signature.");
  const state = StateSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (state.exp <= Math.floor(now / 1000) || state.exp > Math.floor(now / 1000) + 600) throw new Error("OAuth state expired or invalid.");
  return state;
}
export const signState = createOAuthState;
export const verifyState = verifyOAuthState;
