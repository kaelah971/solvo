import type { SolvoRepository } from "../../db/repository.ts";
import type { PayoutItemRow, PayoutRow, WorkspaceMemberRow, WorkspaceRow } from "../../db/types.ts";
import { ExecutionService, type KeeperHubExecutionGateway } from "../../execution/execution-service.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../../keeperhub/config.ts";
import {
  approvedProgressBlock,
  callbackAlreadyHandledMessage,
  callbackInvalidMessage,
  callbackSelfApprovalMessage,
  callbackUnauthorizedMessage,
  callbackWrongChatMessage,
  paymentApprovedExecutingMessage,
  paymentNotApprovedMessage,
  communityProofMessage,
} from "../community-messages.ts";
import { batchReceipt } from "../batch-messages.ts";
import { evaluateBatchApproval, evaluateCommunityApproval } from "../policy.ts";
import { getRealExecutionGateway } from "./execution-gateway.ts";
import { executeBatch } from "./batch-execution.ts";
import type { ApprovalCallbackInput, ApprovalCallbackResult } from "../types.ts";

export type ApprovalFlowDeps = {
  repo: SolvoRepository;
  /** injected for tests; default is the real KeeperHub adapter */
  gateway?: KeeperHubExecutionGateway;
  /** best-effort progress edits during batch execution */
  onItemProgress?: (message: string) => Promise<void>;
};

export type ApprovalContext = {
  workspace: WorkspaceRow;
  payout: PayoutRow;
  items: PayoutItemRow[];
  totalBaseUnits: string;
  actorRole: "owner" | "approver";
  actorUserId: string;
  action: "approve" | "reject";
};

export type ApprovalValidation =
  | { ok: true; context: ApprovalContext }
  | { ok: false; result: ApprovalCallbackResult };

class ApprovalPolicyBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "ApprovalPolicyBlockedError";
    this.reason = reason;
  }
}

const DAILY_SPEND_STATES = [
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "execution_unknown",
] as const;

function utcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function totalOfItems(items: PayoutItemRow[]): string {
  return items.reduce((sum, item) => sum + BigInt(item.amount_base_units), 0n).toString();
}

/**
 * Cheap, KeeperHub-free validation of an inline APPROVE/REJECT callback.
 * Runs only database reads, so it can complete well inside Telegram's
 * callback acknowledgement window. Returns a rejection result (already
 * handled / unauthorized / self-approval / wrong chat / blocked) or a
 * validated context ready for the atomic transition.
 */
export async function validateApprovalCallback(
  input: ApprovalCallbackInput,
  deps: ApprovalFlowDeps,
): Promise<ApprovalValidation> {
  const { payoutId, action, actorUserId, chatId } = input;

  const payout = await deps.repo.getPayoutById(payoutId);
  if (!payout) return { ok: false, result: callbackAlreadyHandledMessage() };

  const workspace = await deps.repo.getWorkspaceById(payout.workspace_id);
  if (!workspace) return { ok: false, result: callbackAlreadyHandledMessage() };
  if (workspace.mode !== "community" || workspace.telegram_chat_id !== chatId) {
    return { ok: false, result: callbackWrongChatMessage() };
  }

  const member = await deps.repo.getWorkspaceMember(workspace.id, actorUserId);
  if (!member || member.status !== "active" || member.role === "member") {
    return { ok: false, result: callbackUnauthorizedMessage() };
  }
  const actorRole: "owner" | "approver" = member.role === "owner" ? "owner" : "approver";

  const items = await deps.repo.getPayoutItemsByPayoutId(payoutId);
  if (items.length === 0) return { ok: false, result: callbackInvalidMessage() };
  if (!items.every((item) => item.status === "pending_approval")) {
    return { ok: false, result: callbackAlreadyHandledMessage() };
  }

  const actorIsRequester = payout.requester_id !== null && payout.requester_id === actorUserId;
  const totalBaseUnits = totalOfItems(items);
  const dailySpend = await deps.repo.sumPayoutItemsByWorkspaceStates(
    workspace.id,
    DAILY_SPEND_STATES,
    utcDayStartIso(),
  );

  if (action === "approve") {
    if (actorIsRequester) {
      return { ok: false, result: callbackSelfApprovalMessage() };
    }
    const policy =
      items.length > 1
        ? evaluateBatchApproval({
            workspaceActive: workspace.status === "active",
            actorRole,
            actorIsRequester,
            items: items.map((item) => ({
              amountBaseUnits: item.amount_base_units,
              perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
            })),
            totalBaseUnits,
            dailyLimitBaseUnits: workspace.daily_limit_base_units,
            currentDailySpendBaseUnits: dailySpend,
          })
        : evaluateCommunityApproval({
            workspaceActive: workspace.status === "active",
            actorRole,
            actorIsRequester,
            perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
            dailyLimitBaseUnits: workspace.daily_limit_base_units,
            currentDailySpendBaseUnits: dailySpend,
            amountBaseUnits: totalBaseUnits,
          });
    if (policy.decision === "blocked") {
      return { ok: false, result: { answer: policy.reason } };
    }
    return { ok: true, context: { workspace, payout, items, totalBaseUnits, actorRole, actorUserId, action } };
  }

  return { ok: true, context: { workspace, payout, items, totalBaseUnits, actorRole, actorUserId, action } };
}

/**
 * Applies a validated approval: atomic DB transition (every item in the same
 * transaction), then for approvals the existing M2 execution pipeline —
 * item by item for batches. Returns the final message content.
 */
export async function applyApprovalCallback(
  context: ApprovalContext,
  deps: ApprovalFlowDeps,
): Promise<ApprovalCallbackResult> {
  const { payout, items, action, actorRole, actorUserId, workspace } = context;

  if (action === "approve") {
    try {
      await deps.repo.transaction(async (tx) => {
        const dailySpend = await tx.sumPayoutItemsByWorkspaceStates(
          workspace.id,
          DAILY_SPEND_STATES,
          utcDayStartIso(),
        );
        const recheck =
          items.length > 1
            ? evaluateBatchApproval({
                workspaceActive: workspace.status === "active",
                actorRole,
                actorIsRequester: payout.requester_id !== null && payout.requester_id === actorUserId,
                items: items.map((item) => ({
                  amountBaseUnits: item.amount_base_units,
                  perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
                })),
                totalBaseUnits: context.totalBaseUnits,
                dailyLimitBaseUnits: workspace.daily_limit_base_units,
                currentDailySpendBaseUnits: dailySpend,
              })
            : evaluateCommunityApproval({
                workspaceActive: workspace.status === "active",
                actorRole,
                actorIsRequester: payout.requester_id !== null && payout.requester_id === actorUserId,
                perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
                dailyLimitBaseUnits: workspace.daily_limit_base_units,
                currentDailySpendBaseUnits: dailySpend,
                amountBaseUnits: context.totalBaseUnits,
              });
        if (recheck.decision === "blocked") {
          throw new ApprovalPolicyBlockedError(recheck.reason);
        }
        for (const item of items) {
          await tx.strictTransitionPayoutItemState(item.id, ["pending_approval"], "approved");
        }
        await tx.transitionPayoutState(payout.id, ["pending_approval"], "approved");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: payout.id,
          payoutItemId: null,
          eventType: "approval_granted",
          actorType: actorTypeForRole(actorRole),
          actorId: actorUserId,
          metadata: {
            role: actorRole,
            reason: recheck.reason,
            itemCount: items.length,
            totalBaseUnits: context.totalBaseUnits,
          },
        });
      });
    } catch (error) {
      if (error instanceof ApprovalPolicyBlockedError) {
        return { answer: error.reason, edited: error.reason };
      }
      return callbackAlreadyHandledMessage();
    }

    if (items.length > 1) {
      return applyBatchExecution(context, deps);
    }

    const edited = [
      approvedProgressBlock(actorUserId, actorRole),
      "",
      paymentApprovedExecutingMessage(),
    ].join("\n");

    const outcome = await runExecution(items[0].id, deps);
    if (outcome.kind === "completed") {
      return {
        answer: "Payment approved and completed.",
        edited: [
          edited,
          "",
          communityProofMessage(outcome.executionId ?? "", outcome.transactionHash ?? ""),
        ].join("\n"),
        executed: true,
      };
    }
    return {
      answer: "Payment approved.",
      edited,
      executed: true,
    };
  }

  try {
    await deps.repo.transaction(async (tx) => {
      for (const item of items) {
        await tx.strictTransitionPayoutItemState(item.id, ["pending_approval"], "cancelled");
      }
      await tx.transitionPayoutState(payout.id, ["pending_approval"], "cancelled");
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: null,
        eventType: "approval_rejected",
        actorType: actorTypeForRole(actorRole),
        actorId: actorUserId,
        metadata: { role: actorRole, itemCount: items.length },
      });
    });
  } catch {
    return callbackAlreadyHandledMessage();
  }

  return {
    answer: "Payment rejected.",
    edited: paymentNotApprovedMessage(),
  };
}

async function applyBatchExecution(
  context: ApprovalContext,
  deps: ApprovalFlowDeps,
): Promise<ApprovalCallbackResult> {
  const { payout, items, workspace } = context;
  const gateway = deps.gateway ?? getRealExecutionGateway();

  const result = await executeBatch(deps.repo, gateway, payout, workspace, items, deps.onItemProgress);

  const receipt = batchReceipt(
    result.items.map((outcome) => ({
      label: outcome.label,
      status: outcome.status,
      transactionHash: outcome.transactionHash,
      amountBaseUnits: outcome.amountBaseUnits,
    })),
    result.totalBaseUnits,
  );

  if (result.aggregate === "completed") {
    return {
      answer: "Payment approved and completed.",
      edited: receipt,
      executed: true,
    };
  }
  return {
    answer: "Payment approved.",
    edited: receipt,
    executed: true,
  };
}

/**
 * Combined entry point: validate then apply. Kept for callers that handle
 * acknowledgement themselves (tests, non-Telegram surfaces).
 */
export async function handleApprovalCallback(
  input: ApprovalCallbackInput,
  deps: ApprovalFlowDeps,
): Promise<ApprovalCallbackResult> {
  const validation = await validateApprovalCallback(input, deps);
  if (!validation.ok) return validation.result;
  return applyApprovalCallback(validation.context, deps);
}

async function runExecution(
  itemId: string,
  deps: ApprovalFlowDeps,
): Promise<ReturnType<ExecutionService["executePayoutItem"]>> {
  const gateway = deps.gateway ?? getRealExecutionGateway();
  const execution = new ExecutionService(deps.repo, gateway, {
    chainId: KEEPERHUB_CHAIN_ID,
    tokenAddress: KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase(),
  });
  return execution.executePayoutItem(itemId);
}

function actorTypeForRole(role: WorkspaceMemberRow["role"]): string {
  switch (role) {
    case "owner":
      return "workspace_owner";
    case "approver":
      return "approver";
    default:
      return "member";
  }
}
