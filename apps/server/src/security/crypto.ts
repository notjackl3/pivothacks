import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireConfig } from "../config.js";

function keyBytes(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 random bytes encoded as base64.");
  return key;
}
export function encrypt(plaintext: string, encodedKey = requireConfig("TOKEN_ENCRYPTION_KEY")): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(encodedKey), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join(":");
}
export function decrypt(ciphertext: string, encodedKey = requireConfig("TOKEN_ENCRYPTION_KEY")): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token.");
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
  if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !data) throw new Error("Invalid encrypted token.");
  const cipher = createDecipheriv("aes-256-gcm", keyBytes(encodedKey), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
