import type { WorkspaceMode } from "../db/types.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../keeperhub/config.ts";
import type { PolicyDecision, TelegramMode } from "./types.ts";

export const DEV_TRANSACTION_CAP_BASE_UNITS = 100000n;
export const COMMUNITY_TRANSACTION_CAP_BASE_UNITS = 100000n;

export type PolicyInput = {
  mode: TelegramMode;
  workspaceMode: WorkspaceMode;
  userId: string;
  amountBaseUnits: string;
  chainId: string;
  tokenAddress: string;
  workspaceActive: boolean;
  allowedDevUserIds: ReadonlySet<string>;
};

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const amount = BigInt(input.amountBaseUnits);
  const canonicalToken = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();

  if (input.chainId !== KEEPERHUB_CHAIN_ID || input.tokenAddress.toLowerCase() !== canonicalToken) {
    return {
      decision: "blocked",
      reason: "Solvo executes Base USDC only.",
    };
  }
  if (!input.workspaceActive) {
    return {
      decision: "blocked",
      reason: "The workspace is not active.",
    };
  }

  if (input.mode === "sandbox") {
    return {
      decision: "auto_approve",
      reason: "Sandbox simulation. No funds will move.",
    };
  }

  if (input.workspaceMode !== "development") {
    return {
      decision: "blocked",
      reason: "Real execution is only available through the development workspace.",
    };
  }

  if (!input.allowedDevUserIds.has(input.userId)) {
    return {
      decision: "blocked",
      reason: "This Telegram account is not authorized for real execution.",
    };
  }

  if (amount > DEV_TRANSACTION_CAP_BASE_UNITS) {
    return {
      decision: "blocked",
      reason: `This payment is above the development cap of 0.10 USDC per transaction.`,
    };
  }

  return {
    decision: "auto_approve",
    reason: "Development user authorized. Amount within policy.",
  };
}

export type CommunityPolicyInput = {
  workspaceActive: boolean;
  isMember: boolean;
  amountBaseUnits: string;
  chainId: string;
  tokenAddress: string;
  perTransactionLimitBaseUnits: string | null;
};

/**
 * Deterministic community request policy. Every real community payout in M4
 * requires an authorized approval — no amount is auto-approved, regardless of
 * how small. This keeps the trust boundary explicit: the requester proposes,
 * an owner/approver disposes.
 */
export function evaluateCommunityRequest(input: CommunityPolicyInput): PolicyDecision {
  const amount = BigInt(input.amountBaseUnits);
  const canonicalToken = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();

  if (input.chainId !== KEEPERHUB_CHAIN_ID || input.tokenAddress.toLowerCase() !== canonicalToken) {
    return { decision: "blocked", reason: "Solvo executes Base USDC only." };
  }
  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The workspace is not active." };
  }
  if (!input.isMember) {
    return { decision: "blocked", reason: "You are not a member of this workspace." };
  }
  if (amount <= 0n) {
    return { decision: "blocked", reason: "Amount must be greater than zero." };
  }
  if (input.perTransactionLimitBaseUnits !== null) {
    const limit = BigInt(input.perTransactionLimitBaseUnits);
    if (amount > limit) {
      return {
        decision: "blocked",
        reason: `This payment is above the workspace per-transaction limit of ${limit / 1000000n} USDC.`,
      };
    }
  }
  return {
    decision: "approval_required",
    reason: "Community payouts require approval by an owner or approver.",
  };
}

export type CommunityApprovalInput = {
  workspaceActive: boolean;
  actorRole: "owner" | "approver" | null;
  actorIsRequester: boolean;
  perTransactionLimitBaseUnits: string | null;
  dailyLimitBaseUnits: string | null;
  currentDailySpendBaseUnits: string;
  amountBaseUnits: string;
};

/**
 * Deterministic approval-time policy for a community payout. Runs inside the
 * same DB transaction as the pending_approval → approved transition so the
 * daily-limit check is not subject to TOCTOU.
 */
export function evaluateCommunityApproval(input: CommunityApprovalInput): PolicyDecision {
  const amount = BigInt(input.amountBaseUnits);
  const dailySpend = BigInt(input.currentDailySpendBaseUnits);

  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The workspace is not active." };
  }
  if (input.actorRole !== "owner" && input.actorRole !== "approver") {
    return { decision: "blocked", reason: "Only an owner or approver may approve this payout." };
  }
  if (input.actorIsRequester) {
    return {
      decision: "blocked",
      reason: "The requester cannot approve their own payout (separation of duty).",
    };
  }
  if (input.perTransactionLimitBaseUnits !== null && amount > BigInt(input.perTransactionLimitBaseUnits)) {
    return {
      decision: "blocked",
      reason: "This payment is above the workspace per-transaction limit.",
    };
  }
  if (input.dailyLimitBaseUnits !== null && dailySpend + amount > BigInt(input.dailyLimitBaseUnits)) {
    return {
      decision: "blocked",
      reason: "This payment would exceed the workspace daily execution limit.",
    };
  }
  return { decision: "approved_for_execution", reason: "Approved by an authorized treasury role." };
}

export type BatchItemLimitInput = {
  amountBaseUnits: string;
  perTransactionLimitBaseUnits: string | null;
};

export type BatchRequestInput = {
  workspaceActive: boolean;
  isMember: boolean;
  chainId: string;
  tokenAddress: string;
  items: BatchItemLimitInput[];
  totalBaseUnits: string;
  dailyLimitBaseUnits: string | null;
  currentDailySpendBaseUnits: string;
};

/**
 * Deterministic batch request policy. Every item must respect the workspace
 * per-transaction limit, and the batch total must respect the workspace daily
 * limit — 20 × 0.08 USDC cannot bypass a 1.00 USDC daily limit.
 */
export function evaluateBatchRequest(input: BatchRequestInput): PolicyDecision {
  const canonicalToken = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();
  const total = BigInt(input.totalBaseUnits);
  const dailySpend = BigInt(input.currentDailySpendBaseUnits);

  if (input.chainId !== KEEPERHUB_CHAIN_ID || input.tokenAddress.toLowerCase() !== canonicalToken) {
    return { decision: "blocked", reason: "Solvo executes Base USDC only." };
  }
  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The workspace is not active." };
  }
  if (!input.isMember) {
    return { decision: "blocked", reason: "You are not a member of this workspace." };
  }
  for (const item of input.items) {
    const amount = BigInt(item.amountBaseUnits);
    if (amount <= 0n) {
      return { decision: "blocked", reason: "Every batch amount must be greater than zero." };
    }
    if (item.perTransactionLimitBaseUnits !== null && amount > BigInt(item.perTransactionLimitBaseUnits)) {
      return {
        decision: "blocked",
        reason: "One or more batch items are above the workspace per-transaction limit.",
      };
    }
  }
  if (input.dailyLimitBaseUnits !== null && dailySpend + total > BigInt(input.dailyLimitBaseUnits)) {
    return {
      decision: "blocked",
      reason: "This batch would exceed the workspace daily execution limit.",
    };
  }
  return {
    decision: "approval_required",
    reason: "Community batch payouts require approval by an owner or approver.",
  };
}

export type BatchApprovalInput = {
  workspaceActive: boolean;
  actorRole: "owner" | "approver" | null;
  actorIsRequester: boolean;
  items: BatchItemLimitInput[];
  totalBaseUnits: string;
  dailyLimitBaseUnits: string | null;
  currentDailySpendBaseUnits: string;
};

/**
 * Approval-time batch policy, evaluated inside the transition transaction so
 * the daily-limit check is not subject to TOCTOU.
 */
export function evaluateBatchApproval(input: BatchApprovalInput): PolicyDecision {
  const total = BigInt(input.totalBaseUnits);
  const dailySpend = BigInt(input.currentDailySpendBaseUnits);

  if (!input.workspaceActive) {
    return { decision: "blocked", reason: "The workspace is not active." };
  }
  if (input.actorRole !== "owner" && input.actorRole !== "approver") {
    return { decision: "blocked", reason: "Only an owner or approver may approve this payout." };
  }
  if (input.actorIsRequester) {
    return {
      decision: "blocked",
      reason: "The requester cannot approve their own payout (separation of duty).",
    };
  }
  for (const item of input.items) {
    const amount = BigInt(item.amountBaseUnits);
    if (item.perTransactionLimitBaseUnits !== null && amount > BigInt(item.perTransactionLimitBaseUnits)) {
      return {
        decision: "blocked",
        reason: "One or more batch items are above the workspace per-transaction limit.",
      };
    }
  }
  if (input.dailyLimitBaseUnits !== null && dailySpend + total > BigInt(input.dailyLimitBaseUnits)) {
    return {
      decision: "blocked",
      reason: "This batch would exceed the workspace daily execution limit.",
    };
  }
  return { decision: "approved_for_execution", reason: "Approved by an authorized treasury role." };
}
