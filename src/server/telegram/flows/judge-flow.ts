import type { SolvoRepository } from "../../db/repository.ts";
import { isValidEvmAddress, normalizeAddress } from "../../keeperhub/address.ts";
import { parseUsdcAmount } from "../../keeperhub/amount.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../../keeperhub/config.ts";
import { ExecutionService, type KeeperHubExecutionGateway } from "../../execution/execution-service.ts";
import { usdcToBaseUnits } from "../../execution/money.ts";
import { getRealExecutionGateway } from "./execution-gateway.ts";
import { getJudgeConfig, type JudgeConfig } from "../../judge/config.ts";
import { evaluateJudgeRequest } from "../../judge/policy.ts";
import {
  judgeBlockedMessage,
  judgeDuplicateMessage,
  judgeExecuteProgress,
  judgeFailureMessage,
  judgePaymentPreview,
  judgeProofMessage,
  judgeUnknownMessage,
  judgeValidationMessage,
} from "../../judge/messages.ts";
import type { JudgePayInstruction, TelegramUser } from "../types.ts";

export type JudgeOutcome =
  | "completed"
  | "failed"
  | "unknown"
  | "blocked"
  | "duplicate"
  | "invalid";

export type JudgeReply = {
  /** first message is sent, later messages edit the same Telegram message */
  messages: string[];
  final: string;
  outcome: JudgeOutcome;
  payoutId: string | null;
  itemId: string | null;
};

export type JudgeFlowDeps = {
  repo: SolvoRepository;
  /** injected for tests; default is the real KeeperHub adapter */
  gateway?: KeeperHubExecutionGateway;
  /** injected for tests; default reads process env */
  config?: JudgeConfig;
};

/** Conservative daily-cap states: only states where funds may have moved. */
export const JUDGE_DAILY_SPEND_STATES = [
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "execution_unknown",
] as const;

export function utcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function judgeIdempotencyKey(user: TelegramUser): string {
  const messagePart = user.messageId !== null ? `m${user.messageId}` : `u${user.updateId}`;
  return `tg:${user.chatId}:${messagePart}:judgepay`;
}

/**
 * Judge Mode /judgepay flow: deterministic parse → judge policy → one
 * transaction (fresh daily-cap recheck + persistence + approval audit) →
 * ExecutionService → proof. No manual approval exists in Judge Mode.
 */
export async function handleJudgePayInstruction(
  input: { instruction: JudgePayInstruction; user: TelegramUser },
  deps: JudgeFlowDeps,
): Promise<JudgeReply> {
  const { instruction, user } = input;

  const address = isValidEvmAddress(instruction.address);
  if (!address.ok) {
    return {
      messages: [],
      final: judgeValidationMessage(address.reason),
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }
  const amount = parseUsdcAmount(instruction.amount);
  if (!amount.ok) {
    return {
      messages: [],
      final: judgeValidationMessage(amount.reason),
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }
  const amountUnits = usdcToBaseUnits(amount.amount);
  if (!amountUnits.ok || amountUnits.value <= 0n) {
    return {
      messages: [],
      final: judgeValidationMessage("Amount must be greater than zero."),
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }
  const amountBaseUnits = amountUnits.value.toString();

  const config = deps.config ?? getJudgeConfig();

  const idempotencyKey = judgeIdempotencyKey(user);
  const existing = await deps.repo.getPayoutItemByIdempotencyKey(idempotencyKey);
  if (existing) {
    const loaded = await deps.repo.getPayoutItemForExecution(existing.id);
    const state = loaded?.item.status ?? "unknown";
    return {
      messages: [],
      final: judgeDuplicateMessage(state, existing.payout_id),
      outcome: "duplicate",
      payoutId: existing.payout_id,
      itemId: existing.id,
    };
  }

  const workspace = await deps.repo.getWorkspaceByMode("judge");
  if (!workspace) {
    return {
      messages: [],
      final: judgeBlockedMessage("The judge workspace is not configured."),
      outcome: "blocked",
      payoutId: null,
      itemId: null,
    };
  }

  const dailySpend = await deps.repo.sumPayoutItemsByWorkspaceStates(
    workspace.id,
    JUDGE_DAILY_SPEND_STATES,
    utcDayStartIso(),
  );

  const policy = evaluateJudgeRequest({
    modeEnabled: config.enabled,
    judgeUserIds: config.judgeUserIds,
    userId: user.userId,
    amountBaseUnits,
    chainId: workspace.chain_id,
    tokenAddress: workspace.token_address,
    workspaceActive: workspace.status === "active",
    perTxLimitBaseUnits: config.perTxLimitBaseUnits,
    dailyLimitBaseUnits: config.dailyLimitBaseUnits,
    currentDailySpendBaseUnits: dailySpend,
  });

  if (policy.decision !== "auto_approve") {
    return {
      messages: [],
      final: judgeBlockedMessage(policy.reason),
      outcome: "blocked",
      payoutId: null,
      itemId: null,
    };
  }

  const recipient = normalizeAddress(instruction.address);

  const persisted = await deps.repo.transaction(async (tx) => {
    // Re-check the daily cap inside the same transaction that persists the
    // payout so concurrent judge payments cannot overshoot the daily cap.
    const freshSpend = await tx.sumPayoutItemsByWorkspaceStates(
      workspace.id,
      JUDGE_DAILY_SPEND_STATES,
      utcDayStartIso(),
    );
    const recheck = evaluateJudgeRequest({
      modeEnabled: config.enabled,
      judgeUserIds: config.judgeUserIds,
      userId: user.userId,
      amountBaseUnits,
      chainId: workspace.chain_id,
      tokenAddress: workspace.token_address,
      workspaceActive: workspace.status === "active",
      perTxLimitBaseUnits: config.perTxLimitBaseUnits,
      dailyLimitBaseUnits: config.dailyLimitBaseUnits,
      currentDailySpendBaseUnits: freshSpend,
    });
    if (recheck.decision !== "auto_approve") {
      return { blocked: true, reason: recheck.reason, payoutId: null, itemId: null };
    }

    const payout = await tx.createPayout({
      workspaceId: workspace.id,
      requesterId: user.userId,
      sourceType: "judge_telegram",
      status: "approved",
      totalAmountBaseUnits: amountBaseUnits,
      currencySymbol: "USDC",
      chainId: workspace.chain_id,
      tokenAddress: workspace.token_address,
    });
    const { item } = await tx.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: recipient,
      amountBaseUnits,
      memo: "judge payment",
      status: "approved",
      idempotencyKey,
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "request_created",
      actorType: "judge",
      actorId: user.userId,
      metadata: { source: "judge_telegram", channel: "telegram", mode: "judge" },
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "approval_granted",
      actorType: "judge",
      actorId: user.userId,
      metadata: {
        role: "judge",
        mode: "judge",
        reason: recheck.reason,
        perTxCapBaseUnits: config.perTxLimitBaseUnits,
        dailyCapBaseUnits: config.dailyLimitBaseUnits,
      },
    });
    return { blocked: false, reason: null, payoutId: payout.id, itemId: item.id };
  });

  if (persisted.blocked) {
    return {
      messages: [],
      final: judgeBlockedMessage(persisted.reason ?? "The judge payment was blocked."),
      outcome: "blocked",
      payoutId: null,
      itemId: null,
    };
  }

  const payoutId = persisted.payoutId as string;
  const itemId = persisted.itemId as string;

  let gateway: KeeperHubExecutionGateway;
  try {
    gateway = deps.gateway ?? getRealExecutionGateway();
  } catch {
    return {
      messages: [judgePaymentPreview(recipient, instruction.amount, config.perTxLimitBaseUnits)],
      final: "KeeperHub execution is not configured on this server. Nothing was submitted.",
      outcome: "failed",
      payoutId,
      itemId,
    };
  }

  const execution = new ExecutionService(deps.repo, gateway, {
    chainId: KEEPERHUB_CHAIN_ID,
    tokenAddress: KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase(),
    integrationId: config.keeperhubJudgeIntegrationId ?? undefined,
  });
  const outcome = await execution.executePayoutItem(itemId);

  const preview = judgePaymentPreview(recipient, instruction.amount, config.perTxLimitBaseUnits);

  if (outcome.kind === "completed") {
    const proof = judgeProofMessage(
      outcome.executionId ?? "",
      outcome.transactionHash ?? "",
      instruction.amount,
      recipient,
    );
    return {
      messages: [preview, judgeExecuteProgress(), proof],
      final: proof,
      outcome: "completed",
      payoutId,
      itemId,
    };
  }

  if (outcome.kind === "unknown") {
    return {
      messages: [preview, judgeExecuteProgress(), judgeUnknownMessage()],
      final: judgeUnknownMessage(),
      outcome: "unknown",
      payoutId,
      itemId,
    };
  }

  const state = (await deps.repo.getPayoutItemForExecution(itemId))?.item.status ?? "execution_failed";
  return {
    messages: [preview, judgeFailureMessage(state)],
    final: judgeFailureMessage(state),
    outcome: "failed",
    payoutId,
    itemId,
  };
}
