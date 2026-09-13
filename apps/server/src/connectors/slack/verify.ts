// Dev B. Slack request signature (PLAN.md §4.3 step 1). Pure; no I/O.
//   |now - X-Slack-Request-Timestamp| ≤ 300 s; HMAC-SHA256(signingSecret, "v0:" + ts + ":" + rawBody) === X-Slack-Signature (timing-safe)
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyInput {
  rawBody: string;
  timestamp: string | undefined; // X-Slack-Request-Timestamp (seconds)
  signature: string | undefined; // X-Slack-Signature ("v0=<hex>")
  signingSecret: string;
  now?: number; // ms since epoch; defaults to Date.now()
  toleranceSec?: number; // defaults to 300
}

const DEFAULT_TOLERANCE_SEC = 300;
const SIGNATURE_VERSION = "v0";
const TIMESTAMP_HEADER = "x-slack-request-timestamp";
const SIGNATURE_HEADER = "x-slack-signature";

/** Computes the `v0=<hex>` signature Slack would send for (timestamp, rawBody). Exported for tests. */
export function computeSlackSignature(signingSecret: string, timestamp: string, rawBody: string): string {
  const hex = createHmac("sha256", signingSecret).update(`${SIGNATURE_VERSION}:${timestamp}:${rawBody}`).digest("hex");
  return `${SIGNATURE_VERSION}=${hex}`;
}

export function verifySlackSignature(input: VerifyInput): boolean {
  const { rawBody, timestamp, signature, signingSecret } = input;
  // A missing secret means the server is misconfigured; never accept in that state.
  if (typeof signingSecret !== "string" || signingSecret.length === 0) return false;
  if (typeof rawBody !== "string") return false;
  if (typeof timestamp !== "string" || typeof signature !== "string") return false;

  // Slack sends integer seconds. Anything else (empty, floats, letters) is rejected before it reaches the HMAC.
  if (!/^\d{1,20}$/.test(timestamp)) return false;
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;

  const nowSec = (input.now ?? Date.now()) / 1000;
  const tolerance = input.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (Math.abs(nowSec - tsSec) > tolerance) return false;

  const expected = computeSlackSignature(signingSecret, timestamp, rawBody);
  const provided = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch; the length itself is not secret.
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  let raw = headers[name];
  if (raw === undefined) {
    // Fastify lowercases header names; tolerate callers that did not.
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    if (key !== undefined) raw = headers[key];
  }
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** Header-map convenience (case-insensitive keys, string | string[] | undefined values). */
export function verifySlackHeaders(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  signingSecret: string,
  now?: number,
): boolean {
  if (!headers || typeof headers !== "object") return false;
  return verifySlackSignature({
    rawBody,
    timestamp: headerValue(headers, TIMESTAMP_HEADER),
    signature: headerValue(headers, SIGNATURE_HEADER),
    signingSecret,
    now,
  });
}
