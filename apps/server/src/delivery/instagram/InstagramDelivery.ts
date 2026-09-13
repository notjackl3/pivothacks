import type { ChannelCapabilities, DeliveryConnector, ReelArtifact, ReplyDraft } from "@reelrelay/shared";
import { config, requireConfig } from "../../config.js";
import { findInstagramConnectionByRecipient } from "../../db/queries/connections.js";
import { signedArtifactUrl } from "../../render/upload.js";

export const INSTAGRAM_WINDOW_MS = 24 * 60 * 60 * 1000;

interface InstagramSendResponse { recipient_id?: string; message_id?: string; error?: { message?: string; code?: number; error_subcode?: number } }

export class InstagramDeliveryError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean, readonly metaCode?: number) {
    super(message);
    this.name = "InstagramDeliveryError";
  }
}

export class InstagramDelivery implements DeliveryConnector {
  readonly provider = "instagram" as const;
  readonly capabilities: ChannelCapabilities = { video: "url", buttons: "quick_reply", maxVideoBytes: 25 * 1024 * 1024, messagingWindowMs: INSTAGRAM_WINDOW_MS };

  async pair(): Promise<void> {
    // Pairing is completed by the Instagram webhook when the user DMs a one-time code.
  }

  private async send(recipientId: string, message: Record<string, unknown>): Promise<string> {
    const accountId = requireConfig("INSTAGRAM_ACCOUNT_ID");
    const token = requireConfig("INSTAGRAM_ACCESS_TOKEN");
    let response: Response;
    try {
      response = await fetch(`https://graph.instagram.com/${config.INSTAGRAM_API_VERSION}/${encodeURIComponent(accountId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: { id: recipientId }, message }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new InstagramDeliveryError(error instanceof Error ? error.message : "Instagram network error", "INSTAGRAM_NETWORK", true);
    }
    const body = await response.json().catch(() => ({})) as InstagramSendResponse;
    if (!response.ok || body.error) {
      const metaCode = body.error?.code;
      const stable = response.status === 400 || metaCode === 9 || metaCode === 10 || metaCode === 190;
      throw new InstagramDeliveryError(body.error?.message ?? `Instagram returned HTTP ${response.status}`, stable ? "INSTAGRAM_REJECTED" : "INSTAGRAM_NETWORK", !stable, metaCode);
    }
    if (!body.message_id) throw new InstagramDeliveryError("Instagram did not return a message id", "INSTAGRAM_INVALID_RESPONSE", false);
    return body.message_id;
  }

  async sendText(recipientId: string, text: string, quickReplies?: Array<{ title: string; payload: string }>): Promise<string> {
    return this.send(recipientId, {
      text,
      ...(quickReplies?.length ? { quick_replies: quickReplies.map((item) => ({ content_type: "text", title: item.title, payload: item.payload })) } : {}),
    });
  }

  async sendReel(recipientId: string, artifact: ReelArtifact): Promise<string> {
    const connection = await findInstagramConnectionByRecipient(recipientId);
    const lastInbound = connection?.last_inbound_at ? Date.parse(connection.last_inbound_at) : 0;
    if (!connection || !Number.isFinite(lastInbound) || Date.now() - lastInbound >= INSTAGRAM_WINDOW_MS) {
      throw new InstagramDeliveryError("The Instagram messaging window is closed. Ask the user to DM the bot again.", "INSTAGRAM_WINDOW_CLOSED", false);
    }

    let mediaMessageId: string | null = null;
    if (artifact.storagePath && artifact.renderMode !== "text_only") {
      const url = await signedArtifactUrl(artifact.storagePath);
      if (url) mediaMessageId = await this.send(recipientId, { attachment: { type: "video", payload: { url } } });
    }
    const title = artifact.error ? `⚠️ ${artifact.error.message}` : artifact.interpretation.shortTitle;
    const summary = `${title}\n\n${artifact.interpretation.hook}`.slice(0, 950);
    const textMessageId = await this.sendText(recipientId, summary, [
      { title: "📄 Original", payload: `orig:${artifact.messageId}` },
      { title: "✅ Actions", payload: `acts:${artifact.messageId}` },
      { title: "✍️ Reply", payload: `reply:${artifact.messageId}` },
      { title: "👍 Got it", payload: `ack:${artifact.messageId}` },
    ]);
    return mediaMessageId ?? textMessageId;
  }

  async sendDraft(recipientId: string, draft: ReplyDraft): Promise<string> {
    return this.sendText(recipientId, `Review this reply:\n\n${draft.draftEnglish}`, [
      { title: "📤 Send", payload: `send:${draft.id}` },
      { title: "🔁 Regenerate", payload: `regen:${draft.id}` },
      { title: "❌ Cancel", payload: `cancel:${draft.id}` },
    ]);
  }
}
