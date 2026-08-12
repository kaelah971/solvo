/**
 * Secret-safe error serialization for Telegram error paths.
 *
 * The full grammY Context / Api objects must NEVER be logged or serialized:
 * `ctx.api` carries `token`, and a raw error dump of a BotError contains the
 * whole context. Everything that reaches the log goes through `redactSecrets`
 * first, which scrubs the configured bot token, the Telegram bot-token shape,
 * credentials-style strings, and other configured secrets by pattern.
 */

const TELEGRAM_TOKEN_PATTERN = /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-]+/gi;
const DATABASE_URL_PATTERN = /(postgres(?:ql)?:\/\/)[^\s"'`]+/gi;
const KEEPERHUB_KEY_PATTERN = /\bkh_[A-Za-z0-9_-]{8,}\b/g;

function configuredSecrets(): string[] {
  const secrets: string[] = [];
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && token.length > 5) secrets.push(token);
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (webhookSecret && webhookSecret.length > 5) secrets.push(webhookSecret);
  const apiKey = process.env.KEEPERHUB_API_KEY;
  if (apiKey && apiKey.length > 5) secrets.push(apiKey);
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.length > 5) secrets.push(dbUrl);
  return secrets;
}

/**
 * Scrubs configured secrets (exact values) and well-known secret patterns
 * from any text before it is written to logs or error output.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of configuredSecrets()) {
    out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(TELEGRAM_TOKEN_PATTERN, "[REDACTED:BOT_TOKEN]");
  out = out.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  out = out.replace(DATABASE_URL_PATTERN, "$1[REDACTED]");
  out = out.replace(KEEPERHUB_KEY_PATTERN, "kh_[REDACTED]");
  return out;
}

export type SafeErrorContext = {
  updateId?: number | null;
  action?: string | null;
  payoutId?: string | null;
};

function extractField(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (key in record) return record[key];
  }
  return undefined;
}

/**
 * Builds a single sanitized, single-line-safe log message from an unknown
 * error. Only safe scalar fields are extracted: never the Context or Api
 * objects themselves.
 */
export function serializeBotError(
  error: unknown,
  context: SafeErrorContext = {},
): string {
  const name = error instanceof Error ? error.name : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error);

  let method: string | null = null;
  let errorCode: string | null = null;
  let description: string | null = null;
  if (error !== null && typeof error === "object") {
    const methodValue = extractField(error, "method");
    if (typeof methodValue === "string") method = methodValue;
    const onValue = extractField(error, "on");
    if (typeof onValue === "string") method = method ?? onValue;
    const codeValue = extractField(error, "error_code");
    if (typeof codeValue === "number" || typeof codeValue === "string") errorCode = String(codeValue);
    const descriptionValue = extractField(error, "description");
    if (typeof descriptionValue === "string") description = descriptionValue;
  }

  const stack = error instanceof Error && error.stack ? error.stack : null;
  const safeStack = stack ? redactSecrets(stack).split("\n").slice(0, 6).join("\n") : null;

  const lines: string[] = [];
  lines.push(`bot error: ${redactSecrets(name)}: ${redactSecrets(rawMessage)}`);
  if (method) lines.push(`method: ${redactSecrets(method)}`);
  if (errorCode) lines.push(`error_code: ${redactSecrets(errorCode)}`);
  if (description) lines.push(`description: ${redactSecrets(description)}`);
  if (context.updateId !== undefined && context.updateId !== null) {
    lines.push(`update_id: ${context.updateId}`);
  }
  if (context.action) lines.push(`callback_action: ${context.action}`);
  if (context.payoutId) lines.push(`payout_id: ${context.payoutId}`);
  if (safeStack) lines.push(`stack:\n${safeStack}`);
  return lines.join("\n");
}
