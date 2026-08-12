import { Bot } from "grammy";

import { loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";
import { setTelegramWebhook } from "../src/server/telegram/webhook-admin.ts";
import { serializeBotError } from "../src/server/telegram/safe-logging.ts";

/**
 * Sets (and verifies) the Telegram webhook:
 *
 *   npm run telegram:set-webhook -- --url https://<domain>/api/telegram/webhook
 *
 * Uses TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (when configured).
 * The token is never printed. Idempotent: re-setting the same URL is a no-op.
 */
function parseArgs(argv: string[]): { url: string | null } {
  let url: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url") {
      url = argv[++i] ?? null;
    } else if (token.startsWith("--url=")) {
      url = token.slice("--url=".length);
    }
  }
  return { url };
}

async function main(): Promise<number> {
  const { url } = parseArgs(process.argv.slice(2));
  if (!url) {
    console.error("Missing --url. Usage: npm run telegram:set-webhook -- --url https://<domain>/api/telegram/webhook");
    return 2;
  }

  loadEnvForScript();
  const config = getTelegramConfig();
  if (!config.botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and set it.");
    return 2;
  }

  const bot = new Bot(config.botToken);
  try {
    const result = await setTelegramWebhook(bot.api, {
      url,
      secretToken: config.webhookSecret,
    });
    console.log(result.message);
    return result.ok ? 0 : 2;
  } catch (error) {
    console.error("WEBHOOK SET FAILED");
    console.error(serializeBotError(error, { action: "setWebhook" }));
    return 2;
  }
}

process.exit(await main());
