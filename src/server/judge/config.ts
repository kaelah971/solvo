import { parseUsdcLimitAmount } from "../keeperhub/amount.ts";
import { usdcToBaseUnits } from "../execution/money.ts";

/**
 * Judge Mode configuration — server-only env vars. Never expose these via
 * NEXT_PUBLIC_; the admin allowlist is a private identity primitive.
 *
 * M6.1: Judge Mode is SELF-SERVE PUBLIC. Any Telegram user may complete one
 * tiny real judge payment under strict caps. No allowlist is required for
 * public judge testing.
 *
 * Env vars:
 *   JUDGE_MODE_ENABLED             "true" enables the judge boundary (default off)
 *   TELEGRAM_JUDGE_USER_IDS        OPTIONAL admin override allowlist
 *                                  (comma-separated numeric IDs). When
 *                                  NON-EMPTY, only listed admins can execute
 *                                  (public access is locked down) and admins
 *                                  are exempt from the per-user success cap.
 *                                  When EMPTY, anyone can test under caps.
 *   JUDGE_PER_TX_LIMIT_USDC        per-transaction cap (default 0.01)
 *   JUDGE_DAILY_LIMIT_USDC         global daily cap (default 0.25)
 *   JUDGE_LIFETIME_LIMIT_USDC      global lifetime cap (default 1.00)
 *   JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER  per-Telegram-user successful
 *                                  execution cap (default 1)
 *   KEEPERHUB_JUDGE_INTEGRATION_ID optional KeeperHub wallet integration id.
 *                                  Only used if the KeeperHub MCP's
 *                                  execute_transfer schema advertises an
 *                                  integration selector at runtime; the
 *                                  current schema does not, so this is a
 *                                  no-op today.
 */

export const JUDGE_PER_TX_LIMIT_USDC_DEFAULT = "0.01";
export const JUDGE_DAILY_LIMIT_USDC_DEFAULT = "0.25";
export const JUDGE_LIFETIME_LIMIT_USDC_DEFAULT = "1.00";
export const JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER_DEFAULT = 1;
export const JUDGE_WORKSPACE_MODE = "judge" as const;

export type JudgeConfigErrorCode = "invalid_tx_limit" | "invalid_daily_limit" | "invalid_lifetime_limit" | "invalid_max_successful";

export class JudgeConfigError extends Error {
  readonly code: JudgeConfigErrorCode;

  constructor(code: JudgeConfigErrorCode, message: string) {
    super(message);
    this.name = "JudgeConfigError";
    this.code = code;
  }
}

export type JudgeConfig = {
  enabled: boolean;
  /**
   * Optional admin override allowlist. Empty = public self-serve judge mode.
   * Non-empty = only these admins can execute (locked down), and admins are
   * exempt from the per-user successful-payment cap.
   */
  adminUserIds: ReadonlySet<string>;
  perTxLimitBaseUnits: string;
  dailyLimitBaseUnits: string;
  lifetimeLimitBaseUnits: string;
  maxSuccessfulPaymentsPerUser: number;
  keeperhubJudgeIntegrationId: string | null;
};

function parseLimitUsdc(value: string, fallback: string, code: JudgeConfigErrorCode): string {
  const raw = value.trim();
  const candidate = raw.length > 0 ? raw : fallback;
  const parsed = parseUsdcLimitAmount(candidate);
  if (!parsed.ok) {
    throw new JudgeConfigError(code, `Invalid USDC limit "${candidate}": ${parsed.reason}`);
  }
  const units = usdcToBaseUnits(parsed.amount);
  if (!units.ok || units.value <= 0n) {
    throw new JudgeConfigError(code, `Invalid USDC limit "${candidate}": must be greater than zero`);
  }
  return units.value.toString();
}

function parseMaxSuccessful(raw: string, fallback: number): number {
  const candidate = raw.trim();
  if (candidate.length === 0) return fallback;
  if (!/^\d+$/.test(candidate)) {
    throw new JudgeConfigError(
      "invalid_max_successful",
      `Invalid JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER "${candidate}": must be a positive integer`,
    );
  }
  const value = Number(candidate);
  if (!Number.isInteger(value) || value < 1) {
    throw new JudgeConfigError(
      "invalid_max_successful",
      `Invalid JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER "${candidate}": must be at least 1`,
    );
  }
  return value;
}

export type JudgeEnv = Record<string, string | undefined>;

export function getJudgeConfig(env: JudgeEnv = process.env): JudgeConfig {
  const enabled = env.JUDGE_MODE_ENABLED?.trim().toLowerCase() === "true";
  const rawIds = (env.TELEGRAM_JUDGE_USER_IDS ?? "").split(",");
  const adminUserIds = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (/^\d+$/.test(id)) {
      adminUserIds.add(id);
    }
  }
  return {
    enabled,
    adminUserIds,
    perTxLimitBaseUnits: parseLimitUsdc(
      env.JUDGE_PER_TX_LIMIT_USDC ?? "",
      JUDGE_PER_TX_LIMIT_USDC_DEFAULT,
      "invalid_tx_limit",
    ),
    dailyLimitBaseUnits: parseLimitUsdc(
      env.JUDGE_DAILY_LIMIT_USDC ?? "",
      JUDGE_DAILY_LIMIT_USDC_DEFAULT,
      "invalid_daily_limit",
    ),
    lifetimeLimitBaseUnits: parseLimitUsdc(
      env.JUDGE_LIFETIME_LIMIT_USDC ?? "",
      JUDGE_LIFETIME_LIMIT_USDC_DEFAULT,
      "invalid_lifetime_limit",
    ),
    maxSuccessfulPaymentsPerUser: parseMaxSuccessful(
      env.JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER ?? "",
      JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER_DEFAULT,
    ),
    keeperhubJudgeIntegrationId: env.KEEPERHUB_JUDGE_INTEGRATION_ID?.trim() || null,
  };
}

export type JudgeConfigInput = {
  config: JudgeConfig;
  userId: string;
};

/**
 * Access rule for Judge Mode:
 * - public: when the admin allowlist is EMPTY, every Telegram user is
 *   eligible under caps;
 * - admin-restricted: when the allowlist is NON-EMPTY, only listed admins are
 *   eligible (public access locked down).
 */
export function isJudgeUser(userId: string, config: JudgeConfig): boolean {
  return config.enabled && (config.adminUserIds.size === 0 || config.adminUserIds.has(userId));
}

/** Admins are exempt from the per-user successful-payment cap. */
export function isJudgeAdmin(userId: string, config: JudgeConfig): boolean {
  return config.adminUserIds.has(userId);
}
