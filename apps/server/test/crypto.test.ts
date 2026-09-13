import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "../src/security/crypto.js";
import { createOAuthState, verifyOAuthState } from "../src/security/oauthState.js";

describe("provider token encryption", () => {
  it("round-trips with a fresh nonce on every encryption", () => {
    const key = randomBytes(32).toString("base64");
    const first = encrypt("synthetic-provider-token", key);
    expect(decrypt(first, key)).toBe("synthetic-provider-token");
    expect(encrypt("synthetic-provider-token", key)).not.toBe(first);
  });
  it("rejects modified ciphertext and the wrong key", () => {
    const key = randomBytes(32).toString("base64");
    const ciphertext = encrypt("synthetic-provider-token", key);
    const pieces = ciphertext.split(":");
    const modified = Buffer.from(pieces[2]!, "base64"); modified[0] = modified[0]! ^ 1;
    pieces[2] = modified.toString("base64");
    expect(() => decrypt(pieces.join(":"), key)).toThrow();
    expect(() => decrypt(ciphertext, randomBytes(32).toString("base64"))).toThrow();
  });
});
describe("OAuth handoff state", () => {
  const secret = "test-only-state-secret-with-32-characters";
  const userId = "00000000-0000-4000-8000-000000000001";
  it("round-trips the user identity and expires after ten minutes", () => {
    const now = Date.now();
    const state = createOAuthState(userId, secret, now);
    expect(verifyOAuthState(state, secret, now).userId).toBe(userId);
    expect(() => verifyOAuthState(state, secret, now + 600001)).toThrow(/expired/);
  });
  it("rejects tampering and the wrong signing secret", () => {
    const state = createOAuthState(userId, secret);
    expect(() => verifyOAuthState(`${state}a`, secret)).toThrow();
    expect(() => verifyOAuthState(state, `${secret}-other`)).toThrow();
  });
});
