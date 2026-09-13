import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyInstagramSignature(rawBody: string, signature: string | undefined, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const supplied = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}
