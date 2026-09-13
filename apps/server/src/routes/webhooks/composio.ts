import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../../config.js";
import { ComposioToolkitSchema } from "../../connectors/composio/config.js";
import { normalizeComposioTrigger, type ComposioTriggerEnvelope } from "../../connectors/composio/normalize.js";
import { verifyComposioWebhook } from "../../connectors/composio/verify.js";
import { getComposioSourceByAccount, claimComposioEvent, finishComposioEvent, releaseComposioEvent, updateComposioSource } from "../../db/queries/composio.js";
import { upsertConnection } from "../../db/queries/connections.js";
import { persistMessage } from "../../db/queries/messages.js";
import { ensureJob } from "../../db/queries/jobs.js";
import { getQueue } from "../../queue/memoryQueue.js";

const EnvelopeSchema = z.object({
  id: z.string().min(1), type: z.string().min(1), timestamp: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()),
});
const TriggerMetadataSchema = z.object({ trigger_slug: z.string(), trigger_id: z.string().optional(), connected_account_id: z.string(), auth_config_id: z.string().optional(), user_id: z.string() });

export async function registerComposioWebhook(app: FastifyInstance): Promise<void> {
  app.post("/webhooks/composio", { config: { rawBody: true } }, async (req, reply) => {
    const rawBody = (req as typeof req & { rawBody?: string }).rawBody ?? "";
    const header = (name: string) => typeof req.headers[name] === "string" ? req.headers[name] as string : undefined;
    if (!config.COMPOSIO_WEBHOOK_SECRET || !verifyComposioWebhook({ rawBody, id: header("webhook-id"), timestamp: header("webhook-timestamp"), signature: header("webhook-signature"), secret: config.COMPOSIO_WEBHOOK_SECRET })) {
      return reply.code(401).send({ error: "invalid_signature" });
    }
    const parsed = EnvelopeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });
    const connectedAccountId = typeof parsed.data.metadata.connected_account_id === "string" ? parsed.data.metadata.connected_account_id : typeof parsed.data.data.id === "string" ? parsed.data.data.id : null;
    if (!connectedAccountId) return reply.code(202).send({ ignored: "unknown_connection" });
    const source = await getComposioSourceByAccount(connectedAccountId);
    const eventUserId = typeof parsed.data.metadata.user_id === "string" ? parsed.data.metadata.user_id : null;
    if (!source || (eventUserId && source.user_id !== eventUserId)) return reply.code(202).send({ ignored: "unknown_connection" });

    if (parsed.data.type === "composio.connected_account.expired") {
      await updateComposioSource(source.id, { status: "expired", error_detail: "Provider authorization expired. Reconnect this source." });
      return reply.send({ accepted: true });
    }
    if (parsed.data.type !== "composio.trigger.message") return reply.code(202).send({ ignored: "unsupported_event" });
    const metadata = TriggerMetadataSchema.safeParse(parsed.data.metadata);
    if (!metadata.success) return reply.code(400).send({ error: "invalid_trigger_metadata" });
    const envelope = { ...parsed.data, metadata: metadata.data } as ComposioTriggerEnvelope;
    if (envelope.metadata.trigger_slug.toUpperCase() !== source.trigger_slug.toUpperCase()) return reply.code(202).send({ ignored: "unexpected_trigger" });
    if (!await claimComposioEvent(envelope.id, source.connected_account_id, envelope.metadata.trigger_slug)) return reply.send({ duplicate: true });

    try {
      const toolkit = ComposioToolkitSchema.parse(source.toolkit);
      const connection = await upsertConnection({ userId: source.user_id, provider: toolkit === "slack" ? "composio_slack" : toolkit, externalAccountId: source.connected_account_id, displayLabel: source.label });
      const message = normalizeComposioTrigger(envelope, toolkit, connection.id);
      if (!message) {
        await finishComposioEvent(envelope.id, "No supported message text in trigger payload.");
        return reply.code(202).send({ ignored: "no_message_text" });
      }
      const persisted = await persistMessage(source.user_id, message);
      const job = await ensureJob(persisted.message.id);
      if (job.status === "queued") await getQueue().add("generate_reel", { messageId: persisted.message.id });
      await finishComposioEvent(envelope.id);
      return reply.send({ accepted: true, messageId: persisted.message.id });
    } catch (error) {
      await releaseComposioEvent(envelope.id).catch(() => undefined);
      req.log.error({ err: error, composioEventId: envelope.id }, "Composio trigger processing failed");
      return reply.code(500).send({ error: "processing_failed" });
    }
  });
}
