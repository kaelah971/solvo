import { Bot } from "grammy";

import { loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";
import { clearTelegramWebhook, getWebhookStatus } from "../src/server/telegram/webhook-admin.ts";
import { serializeBotError } from "../src/server/telegram/safe-logging.ts";

/**
 * Clears the Telegram webhook (local polling mode):
 *
 *   npm run telegram:clear-webhook
 *
 * The token is never printed. Idempotent: clearing when no webhook is set is
 * a no-op success.
 */
async function main(): Promise<number> {
  loadEnvForScript();
  const config = getTelegramConfig();
  if (!config.botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and set it.");
    return 2;
  }

  const bot = new Bot(config.botToken);
  try {
    const result = await clearTelegramWebhook(bot.api);
    console.log(result.message);
    if (!result.ok) return 2;
    const status = await getWebhookStatus(bot.api);
    console.log("CURRENT: " + status.message);
    return 0;
  } catch (error) {
    console.error("WEBHOOK CLEAR FAILED");
    console.error(serializeBotError(error, { action: "deleteWebhook" }));
    return 2;
  }
}

process.exit(await main());
