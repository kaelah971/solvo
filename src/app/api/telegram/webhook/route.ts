import { NextResponse } from "next/server";
import type { Update } from "grammy/types";

import { getTelegramBot } from "../../../../server/telegram/bot.ts";
import { getTelegramConfig } from "../../../../server/telegram/config.ts";
import { verifySecretToken } from "../../../../server/telegram/webhook-secret.ts";
import { serializeBotError } from "../../../../server/telegram/safe-logging.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook entry point. POST only; Telegram updates only.
 * Never used to trigger payments outside Telegram's update pipeline.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const config = getTelegramConfig();
  if (!config.botToken) {
    return NextResponse.json({ error: "Telegram bot is not configured." }, { status: 503 });
  }

  if (config.webhookSecret) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    if (!verifySecretToken(header, config.webhookSecret)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const bot = getTelegramBot();
  if (!bot) {
    return NextResponse.json({ error: "Telegram bot is unavailable (database not configured)." }, { status: 503 });
  }

  const raw = await request.text();
  if (!raw || raw.trim().length === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  let update: Update;
  try {
    update = JSON.parse(raw) as Update;
  } catch {
    return NextResponse.json({ error: "Malformed update" }, { status: 400 });
  }

  try {
    // grammY's handleUpdate throws unless the bot has been initialized
    // (botInfo/getMe). The first webhook hit after a cold start performs the
    // getMe; subsequent updates reuse the cached botInfo. This also exposes
    // ctx.me.username so addressed commands (/batch@SolvoAgentBot) can be
    // normalized safely.
    await bot.init();
    await bot.handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(serializeBotError(error, { updateId: update.update_id }));
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}
