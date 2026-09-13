// Dev B. getDelivery() → the DeliveryConnector Dev A's worker calls. TelegramDelivery when TELEGRAM_BOT_TOKEN is set, else a console fallback.
import type { DeliveryConnector, ReelArtifact, ReplyDraft } from "@reelrelay/shared";
import { getBot } from "./telegram/bot.js";
import { TelegramDelivery } from "./telegram/TelegramDelivery.js";
import { InstagramDelivery } from "./instagram/InstagramDelivery.js";

export class ConsoleDelivery implements DeliveryConnector {
  readonly provider = "console" as const;
  async pair(): Promise<void> {}
  async sendReel(_target: string, artifact: ReelArtifact): Promise<string> {
    console.log(`[delivery:console] reel for message ${artifact.messageId} (${artifact.renderMode})`);
    return "console";
  }
  async sendDraft(_target: string, draft: ReplyDraft): Promise<string> {
    console.log(`[delivery:console] draft ${draft.id}`);
    return "console";
  }
}

const instagram = new InstagramDelivery();

class RoutedDelivery implements DeliveryConnector {
  async pair(userId: string, pairingCode: string): Promise<void> { await getTelegramOrConsole().pair(userId, pairingCode); }
  async sendReel(target: string, artifact: ReelArtifact): Promise<string> {
    if (target.startsWith("instagram:")) return instagram.sendReel(target.slice("instagram:".length), artifact);
    return getTelegramOrConsole().sendReel(target.replace(/^telegram:/, ""), artifact);
  }
  async sendDraft(target: string, draft: ReplyDraft): Promise<string> {
    if (target.startsWith("instagram:")) return instagram.sendDraft(target.slice("instagram:".length), draft);
    return getTelegramOrConsole().sendDraft(target.replace(/^telegram:/, ""), draft);
  }
}

let instance: DeliveryConnector | null = null;
let routed: DeliveryConnector | null = null;

function getTelegramOrConsole(): DeliveryConnector {
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

export function getDelivery(): DeliveryConnector {
  return routed ??= new RoutedDelivery();
}

export function getDeliveryFor(provider: "instagram" | "telegram"): DeliveryConnector {
  return provider === "instagram" ? instagram : getTelegramOrConsole();
}
