import type { SolvoRepository } from "../db/repository.ts";
import type { PayoutItemRow, PayoutRow, WorkspaceRow } from "../db/types.ts";
import { deriveIdempotencyKey } from "../keeperhub/idempotency.ts";
import type {
  SolvoDirectExecutionStatus,
  SolvoSimulationResult,
  SolvoTransferRequest,
} from "../keeperhub/types.ts";
import { baseUnitsToUsdc } from "./money.ts";
import {
  canTransition,
  isExecutionState,
  type ExecutionState,
} from "./state-machine.ts";

export interface KeeperHubExecutionGateway {
  simulateTransfer(request: Omit<SolvoTransferRequest, "idempotencyKey">): Promise<SolvoSimulationResult>;
  executeTransfer(request: SolvoTransferRequest): Promise<SolvoDirectExecutionStatus>;
  getDirectExecutionStatus(executionId: string): Promise<SolvoDirectExecutionStatus>;
  pollUntilTerminal(
    executionId: string,
    options?: { maxPolls?: number; initialDelayMs?: number },
  ): Promise<SolvoDirectExecutionStatus>;
}

export type ExecutionServiceConfig = {
  chainId: string;
  tokenAddress: string;
  /**
   * Optional KeeperHub wallet integration id forwarded to execute_transfer
   * only when the MCP schema advertises an integration selector (see
   * KeeperHubAdapter.resolveTransferArgs). Unused until then.
   */
  integrationId?: string;
  /**
   * When false, per-item state transitions do NOT mirror onto the payout
   * state. Used by the batch executor, which owns the payout-level aggregate
   * (completed / partially_completed / execution_failed / ...) instead of
   * letting any single item's outcome win. Defaults to true.
   */
  syncPayoutState?: boolean;
};

export type ExecutionOutcome =
  | { kind: "completed"; itemId: string; executionId: string | null; transactionHash: string | null }
  | { kind: "failed"; itemId: string; executionId: string | null; message: string }
  | { kind: "unknown"; itemId: string; executionId: string | null; reason: string }
  | { kind: "not_executable"; itemId: string; reason: string };

const RECONCILE_FROM: readonly ExecutionState[] = [
  "submitted",
  "confirming",
  "execution_unknown",
  "execution_failed",
  "retrying",
];

const RESUME_FROM: readonly ExecutionState[] = [
  "submitted",
  "confirming",
  "execution_unknown",
  "retrying",
];

export class ExecutionService {
  private readonly repo: SolvoRepository;
  private readonly keeperhub: KeeperHubExecutionGateway;
  private readonly config: ExecutionServiceConfig;
  private readonly syncPayout: boolean;

  constructor(
    repo: SolvoRepository,
    keeperhub: KeeperHubExecutionGateway,
    config: ExecutionServiceConfig,
  ) {
    this.repo = repo;
    this.keeperhub = keeperhub;
    this.config = config;
    this.syncPayout = config.syncPayoutState !== false;
  }

  async executePayoutItem(itemId: string): Promise<ExecutionOutcome> {
    const loaded = await this.repo.getPayoutItemForExecution(itemId);
    if (!loaded) {
      throw new Error(`payout item not found: ${itemId}`);
    }
    const { item, payout, workspace } = loaded;
    const state = toState(item.status);

    if (state === "completed") {
      return { kind: "completed", itemId, executionId: item.keeperhub_execution_id, transactionHash: item.transaction_hash };
    }
    if (state === "cancelled" || state === "validation_failed" || state === "simulation_failed") {
      return {
        kind: "not_executable",
        itemId,
        reason: `payout item is in ${state}; execution is not permitted from this state`,
      };
    }

    if (
      workspace.chain_id !== this.config.chainId ||
      workspace.token_address !== this.config.tokenAddress ||
      payout.chain_id !== this.config.chainId ||
      payout.token_address !== this.config.tokenAddress
    ) {
      return {
        kind: "not_executable",
        itemId,
        reason: "workspace/payout chain or token does not match the MVP execution configuration",
      };
    }

    if (item.keeperhub_execution_id) {
      return this.reconcileExistingExecution(item, payout, workspace);
    }

    if (RESUME_FROM.includes(state)) {
      return this.markAmbiguous(item, payout, workspace, "state requires an execution ID but none is stored; outcome cannot be determined safely");
    }

    if (state !== "approved") {
      return {
        kind: "not_executable",
        itemId,
        reason: `payout item is in ${state}; execution requires the approved state`,
      };
    }

    return this.runNewExecution(item, payout, workspace);
  }

  /**
   * Keeps the payout status in step with the item where the state machine
   * permits it. The item is the authority for execution state; a payout that
   * cannot legally follow (possible only in synthetic/manual states) is left
   * untouched rather than forced.
   */
  private async syncPayoutState(repo: SolvoRepository, payoutId: string, to: ExecutionState): Promise<void> {
    if (!this.syncPayout) return;
    const payout = await repo.getPayoutById(payoutId);
    if (!payout) return;
    const current = toState(payout.status);
    if (current === to) return;
    if (canTransition(current, to)) {
      await repo.transitionPayoutState(payoutId, [current], to);
    }
  }

  /**
   * Same guarded principle for items during reconciliation: settle toward the
   * observed KeeperHub state only when the state machine permits it. An item
   * left in a state the machine will not advance (e.g. execution_unknown while
   * the execution is still in flight) stays there — the truthful, observable
   * state for manual resolution.
   */
  private async syncItemState(repo: SolvoRepository, itemId: string, to: ExecutionState): Promise<void> {
    const item = await repo.getPayoutItemById(itemId);
    if (!item) return;
    const current = toState(item.status);
    if (current === to) return;
    if (canTransition(current, to)) {
      await repo.transitionPayoutItemState(itemId, [current], to);
    }
  }

  private async reconcileExistingExecution(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
  ): Promise<ExecutionOutcome> {
    const executionId = item.keeperhub_execution_id as string;

    let status: SolvoDirectExecutionStatus;
    try {
      status = await this.keeperhub.getDirectExecutionStatus(executionId);
    } catch {
      return this.markAmbiguous(
        item,
        payout,
        workspace,
        `existing KeeperHub execution ${executionId} could not be inspected; no rebroadcast attempted`,
      );
    }

    if (status.status === "completed") {
      if (!status.transactionHash) {
        return this.markAmbiguous(
          item,
          payout,
          workspace,
          `KeeperHub reported completed without a transaction hash for ${executionId}`,
        );
      }
      await this.repo.transaction(async (tx) => {
        await tx.completePayoutItem(item.id, status.transactionHash as string, status.transactionLink ?? "");
        await tx.transitionPayoutItemState(item.id, RECONCILE_FROM, "completed");
        await this.syncPayoutState(tx, payout.id, "completed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_completed",
          actorType: "system",
          metadata: { reconciliation: true, executionId, transactionHash: status.transactionHash },
        });
      });
      return {
        kind: "completed",
        itemId: item.id,
        executionId,
        transactionHash: status.transactionHash,
      };
    }

    if (status.status === "failed") {
      await this.repo.transaction(async (tx) => {
        await tx.failPayoutItem(item.id);
        await tx.transitionPayoutItemState(item.id, RECONCILE_FROM, "execution_failed");
        await this.syncPayoutState(tx, payout.id, "execution_failed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_failed",
          actorType: "system",
          metadata: { reconciliation: true, executionId, error: status.error },
        });
      });
      return { kind: "failed", itemId: item.id, executionId, message: status.error ?? "execution failed" };
    }

    if (status.status === "pending" || status.status === "running") {
      await this.repo.transaction(async (tx) => {
        await this.syncItemState(tx, item.id, "confirming");
        await this.syncPayoutState(tx, payout.id, "confirming");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_confirming",
          actorType: "system",
          metadata: { reconciliation: true, executionId },
        });
      });
      return {
        kind: "unknown",
        itemId: item.id,
        executionId,
        reason: `existing execution ${executionId} is still in flight; no rebroadcast attempted`,
      };
    }

    return this.markAmbiguous(
      item,
      payout,
      workspace,
      `existing execution ${executionId} has unknown status; no rebroadcast attempted`,
    );
  }

  private async markAmbiguous(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
    reason: string,
  ): Promise<ExecutionOutcome> {
    await this.repo.transaction(async (tx) => {
      if (item.status !== "execution_unknown") {
        await tx.transitionPayoutItemState(item.id, RESUME_FROM, "execution_unknown");
        await this.syncPayoutState(tx, payout.id, "execution_unknown");
      }
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "execution_unknown",
        actorType: "system",
        metadata: { reason, executionId: item.keeperhub_execution_id },
      });
    });
    return { kind: "unknown", itemId: item.id, executionId: item.keeperhub_execution_id, reason };
  }

  private async runNewExecution(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
  ): Promise<ExecutionOutcome> {
    const latest = await this.repo.getLatestAttempt(item.id);
    const attemptNumber = latest ? latest.attempt_number + 1 : 1;

    const attempt = await this.repo.transaction(async (tx) => {
      await tx.transitionPayoutItemState(item.id, ["approved"], "simulating");
      await this.syncPayoutState(tx, payout.id, "simulating");
      const created = await tx.createExecutionAttempt({
        payoutItemId: item.id,
        attemptNumber,
        phase: "simulation",
      });
      await tx.setPayoutItemAttemptCount(item.id, attemptNumber);
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "simulation_started",
        actorType: "system",
        metadata: { attemptNumber },
      });
      return created;
    });

    const amount = baseUnitsToUsdc(BigInt(item.amount_base_units));
    const transferRequest = {
      chainId: this.config.chainId,
      recipientAddress: item.recipient_address,
      amount,
      tokenAddress: this.config.tokenAddress,
      integrationId: this.config.integrationId,
    };

    let simulation: SolvoSimulationResult;
    try {
      simulation = await this.keeperhub.simulateTransfer(transferRequest);
    } catch (error) {
      const reason = errorMessage(error);
      console.error(
        "[solvo] simulation transport failure (server-side; nothing was broadcast)",
        { payoutItemId: item.id, attemptNumber, errorCode: "simulation_transport_failure", errorMessage: reason },
      );
      await this.repo.transaction(async (tx) => {
        await tx.updateExecutionAttempt(attempt.id, {
          status: "failed",
          errorCode: "simulation_transport_failure",
          errorMessage: reason,
          completedAt: new Date().toISOString(),
        });
        await tx.transitionPayoutItemState(item.id, ["simulating"], "simulation_failed");
        await this.syncPayoutState(tx, payout.id, "simulation_failed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "simulation_failed",
          actorType: "system",
          metadata: { attemptNumber, reason: "simulation transport failure" },
        });
      });
      return { kind: "failed", itemId: item.id, executionId: null, message: "simulation could not run; nothing was broadcast" };
    }

    if (!simulation.success || simulation.wouldRevert) {
      const errorCode = simulation.code ?? "simulation_reverted";
      const errorMessageValue = simulation.revertReason ?? simulation.error ?? "the transfer would revert";
      console.error(
        "[solvo] KeeperHub simulation failed (server-side; nothing was broadcast)",
        { payoutItemId: item.id, attemptNumber, errorCode, errorMessage: errorMessageValue },
      );
      await this.repo.transaction(async (tx) => {
        await tx.updateExecutionAttempt(attempt.id, {
          simulationResult: simulation as unknown as Record<string, unknown>,
          status: "failed",
          errorCode,
          errorMessage: errorMessageValue,
          completedAt: new Date().toISOString(),
        });
        await tx.transitionPayoutItemState(item.id, ["simulating"], "simulation_failed");
        await this.syncPayoutState(tx, payout.id, "simulation_failed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "simulation_failed",
          actorType: "system",
          metadata: { attemptNumber, errorCode, errorMessage: errorMessageValue },
        });
      });
      return { kind: "failed", itemId: item.id, executionId: null, message: "simulation failed; nothing was broadcast" };
    }

    await this.repo.transaction(async (tx) => {
      await tx.updateExecutionAttempt(attempt.id, {
        phase: "execution",
        simulationResult: simulation as unknown as Record<string, unknown>,
        status: "running",
      });
      await tx.transitionPayoutItemState(item.id, ["simulating"], "submitted");
      await this.syncPayoutState(tx, payout.id, "submitted");
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "simulation_passed",
        actorType: "system",
        metadata: { attemptNumber },
      });
    });

    const keeperhubKey = deriveIdempotencyKey({
      taskId: item.idempotency_key,
      chainId: this.config.chainId,
      recipientAddress: item.recipient_address,
      amount,
      tokenAddress: this.config.tokenAddress,
      integrationId: this.config.integrationId,
    });

    let execution: SolvoDirectExecutionStatus;
    try {
      execution = await this.keeperhub.executeTransfer({ ...transferRequest, idempotencyKey: keeperhubKey });
    } catch (error) {
      return this.persistExecuteFailure(item, payout, workspace, attempt.id, attemptNumber, error);
    }

    const executionId = execution.executionId;
    if (!executionId) {
      return this.persistAmbiguousAfterExecute(
        item,
        payout,
        workspace,
        attempt.id,
        attemptNumber,
        "KeeperHub accepted the request but returned no execution ID; outcome cannot be determined safely",
      );
    }

    if (execution.status === "completed") {
      if (!execution.transactionHash) {
        return this.persistAmbiguousAfterExecute(
          item,
          payout,
          workspace,
          attempt.id,
          attemptNumber,
          `KeeperHub reported completed without a transaction hash (execution ${executionId})`,
        );
      }
      await this.repo.transaction(async (tx) => {
        await tx.setPayoutItemKeeperHubExecution(item.id, executionId);
        await tx.updateExecutionAttempt(attempt.id, {
          keeperhubExecutionId: executionId,
          transactionHash: execution.transactionHash,
          rawKeeperhubStatus: execution as unknown as Record<string, unknown>,
          status: "succeeded",
          completedAt: new Date().toISOString(),
        });
        await tx.completePayoutItem(item.id, execution.transactionHash as string, execution.transactionLink ?? "");
        await tx.transitionPayoutItemState(item.id, ["submitted"], "completed");
        await this.syncPayoutState(tx, payout.id, "completed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_submitted",
          actorType: "system",
          metadata: { attemptNumber, executionId },
        });
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_completed",
          actorType: "system",
          metadata: { attemptNumber, executionId, transactionHash: execution.transactionHash },
        });
      });
      return {
        kind: "completed",
        itemId: item.id,
        executionId,
        transactionHash: execution.transactionHash,
      };
    }

    if (execution.status === "failed") {
      await this.persistFailedExecution(item, payout, workspace, attempt.id, attemptNumber, executionId, execution.error ?? "execution failed");
      return { kind: "failed", itemId: item.id, executionId, message: execution.error ?? "execution failed" };
    }

    await this.repo.transaction(async (tx) => {
      await tx.setPayoutItemKeeperHubExecution(item.id, executionId);
      await tx.updateExecutionAttempt(attempt.id, {
        keeperhubExecutionId: executionId,
        rawKeeperhubStatus: execution as unknown as Record<string, unknown>,
      });
      await tx.transitionPayoutItemState(item.id, ["submitted"], "confirming");
      await this.syncPayoutState(tx, payout.id, "confirming");
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "execution_submitted",
        actorType: "system",
        metadata: { attemptNumber, executionId },
      });
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "execution_confirming",
        actorType: "system",
        metadata: { attemptNumber, executionId },
      });
    });

    let terminal: SolvoDirectExecutionStatus;
    try {
      terminal = await this.keeperhub.pollUntilTerminal(executionId);
    } catch {
      await this.repo.transaction(async (tx) => {
        await tx.markPayoutItemUnknown(item.id);
        await tx.updateExecutionAttempt(attempt.id, {
          status: "unknown",
          errorCode: "polling_failure",
          errorMessage: "execution state could not be determined after polling",
        });
        await tx.transitionPayoutItemState(item.id, ["confirming"], "execution_unknown");
        await this.syncPayoutState(tx, payout.id, "execution_unknown");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_unknown",
          actorType: "system",
          metadata: { attemptNumber, executionId, reason: "polling_failure" },
        });
      });
      return {
        kind: "unknown",
        itemId: item.id,
        executionId,
        reason: `execution ${executionId} did not reach a terminal state; no rebroadcast attempted`,
      };
    }

    if (terminal.status === "completed") {
      if (!terminal.transactionHash) {
        await this.repo.transaction(async (tx) => {
          await tx.markPayoutItemUnknown(item.id);
          await tx.updateExecutionAttempt(attempt.id, {
            status: "unknown",
            errorCode: "completed_without_hash",
            errorMessage: "KeeperHub reported completed without a transaction hash",
          });
          await tx.transitionPayoutItemState(item.id, ["confirming"], "execution_unknown");
          await this.syncPayoutState(tx, payout.id, "execution_unknown");
          await tx.appendAuditEvent({
            workspaceId: workspace.id,
            payoutId: payout.id,
            payoutItemId: item.id,
            eventType: "execution_unknown",
            actorType: "system",
            metadata: { attemptNumber, executionId, reason: "completed_without_hash" },
          });
        });
        return { kind: "unknown", itemId: item.id, executionId, reason: "completed reported without a transaction hash" };
      }
      await this.repo.transaction(async (tx) => {
        await tx.completePayoutItem(item.id, terminal.transactionHash as string, terminal.transactionLink ?? "");
        await tx.updateExecutionAttempt(attempt.id, {
          transactionHash: terminal.transactionHash,
          rawKeeperhubStatus: terminal as unknown as Record<string, unknown>,
          status: "succeeded",
          completedAt: new Date().toISOString(),
        });
        await tx.transitionPayoutItemState(item.id, ["confirming"], "completed");
        await this.syncPayoutState(tx, payout.id, "completed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_completed",
          actorType: "system",
          metadata: { attemptNumber, executionId, transactionHash: terminal.transactionHash },
        });
      });
      return { kind: "completed", itemId: item.id, executionId, transactionHash: terminal.transactionHash };
    }

    await this.persistFailedExecution(item, payout, workspace, attempt.id, attemptNumber, executionId, terminal.error ?? "execution failed");
    return { kind: "failed", itemId: item.id, executionId, message: terminal.error ?? "execution failed" };
  }

  private async persistExecuteFailure(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
    attemptId: string,
    attemptNumber: number,
    error: unknown,
  ): Promise<ExecutionOutcome> {
    const message = errorMessage(error);
    // A malformed/unparseable response is as ambiguous as a transport failure:
    // the transfer may or may not have happened, so it must never be recorded
    // as a definite rejection (or success).
    const ambiguous =
      /transport|timeout|fetch|aborted|unknown|malformed|unexpected token|parse|syntaxerror|invalid (response|json)|json parse/i.test(
        message,
      );
    await this.repo.transaction(async (tx) => {
      await tx.updateExecutionAttempt(attemptId, {
        status: ambiguous ? "unknown" : "failed",
        errorCode: ambiguous ? "execution_outcome_unknown" : "execution_rejected",
        errorMessage: message,
        completedAt: ambiguous ? null : new Date().toISOString(),
      });
      if (ambiguous) {
        await tx.transitionPayoutItemState(item.id, ["submitted"], "execution_unknown");
        await this.syncPayoutState(tx, payout.id, "execution_unknown");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_unknown",
          actorType: "system",
          metadata: { attemptNumber, reason: "execute_transfer transport failure; outcome unknown, no rebroadcast" },
        });
      } else {
        await tx.transitionPayoutItemState(item.id, ["submitted"], "execution_failed");
        await this.syncPayoutState(tx, payout.id, "execution_failed");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: item.id,
          eventType: "execution_failed",
          actorType: "system",
          metadata: { attemptNumber, reason: "execute_transfer rejected before execution" },
        });
      }
    });
    if (ambiguous) {
      return {
        kind: "unknown",
        itemId: item.id,
        executionId: null,
        reason: `execute_transfer outcome unknown: ${message}; no rebroadcast attempted`,
      };
    }
    return {
      kind: "failed",
      itemId: item.id,
      executionId: null,
      message: `KeeperHub rejected execution: ${message}`,
    };
  }

  private async persistFailedExecution(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
    attemptId: string,
    attemptNumber: number,
    executionId: string,
    error: string,
  ): Promise<void> {
    await this.repo.transaction(async (tx) => {
      await tx.failPayoutItem(item.id);
      await tx.updateExecutionAttempt(attemptId, {
        status: "failed",
        errorCode: "execution_failed",
        errorMessage: error,
        completedAt: new Date().toISOString(),
      });
      await tx.transitionPayoutItemState(item.id, ["submitted", "confirming"], "execution_failed");
      await this.syncPayoutState(tx, payout.id, "execution_failed");
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "execution_failed",
        actorType: "system",
        metadata: { attemptNumber, executionId, error },
      });
    });
  }

  private async persistAmbiguousAfterExecute(
    item: PayoutItemRow,
    payout: PayoutRow,
    workspace: WorkspaceRow,
    attemptId: string,
    attemptNumber: number,
    reason: string,
  ): Promise<ExecutionOutcome> {
    await this.repo.transaction(async (tx) => {
      await tx.markPayoutItemUnknown(item.id);
      await tx.updateExecutionAttempt(attemptId, {
        status: "unknown",
        errorCode: "execution_outcome_unknown",
        errorMessage: reason,
      });
      await tx.transitionPayoutItemState(item.id, ["submitted"], "execution_unknown");
      await this.syncPayoutState(tx, payout.id, "execution_unknown");
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "execution_unknown",
        actorType: "system",
        metadata: { attemptNumber, reason },
      });
    });
    return { kind: "unknown", itemId: item.id, executionId: null, reason };
  }
}

function toState(value: string): ExecutionState {
  if (isExecutionState(value)) return value;
  throw new Error(`invalid stored state: ${value}`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
