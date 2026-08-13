/**
 * Fallback bot username used to normalize addressed commands such as
 * `/pay@SolvoAgentBot` in production. Address parsing must never depend on a
 * network call (`getMe`) being available at update time, so the username is
 * resolved from config with this documented default.
 */
export const DEFAULT_BOT_USERNAME = "SolvoAgentBot";

export type TelegramConfig = {
  botToken: string | null;
  webhookSecret: string | null;
  /** Bot username (case-insensitive) for addressed command normalization. */
  botUsername: string | null;
  allowedDevUserIds: ReadonlySet<string>;
};

export function getTelegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() || null;
  const rawIds = (process.env.TELEGRAM_ALLOWED_DEV_USER_IDS ?? "").split(",");
  const allowedDevUserIds = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (/^\d+$/.test(id)) {
      allowedDevUserIds.add(id);
    }
  }
  return { botToken, webhookSecret, botUsername, allowedDevUserIds };
}

export function isAllowedDevelopmentUser(userId: string, config: TelegramConfig): boolean {
  return config.allowedDevUserIds.has(userId);
}
