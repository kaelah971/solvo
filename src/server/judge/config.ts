import { parseUsdcLimitAmount } from "../keeperhub/amount.ts";
import { usdcToBaseUnits } from "../execution/money.ts";

/**
 * Judge Mode configuration — server-only env vars. Never expose these via
 * NEXT_PUBLIC_; the judge allowlist is a private identity primitive.
 *
 * Env vars:
 *   JUDGE_MODE_ENABLED            "true" enables the judge boundary (default off)
 *   TELEGRAM_JUDGE_USER_IDS       comma-separated numeric Telegram IDs
 *   JUDGE_PER_TX_LIMIT_USDC       per-transaction cap (default 0.10)
 *   JUDGE_DAILY_LIMIT_USDC        daily cap (default 1.00)
 *   KEEPERHUB_JUDGE_INTEGRATION_ID optional KeeperHub wallet integration id.
 *                                 Only used if the KeeperHub MCP's
 *                                 execute_transfer schema advertises an
 *                                 integration selector at runtime; the current
 *                                 schema does not, so this is a no-op today.
 */

export const JUDGE_PER_TX_LIMIT_USDC_DEFAULT = "0.10";
export const JUDGE_DAILY_LIMIT_USDC_DEFAULT = "1.00";
export const JUDGE_WORKSPACE_MODE = "judge" as const;

export type JudgeConfigErrorCode = "invalid_tx_limit" | "invalid_daily_limit";

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
  judgeUserIds: ReadonlySet<string>;
  perTxLimitBaseUnits: string;
  dailyLimitBaseUnits: string;
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

export type JudgeEnv = Record<string, string | undefined>;

export function getJudgeConfig(env: JudgeEnv = process.env): JudgeConfig {
  const enabled = env.JUDGE_MODE_ENABLED?.trim().toLowerCase() === "true";
  const rawIds = (env.TELEGRAM_JUDGE_USER_IDS ?? "").split(",");
  const judgeUserIds = new Set<string>();
  for (const raw of rawIds) {
    const id = raw.trim();
    if (/^\d+$/.test(id)) {
      judgeUserIds.add(id);
    }
  }
  return {
    enabled,
    judgeUserIds,
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
    keeperhubJudgeIntegrationId: env.KEEPERHUB_JUDGE_INTEGRATION_ID?.trim() || null,
  };
}

export type JudgeConfigInput = {
  config: JudgeConfig;
  userId: string;
};

export function isJudgeUser(userId: string, config: JudgeConfig): boolean {
  return config.enabled && config.judgeUserIds.has(userId);
}
