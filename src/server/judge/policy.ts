import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../keeperhub/config.ts";
import type { PolicyDecision } from "../telegram/types.ts";

export type JudgePolicyInput = {
  modeEnabled: boolean;
  judgeUserIds: ReadonlySet<string>;
  userId: string;
  amountBaseUnits: string;
  chainId: string;
  tokenAddress: string;
  workspaceActive: boolean;
  perTxLimitBaseUnits: string;
  dailyLimitBaseUnits: string;
  currentDailySpendBaseUnits: string;
};

/**
 * Deterministic Judge Mode policy.
 *
 * AUTO-APPROVE only when EVERY gate passes; otherwise BLOCK. Judge Mode has
 * no human approval step, no usernames, no display names, and no
 * "anyone in the group" path — the Telegram numeric allowlist is the only
 * identity primitive. Conservative daily-cap accounting: if a payment could
 * push spend above the cap, it is blocked rather than overspent.
 */
export function evaluateJudgeRequest(input: JudgePolicyInput): PolicyDecision {
  const amount = BigInt(input.amountBaseUnits);
  const dailySpend = BigInt(input.currentDailySpendBaseUnits);
  const perTxLimit = BigInt(input.perTxLimitBaseUnits);
  const dailyLimit = BigInt(input.dailyLimitBaseUnits);
  const canonicalToken = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();

  if (!input.modeEnabled) {
    return { decision: "blocked", reason: "Judge Mode is not enabled." };
  }
  if (!input.judgeUserIds.has(input.userId)) {
    return { decision: "blocked", reason: "This Telegram account is not an authorized judge." };
  }
  if (amount <= 0n) {
    return { decision: "blocked", reason: "Amount must be greater than zero." };
  }
  if (amount > perTxLimit) {
    return { decision: "blocked", reason: "This payment is above the judge per-transaction cap of 0.10 USDC." };
  }
  if (dailySpend + amount > dailyLimit) {
    return { decision: "blocked", reason: "This payment would exceed the judge daily cap of 1.00 USDC." };
  }
  if (input.chainId !== KEEPERHUB_CHAIN_ID || input.tokenAddress.toLowerCase() !== canonicalToken) {
    return { decision: "blocked", reason: "Solvo executes Base USDC only." };
  }
  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The judge workspace is not active." };
  }

  return {
    decision: "auto_approve",
    reason: "Judge authorized. Amount within judge policy.",
  };
}
