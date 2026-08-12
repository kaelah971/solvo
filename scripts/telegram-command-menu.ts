import { Bot } from "grammy";

import { registerCommandMenu } from "../src/server/telegram/command-menu.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";

/**
 * One-time command-menu bootstrap for deployed/webhook mode.
 *
 * Polling mode registers the menu automatically at startup (telegram:dev).
 * Serverless/webhook deployments should run this explicitly once after
 * deploying, e.g. during release CI:
 *
 *   npm run telegram:commands
 *
 * It only calls setMyCommands — it never starts polling, never touches
 * payments, and is safe to re-run (idempotent).
 */
async function main(): Promise<number> {
  loadEnvForScript();
  const config = getTelegramConfig();
  if (!config.botToken) {
    console.error("TELEGRAM_BOT_TOKEN is missing. Copy .env.example to .env and set it.");
    return 2;
  }

  const bot = new Bot(config.botToken);
  const menu = await registerCommandMenu(bot);
  try {
    await bot.api.close();
  } catch {
    // best-effort cleanup; the underlying token is never logged
  }

  if (menu.ok) {
    console.log("TELEGRAM COMMAND MENU    REGISTERED");
    return 0;
  }
  console.error("TELEGRAM COMMAND MENU    REGISTRATION FAILED — menu may be stale");
  for (const error of menu.errors) {
    console.error("  - " + error.split("\n")[0]);
  }
  return 1;
}

process.exit(await main());
