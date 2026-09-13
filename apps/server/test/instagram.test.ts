import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInstagramSignature } from "../src/connectors/instagram/verify.js";
import { parseInstagramInbounds } from "../src/connectors/instagram/webhook.js";
import { normalizeInstagramPairingCode } from "../src/db/queries/instagram.js";

describe("Instagram infrastructure", () => {
  it("verifies Meta SHA-256 webhook signatures", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const secret = "test-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyInstagramSignature(body, signature, secret)).toBe(true);
    expect(verifyInstagramSignature(`${body}x`, signature, secret)).toBe(false);
    expect(verifyInstagramSignature(body, "sha256=not-hex", secret)).toBe(false);
  });

  it("normalizes messages and quick-reply payloads and ignores echoes", () => {
    expect(parseInstagramInbounds({ object: "instagram", entry: [{ messaging: [
      { sender: { id: "1784" }, message: { text: " ABCD2345 " }, timestamp: 10 },
      { sender: { id: "1784" }, message: { quick_reply: { payload: "ack:123" } } },
      { sender: { id: "bot" }, message: { text: "echo", is_echo: true } },
    ] }] })).toEqual([
      { senderId: "1784", text: "ABCD2345", actionPayload: null, timestamp: 10 },
      { senderId: "1784", text: null, actionPayload: "ack:123", timestamp: null },
    ]);
  });

  it("only accepts unambiguous eight-character pairing codes", () => {
    expect(normalizeInstagramPairingCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normalizeInstagramPairingCode("ABC01234")).toBeNull();
  });
});
