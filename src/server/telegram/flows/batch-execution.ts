import type { SolvoRepository } from "../../db/repository.ts";
import type { PayoutItemRow, PayoutRow, WorkspaceRow } from "../../db/types.ts";
import { ExecutionService, type KeeperHubExecutionGateway } from "../../execution/execution-service.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../../keeperhub/config.ts";

export type BatchItemOutcome = {
  index: number;
  itemId: string;
  label: string;
  amountBaseUnits: string;
  status: "completed" | "simulation_failed" | "execution_failed" | "execution_unknown" | "not_executable";
  executionId: string | null;
  transactionHash: string | null;
};

export type BatchExecutionResult = {
  aggregate:
    | "completed"
    | "partially_completed"
    | "execution_failed"
    | "execution_unknown"
    | "simulation_failed";
  items: BatchItemOutcome[];
  totalBaseUnits: string;
  completedCount: number;
  transferredBaseUnits: string;
};

/**
 * Executes an approved batch sequentially: every item goes through the
 * existing ExecutionService → KeeperHubAdapter → simulate → execute → persist
 * path. Payout-level sync is disabled on the item executions so that no
 * single item's outcome wins the aggregate; this module owns the payout state
 * and settles it truthfully at the end (completed / partially_completed /
 * execution_failed / execution_unknown / simulation_failed).
 *
 * Sequential, bounded execution — never Promise.all over items — so one item
 * can never execute twice and partial failures are recorded exactly.
 */
export async function executeBatch(
  repo: SolvoRepository,
  gateway: KeeperHubExecutionGateway,
  payout: PayoutRow,
  workspace: WorkspaceRow,
  items: PayoutItemRow[],
  onProgress?: (message: string) => Promise<void>,
): Promise<BatchExecutionResult> {
  const config = {
    chainId: KEEPERHUB_CHAIN_ID,
    tokenAddress: KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase(),
    syncPayoutState: false,
  };

  await repo.transitionPayoutState(payout.id, ["approved"], "simulating");

  const outcomes: BatchItemOutcome[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (onProgress) {
      try {
        await onProgress(batchProgressLine(index, items.length, "checking"));
      } catch {
        // progress editing is best-effort
      }
    }
    const execution = new ExecutionService(repo, gateway, config);
    const result = await execution.executePayoutItem(item.id);

    const persisted = await repo.getPayoutItemById(item.id);
    let status: BatchItemOutcome["status"];
    switch (result.kind) {
      case "completed":
        status = "completed";
        break;
      case "not_executable":
        status = "not_executable";
        break;
      case "unknown":
        status = "execution_unknown";
        break;
      default:
        status = persisted?.status === "simulation_failed" ? "simulation_failed" : "execution_failed";
    }

    outcomes.push({
      index,
      itemId: item.id,
      label: item.memo ?? item.recipient_address.slice(0, 10) + "…",
      amountBaseUnits: item.amount_base_units,
      status,
      executionId: persisted?.keeperhub_execution_id ?? null,
      transactionHash: persisted?.transaction_hash ?? null,
    });
    if (onProgress) {
      try {
        await onProgress(batchProgressLine(index, items.length, "executing"));
      } catch {
        // progress editing is best-effort
      }
    }
  }

  const completedCount = outcomes.filter((outcome) => outcome.status === "completed").length;
  const transferredBaseUnits = outcomes
    .filter((outcome) => outcome.status === "completed")
    .reduce((sum, outcome) => sum + BigInt(outcome.amountBaseUnits), 0n)
    .toString();
  const totalBaseUnits = outcomes.reduce((sum, outcome) => sum + BigInt(outcome.amountBaseUnits), 0n).toString();

  await settleAggregate(repo, payout, outcomes, completedCount);
  return {
    aggregate: await aggregateState(repo, payout.id, outcomes, completedCount),
    items: outcomes,
    totalBaseUnits,
    completedCount,
    transferredBaseUnits,
  };
}

async function settleAggregate(
  repo: SolvoRepository,
  payout: PayoutRow,
  outcomes: BatchItemOutcome[],
  completedCount: number,
): Promise<void> {
  const anyExecutionAttempted = outcomes.some((outcome) => outcome.status !== "simulation_failed");
  if (completedCount === outcomes.length) {
    await repo.transitionPayoutState(payout.id, ["simulating"], "submitted");
    await repo.transitionPayoutState(payout.id, ["submitted"], "completed");
    await appendAggregateAudit(repo, payout, "execution_completed", {
      completed: completedCount,
      total: outcomes.length,
    });
    return;
  }
  if (completedCount === 0 && !anyExecutionAttempted) {
    await repo.transitionPayoutState(payout.id, ["simulating"], "simulation_failed");
    await appendAggregateAudit(repo, payout, "simulation_failed", {
      completed: 0,
      total: outcomes.length,
    });
    return;
  }
  if (completedCount === 0 && anyExecutionAttempted) {
    const hasUnknown = outcomes.some((outcome) => outcome.status === "execution_unknown");
    await repo.transitionPayoutState(payout.id, ["simulating"], "submitted");
    if (hasUnknown) {
      await repo.transitionPayoutState(payout.id, ["submitted"], "execution_unknown");
    } else {
      await repo.transitionPayoutState(payout.id, ["submitted"], "execution_failed");
    }
    await appendAggregateAudit(repo, payout, hasUnknown ? "execution_unknown" : "execution_failed", {
      completed: 0,
      total: outcomes.length,
    });
    return;
  }
  await repo.transitionPayoutState(payout.id, ["simulating"], "submitted");
  await repo.transitionPayoutState(payout.id, ["submitted"], "partially_completed");
  await appendAggregateAudit(repo, payout, "batch_partially_completed", {
    completed: completedCount,
    total: outcomes.length,
  });
}

async function aggregateState(
  repo: SolvoRepository,
  payoutId: string,
  outcomes: BatchItemOutcome[],
  completedCount: number,
): Promise<BatchExecutionResult["aggregate"]> {
  const payout = await repo.getPayoutById(payoutId);
  const state = payout?.status ?? "unknown";
  if (state === "completed") return "completed";
  if (state === "partially_completed") return "partially_completed";
  if (state === "execution_unknown") return "execution_unknown";
  if (state === "simulation_failed") return "simulation_failed";
  if (state === "execution_failed") return "execution_failed";
  return completedCount === outcomes.length ? "completed" : "partially_completed";
}

async function appendAggregateAudit(
  repo: SolvoRepository,
  payout: PayoutRow,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await repo.appendAuditEvent({
    workspaceId: payout.workspace_id,
    payoutId: payout.id,
    payoutItemId: null,
    eventType,
    actorType: "system",
    metadata: { aggregate: true, ...metadata },
  });
}

function batchProgressLine(current: number, total: number, phase: "checking" | "executing"): string {
  return `BATCH APPROVED\n\n${phase.toUpperCase()} ${Math.min(current + 1, total)}/${total}...`;
}
