import type { DeliveryConnector, ReelArtifact, ReplyDraft } from "@reelrelay/shared";

/** Dev B replaces getDelivery() with TelegramDelivery. No message bodies are logged. */
class ConsoleDelivery implements DeliveryConnector {
  async pair(_userId: string, _pairingCode: string): Promise<void> {
    throw new Error("Telegram pairing is not wired yet.");
  }
  async sendReel(target: string, artifact: ReelArtifact): Promise<string> {
    console.info("console delivery (development only)", { messageId: artifact.messageId, mode: artifact.renderMode });
    return `console:${target}:${artifact.messageId}`;
  }
  async sendDraft(_target: string, draft: ReplyDraft): Promise<string> {
    console.info("console draft (development only)", { draftId: draft.id });
    return `console:${draft.id}`;
  }
}
const delivery = new ConsoleDelivery();
export function getDelivery(): DeliveryConnector { return delivery; }
