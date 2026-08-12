/**
 * Structural subset of grammY's Api used by webhook administration. The real
 * `Bot.api` satisfies this shape; tests provide a minimal fake.
 */
export type WebhookAdminApi = {
  setWebhook: (url: string, extra?: Record<string, unknown>) => Promise<unknown>;
  deleteWebhook: (extra?: Record<string, unknown>) => Promise<unknown>;
  getWebhookInfo: () => Promise<{
    url?: string;
    last_error_message?: string;
    pending_update_count?: number;
    allowed_updates?: string[];
  }>;
};

export type WebhookAdminResult = {
  ok: boolean;
  message: string;
  url: string;
};

/**
 * Read-only webhook info, sanitized for logs (never includes the token).
 */
export function summarizeWebhookInfo(info: {
  url?: string;
  last_error_message?: string;
  pending_update_count?: number;
  allowed_updates?: string[];
}): string {
  const parts: string[] = [];
  if (info.url && info.url.length > 0) {
    parts.push(`URL ${info.url}`);
  } else {
    parts.push("NO WEBHOOK (polling mode usable)");
  }
  if (info.last_error_message) {
    parts.push(`last error: ${info.last_error_message}`);
  }
  if (typeof info.pending_update_count === "number" && info.pending_update_count > 0) {
    parts.push(`${info.pending_update_count} pending update(s)`);
  }
  return parts.join(" · ");
}

export function isValidWebhookUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname.length > 0;
}

export type SetWebhookOptions = {
  url: string;
  secretToken: string | null;
};

export async function setTelegramWebhook(
  api: WebhookAdminApi,
  options: SetWebhookOptions,
): Promise<WebhookAdminResult> {
  const url = options.url.trim();
  if (!isValidWebhookUrl(url)) {
    return { ok: false, message: "Webhook URL must be a valid HTTPS URL (https://...).", url: "" };
  }
  await api.setWebhook(url, options.secretToken ? { secret_token: options.secretToken } : {});
  const info = await api.getWebhookInfo();
  const currentUrl = info.url ?? "";
  if (currentUrl === url) {
    return {
      ok: true,
      url: currentUrl,
      message: "Webhook set and verified: " + summarizeWebhookInfo(info),
    };
  }
  return {
    ok: false,
    url: currentUrl,
    message: "Webhook request accepted but verification shows: " + summarizeWebhookInfo(info),
  };
}

export async function clearTelegramWebhook(api: WebhookAdminApi): Promise<WebhookAdminResult> {
  await api.deleteWebhook({ drop_pending_updates: true });
  const info = await api.getWebhookInfo();
  const currentUrl = info.url ?? "";
  if (currentUrl.length === 0) {
    return { ok: true, url: "", message: "Webhook cleared. Polling mode may be used." };
  }
  return { ok: false, url: currentUrl, message: "Webhook still set: " + summarizeWebhookInfo(info) };
}

export async function getWebhookStatus(api: WebhookAdminApi): Promise<WebhookAdminResult> {
  const info = await api.getWebhookInfo();
  return { ok: true, url: info.url ?? "", message: summarizeWebhookInfo(info) };
}
