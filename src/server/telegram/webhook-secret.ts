import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Timing-safe comparison of the Telegram webhook secret header against the
 * configured secret. Both sides are hashed with SHA-256 first so that
 * timingSafeEqual always receives equal-length buffers.
 */
export function verifySecretToken(headerValue: string, expected: string): boolean {
  if (headerValue.length === 0 || expected.length === 0) return false;
  const a = createHash("sha256").update(headerValue).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
