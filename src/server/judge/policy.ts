import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../keeperhub/config.ts";
import type { PolicyDecision } from "../telegram/types.ts";

export type JudgePolicyInput = {
  modeEnabled: boolean;
  /** Optional admin override allowlist; empty = public self-serve. */
  adminUserIds: ReadonlySet<string>;
  userId: string;
  amountBaseUnits: string;
  chainId: string;
  tokenAddress: string;
  workspaceActive: boolean;
  perTxLimitBaseUnits: string;
  dailyLimitBaseUnits: string;
  lifetimeLimitBaseUnits: string;
  /** Number of this user's payments that already completed successfully. */
  successfulPaymentsByUser: number;
  /** Per-Telegram-user successful execution cap. */
  maxSuccessfulPaymentsPerUser: number;
  currentDailySpendBaseUnits: string;
  /** All-time judge workspace spend (funds may have moved). */
  lifetimeSpendBaseUnits: string;
};

/**
 * Deterministic Judge Mode policy — M6.1 self-serve PUBLIC.
 *
 * When the admin allowlist is EMPTY, any Telegram user may complete a real
 * capped judge payment with no contact with the project owner. When the
 * allowlist is NON-EMPTY, only listed admins may execute (public access is
 * locked down) and admins are exempt from the per-user success cap.
 *
 * AUTO-APPROVE only when EVERY gate passes; otherwise BLOCK. No manual
 * approval step, no usernames, no display names, no "anyone in the group"
 * beyond the explicit public rule above. Conservative cap accounting: in-flight
 * states count toward daily/lifetime spend; if a payment could overspend it is
 * blocked rather than overspent.
 */
export function evaluateJudgeRequest(input: JudgePolicyInput): PolicyDecision {
  const amount = BigInt(input.amountBaseUnits);
  const dailySpend = BigInt(input.currentDailySpendBaseUnits);
  const lifetimeSpend = BigInt(input.lifetimeSpendBaseUnits);
  const perTxLimit = BigInt(input.perTxLimitBaseUnits);
  const dailyLimit = BigInt(input.dailyLimitBaseUnits);
  const lifetimeLimit = BigInt(input.lifetimeLimitBaseUnits);
  const canonicalToken = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();

  if (!input.modeEnabled) {
    return { decision: "blocked", reason: "Judge Mode is not enabled." };
  }
  if (input.adminUserIds.size > 0 && !input.adminUserIds.has(input.userId)) {
    return {
      decision: "blocked",
      reason: "Judge Mode is currently restricted to the configured admin allowlist.",
    };
  }
  if (amount <= 0n) {
    return { decision: "blocked", reason: "Amount must be greater than zero." };
  }
  if (amount > perTxLimit) {
    return {
      decision: "blocked",
      reason: "This payment is above the judge per-transaction cap of 0.01 USDC.",
    };
  }
  if (dailySpend + amount > dailyLimit) {
    return {
      decision: "blocked",
      reason: "This payment would exceed the judge daily cap of 0.25 USDC.",
    };
  }
  if (lifetimeSpend + amount > lifetimeLimit) {
    return {
      decision: "blocked",
      reason: "This payment would exceed the judge lifetime cap of 1.00 USDC.",
    };
  }
  if (input.chainId !== KEEPERHUB_CHAIN_ID || input.tokenAddress.toLowerCase() !== canonicalToken) {
    return { decision: "blocked", reason: "Solvo executes Base USDC only." };
  }
  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The judge workspace is not active." };
  }
  if (
    !input.adminUserIds.has(input.userId) &&
    input.successfulPaymentsByUser >= input.maxSuccessfulPaymentsPerUser
  ) {
    return {
      decision: "blocked",
      reason: "This Telegram account has already completed its one allowed judge payment.",
    };
  }

  return {
    decision: "auto_approve",
    reason: "Judge policy satisfied. Amount within caps.",
  };
}
