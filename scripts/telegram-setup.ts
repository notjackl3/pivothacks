// One-shot check for the Telegram bot. Run after pasting TELEGRAM_BOT_TOKEN into .env:  pnpm telegram:check
// Validates the token, fixes TELEGRAM_BOT_USERNAME hints, registers /start and /help, and clears any webhook so long polling works.
import { pathToFileURL } from "node:url";
import { config } from "../apps/server/src/config.js";

type TelegramResponse<T> = { ok: true; result: T } | { ok: false; description: string };

async function call<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(15000),
  });
  const json = (await response.json()) as TelegramResponse<T>;
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

export async function checkTelegram(): Promise<void> {
  const token = (config.TELEGRAM_BOT_TOKEN ?? "").trim();
  if (!token || token.toLowerCase().includes("placeholder")) {
    throw new Error("TELEGRAM_BOT_TOKEN is empty. Create a bot with @BotFather (/newbot) and paste the token into .env.");
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error("TELEGRAM_BOT_TOKEN does not look like a BotFather token (expected <digits>:<35 chars>).");
  }

  const me = await call<{ id: number; username: string; first_name: string }>(token, "getMe");
  console.info(`✅ token valid: @${me.username} (${me.first_name}, id ${me.id})`);

  if (config.TELEGRAM_BOT_USERNAME !== me.username) {
    console.warn(`⚠️  TELEGRAM_BOT_USERNAME is "${config.TELEGRAM_BOT_USERNAME}" but the bot is @${me.username}. Set TELEGRAM_BOT_USERNAME=${me.username} in .env (the Setup page's deep link uses it).`);
  } else {
    console.info(`✅ TELEGRAM_BOT_USERNAME matches`);
  }

  const webhook = await call<{ url: string; pending_update_count: number }>(token, "getWebhookInfo");
  if (webhook.url) {
    await call(token, "deleteWebhook", { drop_pending_updates: false });
    console.info(`✅ removed webhook ${webhook.url} (the server uses long polling)`);
  } else {
    console.info(`✅ no webhook set (long polling is free to run)`);
  }

  await call(token, "setMyCommands", {
    commands: [
      { command: "start", description: "Pair this chat with the code from the Setup page" },
      { command: "help", description: "What the buttons under each reel do" },
    ],
  });
  await call(token, "setMyShortDescription", { short_description: "Slack messages as short reels you can understand at a glance." });
  console.info(`✅ /start and /help registered`);

  console.info("\nNext:");
  console.info("  1. pnpm dev  →  server log shows `telegram: polling as @" + me.username + "`");
  console.info("  2. Web → Setup → Telegram card → Get pairing code → Open Telegram → tap Start");
  console.info("  3. pnpm demo:inject professor_deadline  →  the instant card + reel land in the chat");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkTelegram().catch((error: unknown) => {
    console.error(`❌ ${error instanceof Error ? error.message : "Telegram check failed."}`);
    process.exitCode = 1;
  });
}
