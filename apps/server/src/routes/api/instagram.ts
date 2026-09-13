import type { FastifyInstance } from "fastify";
import type { InstagramPairingCodeResponse } from "@reelrelay/shared";
import { config, requireConfig } from "../../config.js";
import { requireUser } from "../../auth/requireUser.js";
import { createInstagramPairingCode } from "../../db/queries/instagram.js";

export async function registerInstagramRoutes(api: FastifyInstance): Promise<void> {
  api.post("/api/instagram/pairing-code", async (req) => {
    const userId = await requireUser(req);
    const username = requireConfig("INSTAGRAM_USERNAME").replace(/^@/, "");
    requireConfig("INSTAGRAM_ACCOUNT_ID");
    requireConfig("INSTAGRAM_ACCESS_TOKEN");
    const { code, expiresAt } = await createInstagramPairingCode(userId);
    return { code, expiresAt, deepLink: `https://ig.me/m/${encodeURIComponent(username)}` } satisfies InstagramPairingCodeResponse;
  });

  api.get("/api/instagram/configured", async (req) => {
    await requireUser(req);
    return { configured: Boolean(config.INSTAGRAM_ACCOUNT_ID && config.INSTAGRAM_ACCESS_TOKEN && config.INSTAGRAM_APP_SECRET && config.INSTAGRAM_VERIFY_TOKEN && config.INSTAGRAM_USERNAME) };
  });
}
