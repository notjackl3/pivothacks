import { describe, expect, it } from "vitest";
import { createOAuthState, signState, verifyOAuthState, verifyState } from "../src/security/oauthState.js";

// Dev A's API: createOAuthState(userId, secret = requireConfig("OAUTH_STATE_SECRET"), now = Date.now()) and
// verifyOAuthState(encoded, secret?, now?) → { userId, nonce, exp } or THROWS. The secret and clock are always passed
// explicitly here so the tests never depend on OAUTH_STATE_SECRET in the environment.
const SECRET = "test-oauth-state-secret-with-32-plus-chars!!"; // ≥ 32 chars, as the module requires
const OTHER_SECRET = "another-secret-that-is-also-32-chars-long";
const USER_ID = "2f6d8e4a-1c3b-4d5e-9f70-1234567890ab"; // must be a uuid
const NOW = 1_757_772_131_000; // ms, on a whole second
const NOW_SEC = Math.floor(NOW / 1000);
const TTL_SEC = 600;

function decodePayload(state: string): { userId: unknown; nonce: unknown; exp: unknown } {
  const payload = state.split(".")[0] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: unknown; nonce: unknown; exp: unknown };
}

describe("OAuth state", () => {
  it("round-trips the userId and reports exp = now/1000 + 600 (seconds)", () => {
    const state = createOAuthState(USER_ID, SECRET, NOW);
    const verified = verifyOAuthState(state, SECRET, NOW + 1000);
    expect(verified.userId).toBe(USER_ID);
    expect(verified.exp).toBe(NOW_SEC + TTL_SEC);
    expect(typeof verified.nonce).toBe("string");
    expect((verified.nonce as string).length).toBeGreaterThanOrEqual(20);
  });

  it("has the documented shape: base64url(json payload).base64url(hmac-sha256)", () => {
    const state = createOAuthState(USER_ID, SECRET, NOW);
    const parts = state.split(".");
    expect(parts).toHaveLength(2);
    const [payload, signature] = parts;
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(signature ?? "", "base64url")).toHaveLength(32);
    const decoded = decodePayload(state);
    expect(decoded.userId).toBe(USER_ID);
    expect(decoded.exp).toBe(NOW_SEC + TTL_SEC);
    expect(typeof decoded.nonce).toBe("string");
  });

  it("produces a different nonce (hence a different state) each time", () => {
    const a = createOAuthState(USER_ID, SECRET, NOW);
    const b = createOAuthState(USER_ID, SECRET, NOW);
    expect(a).not.toBe(b);
    expect(verifyOAuthState(a, SECRET, NOW).nonce).not.toBe(verifyOAuthState(b, SECRET, NOW).nonce);
  });

  it("rejects an expired state (exp is compared in whole seconds; expiry is inclusive)", () => {
    const state = createOAuthState(USER_ID, SECRET, NOW);
    expect(() => verifyOAuthState(state, SECRET, NOW + (TTL_SEC - 1) * 1000)).not.toThrow();
    expect(() => verifyOAuthState(state, SECRET, NOW + TTL_SEC * 1000)).toThrow(/expired/);
    expect(() => verifyOAuthState(state, SECRET, NOW + TTL_SEC * 1000 + 1)).toThrow(/expired/);
  });

  it("rejects a state whose exp lies more than 10 minutes ahead of the verifier's clock", () => {
    // Minted 60 s "in the future": a forged/oversized exp must not extend the window.
    const state = createOAuthState(USER_ID, SECRET, NOW + 60_000);
    expect(() => verifyOAuthState(state, SECRET, NOW)).toThrow(/expired or invalid/);
    expect(() => verifyOAuthState(state, SECRET, NOW + 60_000)).not.toThrow();
  });

  it("rejects a tampered signature and a signature made with another secret", () => {
    const state = createOAuthState(USER_ID, SECRET, NOW);
    const dot = state.lastIndexOf(".");
    const sig = state.slice(dot + 1);
    const flippedChar = sig.charAt(0) === "A" ? "B" : "A";
    const tampered = `${state.slice(0, dot + 1)}${flippedChar}${sig.slice(1)}`;
    expect(() => verifyOAuthState(tampered, SECRET, NOW)).toThrow(/signature/);
    expect(() => verifyOAuthState(state, OTHER_SECRET, NOW)).toThrow(/signature/);
  });

  it("rejects a tampered payload (different userId with the original signature)", () => {
    const state = createOAuthState(USER_ID, SECRET, NOW);
    const [, sig] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...decodePayload(state), userId: "3a7e9f5b-2d4c-4e6f-8a81-abcdefabcdef" }),
      "utf8",
    ).toString("base64url");
    expect(() => verifyOAuthState(`${forged}.${sig ?? ""}`, SECRET, NOW)).toThrow(/signature/);
  });

  it("throws on malformed strings (never returns a value)", () => {
    for (const bad of ["", "nodot", ".", "a.", ".b", "a.b.c", "not base64url!!.sig", " ", `${"x".repeat(2100)}.sig`]) {
      expect(() => verifyOAuthState(bad, SECRET, NOW)).toThrow();
    }
  });

  it("refuses to mint a state for a non-uuid userId or with a secret shorter than 32 chars", () => {
    expect(() => createOAuthState("someone-else", SECRET, NOW)).toThrow();
    expect(() => createOAuthState(USER_ID, "too-short", NOW)).toThrow(/32/);
    expect(() => verifyOAuthState(createOAuthState(USER_ID, SECRET, NOW), "too-short", NOW)).toThrow(/32/);
  });

  it("exports signState / verifyState as aliases", () => {
    expect(signState).toBe(createOAuthState);
    expect(verifyState).toBe(verifyOAuthState);
  });
});
