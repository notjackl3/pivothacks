import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeSlackSignature, verifySlackHeaders, verifySlackSignature } from "../src/connectors/slack/verify.js";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = JSON.stringify({ type: "event_callback", event: { type: "message", text: "hi" } });
const NOW_MS = 1_757_772_131_000; // 2025-09-13T14:02:11Z
const TS = String(Math.floor(NOW_MS / 1000));

function sign(secret: string, ts: string, body: string): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  it("accepts a correctly signed body inside the tolerance window", () => {
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: sign(SECRET, TS, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(true);
  });

  it("computeSlackSignature matches the independently computed reference", () => {
    expect(computeSlackSignature(SECRET, TS, BODY)).toBe(sign(SECRET, TS, BODY));
  });

  it("rejects when the body was tampered with", () => {
    const tampered = BODY.replace('"hi"', '"bye"');
    expect(verifySlackSignature({ rawBody: tampered, timestamp: TS, signature: sign(SECRET, TS, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
  });

  it("rejects a tampered signature (flipped hex char) and a wrong secret", () => {
    const good = sign(SECRET, TS, BODY);
    const last = good.at(-1) === "0" ? "1" : "0";
    const flipped = good.slice(0, -1) + last;
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: flipped, signingSecret: SECRET, now: NOW_MS })).toBe(false);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: sign("other-secret", TS, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: "v0=abc", signingSecret: SECRET, now: NOW_MS })).toBe(false);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: "", signingSecret: SECRET, now: NOW_MS })).toBe(false);
  });

  it("rejects a stale timestamp (older than 300 s) even with a valid signature", () => {
    const staleTs = String(Math.floor(NOW_MS / 1000) - 301);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: staleTs, signature: sign(SECRET, staleTs, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
    const futureTs = String(Math.floor(NOW_MS / 1000) + 301);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: futureTs, signature: sign(SECRET, futureTs, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
  });

  it("accepts a timestamp exactly at the tolerance boundary and honours a custom tolerance", () => {
    const edgeTs = String(Math.floor(NOW_MS / 1000) - 300);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: edgeTs, signature: sign(SECRET, edgeTs, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(true);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: edgeTs, signature: sign(SECRET, edgeTs, BODY), signingSecret: SECRET, now: NOW_MS, toleranceSec: 60 })).toBe(false);
  });

  it("rejects missing or non-numeric headers", () => {
    expect(verifySlackSignature({ rawBody: BODY, timestamp: undefined, signature: sign(SECRET, TS, BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: undefined, signingSecret: SECRET, now: NOW_MS })).toBe(false);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: "not-a-number", signature: sign(SECRET, "not-a-number", BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
    expect(verifySlackSignature({ rawBody: BODY, timestamp: "", signature: sign(SECRET, "", BODY), signingSecret: SECRET, now: NOW_MS })).toBe(false);
  });

  it("rejects everything when the signing secret is not configured", () => {
    expect(verifySlackSignature({ rawBody: BODY, timestamp: TS, signature: sign("", TS, BODY), signingSecret: "", now: NOW_MS })).toBe(false);
  });
});

describe("verifySlackHeaders", () => {
  it("reads the lowercase Slack headers", () => {
    const headers = { "x-slack-request-timestamp": TS, "x-slack-signature": sign(SECRET, TS, BODY), "content-type": "application/json" };
    expect(verifySlackHeaders(BODY, headers, SECRET, NOW_MS)).toBe(true);
  });

  it("takes the first element when a header arrives as an array", () => {
    const headers = { "x-slack-request-timestamp": [TS, "0"], "x-slack-signature": [sign(SECRET, TS, BODY)] };
    expect(verifySlackHeaders(BODY, headers, SECRET, NOW_MS)).toBe(true);
  });

  it("matches header names case-insensitively", () => {
    const headers = { "X-Slack-Request-Timestamp": TS, "X-Slack-Signature": sign(SECRET, TS, BODY) };
    expect(verifySlackHeaders(BODY, headers, SECRET, NOW_MS)).toBe(true);
  });

  it("rejects when either header is missing", () => {
    expect(verifySlackHeaders(BODY, { "x-slack-signature": sign(SECRET, TS, BODY) }, SECRET, NOW_MS)).toBe(false);
    expect(verifySlackHeaders(BODY, { "x-slack-request-timestamp": TS }, SECRET, NOW_MS)).toBe(false);
    expect(verifySlackHeaders(BODY, {}, SECRET, NOW_MS)).toBe(false);
  });
});
