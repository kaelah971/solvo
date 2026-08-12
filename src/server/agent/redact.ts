import { sha256 } from "@noble/hashes/sha2.js";

/**
 * M8 — Agent input redaction and hashing.
 *
 * `raw_text_redacted` preserves enough text for debugging while scrubbing
 * secrets; `input_hash` is a deterministic SHA-256 of the raw input used for
 * idempotency correlation. Neither function stores secrets, and both are
 * pure and deterministic.
 */

const REDACTED = "[REDACTED]";
export const MAX_RAW_TEXT_REDACTED_CHARS = 1000;

const REDACTION_PATTERNS: readonly RegExp[] = [
  // KeeperHub organization keys.
  /kh_[A-Za-z0-9_-]{8,}/g,
  // OpenAI-style keys.
  /sk-[A-Za-z0-9_-]{8,}/g,
  // Telegram bot tokens (numeric:id-shaped).
  /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/g,
  // Authorization bearer tokens.
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi,
  // Postgres connection URLs (credentials live in the URL).
  /postgres(?:ql)?:\/\/\S+/gi,
  // PEM private key blocks.
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // 64-hex private-key-shaped values.
  /0x[0-9a-fA-F]{64}/g,
  // Inline secret assignments for known env names.
  /\b(OPENAI_API_KEY|SOLVO_AGENT_API_KEY|KEEPERHUB_API_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|DATABASE_URL)\s*=\s*\S+/gi,
];

export function redactAgentRawText(raw: string): string {
  let redacted = raw;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  if (redacted.length > MAX_RAW_TEXT_REDACTED_CHARS) {
    redacted = `${redacted.slice(0, MAX_RAW_TEXT_REDACTED_CHARS)}…`;
  }
  return redacted;
}

export function hashAgentInput(raw: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(raw))).toString("hex");
}
