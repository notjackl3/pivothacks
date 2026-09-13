// Dev B. POST /api/telegram/pairing-code → { code, expiresAt, deepLink }.
import type { FastifyInstance } from "fastify";
import type { PairingCodeResponse } from "@reelrelay/shared";
import { requireUser } from "../../auth/requireUser.js";
import { config } from "../../config.js";
import { createPairingCode } from "../../db/queries/telegram.js";

export function telegramDeepLink(code: string): string {
  return `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(code)}`;
}

export async function registerTelegramRoutes(api: FastifyInstance): Promise<void> {
  api.post("/api/telegram/pairing-code", async (req) => {
    const userId = await requireUser(req);
    const { code, expiresAt } = await createPairingCode(userId);
    const body: PairingCodeResponse = { code, expiresAt, deepLink: telegramDeepLink(code) };
    return body;
  });
}
