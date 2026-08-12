export const telegram = {
  /** Central constant for the Telegram bot deep link. Configure when the bot exists. */
  botUrl: process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? "",
};

export const telegramConfigured = telegram.botUrl.trim().length > 0;

/** Public base URL used to build claim links. Server + client safe. */
export const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
