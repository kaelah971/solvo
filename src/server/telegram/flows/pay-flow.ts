import type { SolvoRepository } from "../../db/repository.ts";
import { isValidEvmAddress, normalizeAddress } from "../../keeperhub/address.ts";
import { parseUsdcAmount } from "../../keeperhub/amount.ts";
import { ExecutionService, type KeeperHubExecutionGateway } from "../../execution/execution-service.ts";
import { usdcToBaseUnits } from "../../execution/money.ts";
import { getRealExecutionGateway } from "./execution-gateway.ts";
import { evaluatePolicy } from "../policy.ts";
import {
  checksPassed,
  confirming,
  executionFailed,
  executionUnknown,
  payPreview,
  policyFailure,
  proofMessage,
  requestReceived,
  simulationComplete,
  simulationFailure,
  submitted,
  validationFailure,
} from "../messages.ts";
import type { PayReply, PayInstruction, TelegramMode, TelegramUser } from "../types.ts";

export type PayFlowDeps = {
  repo: SolvoRepository;
  /** injected for tests; default is the real KeeperHub adapter */
  gateway?: KeeperHubExecutionGateway;
};

export function resolveMode(userId: string, allowedDevUserIds: ReadonlySet<string>): TelegramMode {
  return allowedDevUserIds.has(userId) ? "development" : "sandbox";
}

export function telegramIdempotencyKey(user: TelegramUser): string {
  const messagePart = user.messageId !== null ? `m${user.messageId}` : `u${user.updateId}`;
  return `tg:${user.chatId}:${messagePart}:pay`;
}

export async function handlePayInstruction(
  input: {
    instruction: PayInstruction;
    user: TelegramUser;
    mode: TelegramMode;
    allowedDevUserIds: ReadonlySet<string>;
  },
  deps: PayFlowDeps,
): Promise<PayReply> {
  const { instruction, user, mode, allowedDevUserIds } = input;

  const address = isValidEvmAddress(instruction.address);
  if (!address.ok) {
    return {
      messages: [],
      final: validationFailure(address.reason),
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }
  const amount = parseUsdcAmount(instruction.amount);
  if (!amount.ok) {
    return {
      messages: [],
      final: `The amount is invalid. Nothing was submitted.\n\n${amount.reason}`,
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }

  const idempotencyKey = telegramIdempotencyKey(user);
  const existing = await deps.repo.getPayoutItemByIdempotencyKey(idempotencyKey);
  if (existing) {
    const loaded = await deps.repo.getPayoutItemForExecution(existing.id);
    const state = loaded?.item.status ?? "unknown";
    return {
      messages: [requestReceived(existing.payout_id)],
      final: `This instruction was already received.\nCurrent state: ${state.toUpperCase()}\nNo duplicate execution was started.`,
      outcome: "duplicate",
      payoutId: existing.payout_id,
      itemId: existing.id,
    };
  }

  const amountBaseUnits = usdcToBaseUnits(amount.amount);
  if (!amountBaseUnits.ok) {
    return {
      messages: [],
      final: `The amount is invalid. Nothing was submitted.\n\n${amountBaseUnits.reason}`,
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }
  const amountUnits = amountBaseUnits.value.toString();

  const workspace =
    mode === "development"
      ? await deps.repo.getWorkspaceByMode("development")
      : await deps.repo.getWorkspaceByMode("sandbox");
  if (!workspace) {
    return {
      messages: [],
      final: "The workspace for this mode is not configured. Nothing was submitted.",
      outcome: "invalid",
      payoutId: null,
      itemId: null,
    };
  }

  const policy = evaluatePolicy({
    mode,
    workspaceMode: workspace.mode,
    userId: user.userId,
    amountBaseUnits: amountUnits,
    chainId: workspace.chain_id,
    tokenAddress: workspace.token_address,
    workspaceActive: workspace.status === "active",
    allowedDevUserIds,
  });

  const recipient = normalizeAddress(instruction.address);
  const workspaceChainId = workspace.chain_id;
  const workspaceToken = workspace.token_address;

  const preview = payPreview(
    { ...instruction, address: recipient, amount: amount.amount },
    mode,
    policy.decision === "auto_approve" ? "AUTO" : policy.decision === "approval_required" ? "REQUIRED" : "BLOCKED",
  );

  const persisted = await deps.repo.transaction(async (tx) => {
    const status = policy.decision === "blocked" ? "cancelled" : "approved";
    const payout = await tx.createPayout({
      workspaceId: workspace.id,
      requesterId: user.userId,
      sourceType: instruction.sourceType,
      status,
      totalAmountBaseUnits: amountUnits,
      currencySymbol: "USDC",
      chainId: workspaceChainId,
      tokenAddress: workspaceToken,
    });
    const { item } = await tx.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: recipient,
      amountBaseUnits: amountUnits,
      memo: mode === "sandbox" ? "sandbox simulation" : null,
      status,
      idempotencyKey,
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "request_created",
      actorType: "system",
      actorId: user.userId,
      metadata: { source: instruction.sourceType, channel: "telegram" },
    });
    if (policy.decision === "blocked") {
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "policy_blocked",
        actorType: "system",
        actorId: user.userId,
        metadata: { reason: policy.reason, mode },
      });
    } else {
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "approval_granted",
        actorType: "system",
        actorId: user.userId,
        metadata: { decision: policy.decision, mode },
      });
    }
    return { payoutId: payout.id, itemId: item.id };
  });

  if (policy.decision === "blocked") {
    return {
      messages: [preview],
      final: policyFailure(policy.reason),
      outcome: "blocked",
      payoutId: persisted.payoutId,
      itemId: persisted.itemId,
    };
  }

  if (mode === "sandbox") {
    await runSandboxSimulation(deps.repo, workspace.id, persisted.payoutId, persisted.itemId, user.userId);
    return {
      messages: [requestReceived(persisted.payoutId), checksPassed(), simulationComplete()],
      final: simulationComplete(),
      outcome: "simulated",
      payoutId: persisted.payoutId,
      itemId: persisted.itemId,
    };
  }

  return runDevelopmentExecution(deps, persisted.payoutId, persisted.itemId, user.userId);
}

async function runSandboxSimulation(
  repo: SolvoRepository,
  workspaceId: string,
  payoutId: string,
  itemId: string,
  userId: string,
): Promise<void> {
  await repo.transaction(async (tx) => {
    await tx.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await tx.transitionPayoutState(payoutId, ["approved"], "simulating");
    const attempt = await tx.createExecutionAttempt({
      payoutItemId: itemId,
      attemptNumber: 1,
      phase: "simulation",
    });
    await tx.setPayoutItemAttemptCount(itemId, 1);
    await tx.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: itemId,
      eventType: "simulation_started",
      actorType: "system",
      actorId: userId,
      metadata: { mode: "sandbox", attemptNumber: 1 },
    });
    await tx.updateExecutionAttempt(attempt.id, {
      simulationResult: { simulated: true, noFundsMoved: true },
      status: "succeeded",
      completedAt: new Date().toISOString(),
    });
    await tx.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: itemId,
      eventType: "simulation_passed",
      actorType: "system",
      actorId: userId,
      metadata: { mode: "sandbox", noFundsMoved: true },
    });
  });
}

async function runDevelopmentExecution(
  deps: PayFlowDeps,
  payoutId: string,
  itemId: string,
  userId: string,
): Promise<PayReply> {
  let gateway: KeeperHubExecutionGateway;
  try {
    gateway = deps.gateway ?? getRealExecutionGateway();
  } catch {
    return {
      messages: [requestReceived(payoutId), checksPassed()],
      final: "KeeperHub execution is not configured on this server. Nothing was submitted.",
      outcome: "failed",
      payoutId,
      itemId,
    };
  }

  const execution = new ExecutionService(deps.repo, gateway, {
    chainId: "8453",
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  });
  const outcome = await execution.executePayoutItem(itemId);
  void userId;

  if (outcome.kind === "completed") {
    const proof = proofMessage(
      outcome.executionId ?? "",
      outcome.transactionHash ?? "",
      null,
    );
    return {
      messages: [
        requestReceived(payoutId),
        checksPassed(),
        ["EXECUTE", "", "✓ KeeperHub simulation passed", submitted(), confirming()].join("\n"),
        proof,
      ],
      final: proof,
      outcome: "completed",
      payoutId,
      itemId,
    };
  }

  if (outcome.kind === "unknown") {
    const message = executionUnknown();
    return {
      messages: [requestReceived(payoutId), checksPassed(), message],
      final: message,
      outcome: "unknown",
      payoutId,
      itemId,
    };
  }

  const state = (await deps.repo.getPayoutItemForExecution(itemId))?.item.status;
  if (state === "simulation_failed") {
    return {
      messages: [requestReceived(payoutId), checksPassed(), simulationFailure()],
      final: simulationFailure(),
      outcome: "failed",
      payoutId,
      itemId,
    };
  }
  const message = executionFailed();
  return {
    messages: [
      requestReceived(payoutId),
      checksPassed(),
      ["EXECUTE", "", "✓ KeeperHub simulation passed", submitted()].join("\n"),
      message,
    ],
    final: message,
    outcome: "failed",
    payoutId,
    itemId,
  };
}
