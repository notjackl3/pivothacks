import type { FastifyInstance } from "fastify";
import { config } from "../../config.js";
import { consumeInstagramPairingCode } from "../../db/queries/instagram.js";
import { findInstagramConnectionByRecipient, touchInstagramInbound, upsertInstagramConnection } from "../../db/queries/connections.js";
import { InstagramDelivery } from "../../delivery/instagram/InstagramDelivery.js";
import { parseInstagramInbounds } from "../../connectors/instagram/webhook.js";
import { verifyInstagramSignature } from "../../connectors/instagram/verify.js";

export async function registerInstagramWebhook(app: FastifyInstance): Promise<void> {
  app.get("/webhooks/instagram", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    if (query["hub.mode"] !== "subscribe" || !config.INSTAGRAM_VERIFY_TOKEN || query["hub.verify_token"] !== config.INSTAGRAM_VERIFY_TOKEN) {
      return reply.code(403).send("Forbidden");
    }
    return reply.type("text/plain").send(query["hub.challenge"] ?? "");
  });

  app.post("/webhooks/instagram", { config: { rawBody: true } }, async (req, reply) => {
    const rawBody = (req as typeof req & { rawBody?: string }).rawBody ?? "";
    const signature = req.headers["x-hub-signature-256"];
    if (!config.INSTAGRAM_APP_SECRET || !verifyInstagramSignature(rawBody, typeof signature === "string" ? signature : undefined, config.INSTAGRAM_APP_SECRET)) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    const events = parseInstagramInbounds(req.body);
    void reply.code(200).send("EVENT_RECEIVED");
    setImmediate(() => {
      void (async () => {
        for (const event of events) {
          const existing = await findInstagramConnectionByRecipient(event.senderId);
          if (existing) await touchInstagramInbound(event.senderId);
          if (!event.text) continue;
          const pairing = await consumeInstagramPairingCode(event.text);
          if (!pairing) continue;
          await upsertInstagramConnection({ userId: pairing.userId, recipientId: event.senderId });
          await new InstagramDelivery().sendText(event.senderId, "ReelRelay is connected. Your next reel can arrive here.");
        }
      })().catch((error) => app.log.error({ err: error }, "Instagram webhook processing failed"));
    });
  });
}
