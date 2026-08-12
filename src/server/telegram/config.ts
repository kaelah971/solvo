export type TelegramConfig = {
  botToken: string | null;
  webhookSecret: string | null;
  allowedDevUserIds: ReadonlySet<string>;
};

export function getTelegramConfig(): TelegramConfig {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
  const rawIds = (process.env.TELEGRAM_ALLOWED_DEV_USER_IDS ?? "").split(",");
  const allowedDevUserIds = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (/^\d+$/.test(id)) {
      allowedDevUserIds.add(id);
    }
  }
  return { botToken, webhookSecret, allowedDevUserIds };
}

export function isAllowedDevelopmentUser(userId: string, config: TelegramConfig): boolean {
  return config.allowedDevUserIds.has(userId);
}
