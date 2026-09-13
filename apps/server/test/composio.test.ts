import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyComposioWebhook } from "../src/connectors/composio/verify.js";
import { normalizeComposioTrigger, type ComposioTriggerEnvelope } from "../src/connectors/composio/normalize.js";

function envelope(data: Record<string, unknown>): ComposioTriggerEnvelope {
  return { id: "msg_event_1", type: "composio.trigger.message", timestamp: "2026-09-13T16:00:00.000Z", metadata: { trigger_slug: "TEST", connected_account_id: "ca_1", user_id: "user_1" }, data };
}

describe("Composio inbound infrastructure", () => {
  it("verifies Standard Webhooks signatures and rejects stale deliveries", () => {
    const rawBody = JSON.stringify({ id: "msg_1" });
    const id = "msg_1"; const timestamp = "1789315200"; const secret = "whsec_test";
    const signature = createHmac("sha256", secret).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
    expect(verifyComposioWebhook({ rawBody, id, timestamp, signature: `v1,${signature}`, secret, now: 1789315200_000 })).toBe(true);
    expect(verifyComposioWebhook({ rawBody, id, timestamp, signature, secret, now: 1789315801_000 })).toBe(false);
  });

  it("normalizes Gmail subject, body and sender", () => {
    const result = normalizeComposioTrigger(envelope({ message_id: "mail_1", thread_id: "thread_1", subject: "Tuition deadline", message_text: "Pay by Friday", sender: { name: "Registrar", email: "registrar@example.edu" } }), "gmail", "00000000-0000-4000-8000-000000000001");
    expect(result).toMatchObject({ provider: "gmail", externalMessageId: "mail_1", externalThreadId: "thread_1", senderExternalId: "registrar@example.edu", senderDisplayName: "Registrar", text: "Subject: Tuition deadline\n\nPay by Friday" });
  });

  it("normalizes Slack and WhatsApp trigger payloads", () => {
    expect(normalizeComposioTrigger(envelope({ ts: "123.4", channel: "D1", user: "U1", text: "Office moved" }), "slack", "00000000-0000-4000-8000-000000000001")).toMatchObject({ provider: "slack", externalChannelId: "D1", senderExternalId: "U1", text: "Office moved" });
    expect(normalizeComposioTrigger(envelope({ id: "wamid.1", from: "+14165550100", body: "Lease inspection Tuesday" }), "whatsapp", "00000000-0000-4000-8000-000000000001")).toMatchObject({ provider: "whatsapp", senderExternalId: "+14165550100", text: "Lease inspection Tuesday" });
  });
});
