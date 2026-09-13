import { createHmac, timingSafeEqual } from "node:crypto";

export const COMPOSIO_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export function verifyComposioWebhook(input: { rawBody: string; id?: string; timestamp?: string; signature?: string; secret: string; now?: number }): boolean {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!id || !timestamp || !signature || !secret) return false;
  const timestampMs = /^\d+$/.test(timestamp) ? Number(timestamp) * (timestamp.length <= 10 ? 1000 : 1) : Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > COMPOSIO_WEBHOOK_TOLERANCE_MS) return false;
  const supplied = (signature.includes(",") ? signature.split(",", 2)[1] : signature)?.trim();
  if (!supplied) return false;
  const expected = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
