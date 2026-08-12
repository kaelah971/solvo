import { createHash, randomBytes } from "node:crypto";

/**
 * Secure one-time claim tokens.
 *
 * - raw token: 192 bits of CSPRNG entropy, base64url (32 chars) — unguessable
 * - token_hash: SHA-256 of the raw token (the only thing persisted)
 * - token_prefix: first 8 chars of the raw token, display-only hint
 * - the raw token is returned exactly once at creation and never stored
 */

export const CLAIM_TOKEN_PREFIX_LENGTH = 8;
export const CLAIM_TOKEN_BYTES = 24;

export function generateClaimToken(): string {
  return randomBytes(CLAIM_TOKEN_BYTES).toString("base64url");
}

export function hashClaimToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function claimTokenPrefix(rawToken: string): string {
  return rawToken.slice(0, CLAIM_TOKEN_PREFIX_LENGTH);
}

export function claimTokenIsWellFormed(rawToken: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(rawToken);
}

export type GeneratedClaimToken = {
  raw: string;
  hash: string;
  prefix: string;
};

export function generateClaimTokenPair(): GeneratedClaimToken {
  const raw = generateClaimToken();
  return { raw, hash: hashClaimToken(raw), prefix: claimTokenPrefix(raw) };
}
