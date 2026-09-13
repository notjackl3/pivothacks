// Dev B. getDelivery() → the DeliveryConnector Dev A's worker calls. TelegramDelivery when TELEGRAM_BOT_TOKEN is set, else a console fallback.
import type { DeliveryConnector, DeliveryPlan, ReelArtifact, ReplyDraft } from "@reelrelay/shared";
import { getBot } from "./telegram/bot.js";
import { TelegramDelivery } from "./telegram/TelegramDelivery.js";

export class ConsoleDelivery implements DeliveryConnector {
  async pair(): Promise<void> {}
  async sendReel(_target: string, artifact: ReelArtifact): Promise<string> {
    console.log(`[delivery:console] reel for message ${artifact.messageId} (${artifact.renderMode})`);
    return "console";
  }
  async sendDraft(_target: string, draft: ReplyDraft): Promise<string> {
    console.log(`[delivery:console] draft ${draft.id}`);
    return "console";
  }
  async sendInstantCard(_target: string, artifact: ReelArtifact, plan: DeliveryPlan): Promise<string> {
    console.log(`[delivery:console] INSTANT card for message ${artifact.messageId}: ${plan.reasonText}`);
    return "console-instant";
  }
  async sendText(_target: string, text: string): Promise<string> {
    console.log(`[delivery:console] ${text}`);
    return "console-text";
  }
}

let instance: DeliveryConnector | null = null;

export function getDelivery(): DeliveryConnector {
  if (!instance) {
    const bot = getBot();
    if (bot) {
      instance = new TelegramDelivery(bot);
    } else {
      console.log("[delivery] TELEGRAM_BOT_TOKEN not set; using console delivery");
      instance = new ConsoleDelivery();
    }
  }
  return instance;
}
