import { createTelegramBot, getDbRepository } from "../src/server/telegram/bot.ts";
import { registerCommandMenu } from "../src/server/telegram/command-menu.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";

/**
 * Local development polling mode. Do NOT run while a webhook is configured
 * for the same bot — Telegram only delivers updates to one endpoint.
 */
async function main(): Promise<number> {
  loadEnvForScript();
  const config = getTelegramConfig();
  if (!config.botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and set it.");
    return 2;
  }
  const repo = getDbRepository();
  if (!repo) {
    console.error("DATABASE_URL is missing. The Telegram bot needs the database.");
    return 2;
  }

  const bot = createTelegramBot(config.botToken, { repo });
  await bot.init();
  console.log(`Polling as @${bot.botInfo.username}`);
  console.log("Development mode: " + (config.allowedDevUserIds.size > 0 ? "ALLOWLIST CONFIGURED (" + config.allowedDevUserIds.size + " user(s))" : "NO ALLOWLIST — real execution unavailable"));
  console.log("All instructions from non-allowlisted users run in SANDBOX (no funds move).");

  const menu = await registerCommandMenu(bot);
  if (menu.ok) {
    console.log("TELEGRAM COMMAND MENU    REGISTERED");
  } else {
    console.error("TELEGRAM COMMAND MENU    REGISTRATION FAILED — menu may be stale");
    for (const error of menu.errors) {
      console.error("  - " + error.split("\n")[0]);
    }
  }

  console.log("Press Ctrl+C to stop.");
  await bot.start();
  return 0;
}

process.exit(await main());
