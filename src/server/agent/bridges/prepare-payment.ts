import type { SolvoRepository } from "../../db/repository.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../db/types.ts";
import type { AgentPlannerDecision, PreparedPaymentData } from "../planner.ts";
import { inspectPaymentPolicyTool } from "../tools.ts";
import { approvalCallbackData } from "../../telegram/community-messages.ts";

/**
 * M8 — prepare_payment application bridge.
 *
 * The ONLY application-owned path that turns a `prepared_payment` planner
 * decision into a real `pending_approval` payout + payout_item. Called by
 * deterministic Solvo orchestration AFTER schema validation, extraction,
 * interpretation validation, planning, and policy inspection. It is NOT a
 * model-facing tool: the model can never call it.
 *
 * Authority boundary: this bridge creates a request that waits for a human
 * owner/approver. It cannot approve, self-approve, simulate, execute, call
 * KeeperHub, or fabricate proof. The existing approval callback path is the
 * only way a payout can move from pending_approval to execution.
 */

export type PreparePaymentBridgeInput = {
  decision: AgentPlannerDecision;
  run: AgentRunRow;
  workspace: WorkspaceRow;
  member: WorkspaceMemberRow;
  userId: string;
};

export type PreparePaymentBridgeResult = {
  outcome: "created" | "existing";
  payoutId: string;
  itemId: string;
  amountBaseUnits: string;
  recipientAddress: string;
  recipientAlias: string | null;
  /** Sanitized user-supplied reason; display-only, never authoritative. */
  memo: string | null;
  state: string;
  approvalRequired: boolean;
  buttons: Array<{ text: string; callbackData: string }>;
};

export type PreparePaymentBridgeDeps = {
  repo: SolvoRepository;
};

export type PreparePaymentBridgeErrorCode =
  | "invalid_decision"
  | "workspace_required"
  | "member_required"
  | "community_only"
  | "judge_blocked"
  | "invalid_payload"
  | "policy_blocked";

export class PreparePaymentBridgeError extends Error {
  readonly code: PreparePaymentBridgeErrorCode;

  constructor(code: PreparePaymentBridgeErrorCode, message: string) {
    super(message);
    this.name = "PreparePaymentBridgeError";
    this.code = code;
  }
}

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS_PATTERN = /^\d+$/;

export async function bridgePreparedPayment(
  input: PreparePaymentBridgeInput,
  deps: PreparePaymentBridgeDeps,
): Promise<PreparePaymentBridgeResult> {
  if (input.decision.decision !== "prepared_payment") {
    throw new PreparePaymentBridgeError(
      "invalid_decision",
      `The prepare-payment bridge only accepts prepared_payment decisions (got ${input.decision.decision}).`,
    );
  }
  if (input.workspace === null || input.workspace === undefined) {
    throw new PreparePaymentBridgeError("workspace_required", "Workspace context is required to prepare a payment.");
  }
  if (input.member === null || input.member === undefined || input.member.status !== "active") {
    throw new PreparePaymentBridgeError("member_required", "Active workspace membership is required to prepare a payment.");
  }
  if (input.workspace.mode === "judge") {
    throw new PreparePaymentBridgeError("judge_blocked", "Judge Mode is not reachable through the agent bridge.");
  }
  if (input.workspace.mode !== "community") {
    throw new PreparePaymentBridgeError(
      "community_only",
      "Agent payments are only prepared in community workspaces.",
    );
  }

  const prepared = input.decision.prepared;
  validatePreparedPayload(prepared, input.workspace);

  // Deterministic policy recheck (community request rules). The authoritative
  // daily-cap re-check still happens at approval time inside the existing
  // transition transaction.
  const policy = await inspectPaymentPolicyTool(
    { repo: deps.repo, workspace: input.workspace, member: input.member, userId: input.userId },
    { amountBaseUnits: prepared.amountBaseUnits, token: prepared.currency, chainId: prepared.chainId },
  );
  if (policy.denied || (!policy.allowed && policy.missingContext)) {
    throw new PreparePaymentBridgeError("policy_blocked", policy.reason);
  }

  const idempotencyKey = `ag:${input.run.idempotency_key}:prepare`;

  const persisted = await deps.repo.transaction(async (tx) => {
    // Serialize identical deliveries: concurrent bridge calls resolve to ONE
    // payout, never a second intent.
    await tx.lockIdempotencyKey(idempotencyKey);
    const raced = await tx.getPayoutItemByIdempotencyKey(idempotencyKey);
    if (raced) {
      const payout = await tx.getPayoutById(raced.payout_id);
      if (!payout) {
        throw new PreparePaymentBridgeError("invalid_payload", "The existing payout could not be loaded.");
      }
      await tx.updateAgentRun(input.run.id, { status: "prepared", payoutId: payout.id });
      return { existing: true, item: raced, payout };
    }

    const payout = await tx.createPayout({
      workspaceId: input.workspace.id,
      requesterId: input.userId,
      sourceType: "telegram_natural_language",
      status: "pending_approval",
      totalAmountBaseUnits: prepared.amountBaseUnits,
      currencySymbol: "USDC",
      chainId: input.workspace.chain_id,
      tokenAddress: input.workspace.token_address,
    });
    const { item } = await tx.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: prepared.recipientAddress,
      amountBaseUnits: prepared.amountBaseUnits,
      memo: prepared.memo,
      status: "pending_approval",
      idempotencyKey,
    });
    await tx.appendAuditEvent({
      workspaceId: input.workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "request_created",
      actorType: "member",
      actorId: input.userId,
      metadata: { source: "agent", channel: "telegram", agentRunId: input.run.id },
    });
    await tx.appendAuditEvent({
      workspaceId: input.workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "approval_required",
      actorType: "member",
      actorId: input.userId,
      metadata: { reason: policy.reason, agentRunId: input.run.id },
    });
    await tx.updateAgentRun(input.run.id, {
      status: "prepared",
      intentKind: "prepare_payment",
      planAction: "prepare_payment",
      decisionType: "prepared_payment",
      payoutId: payout.id,
      decisionJson: {
        decision: "prepared_payment",
        amountBaseUnits: prepared.amountBaseUnits,
        recipientAddress: prepared.recipientAddress,
        approvalRequired: true,
      },
    });
    return { existing: false, item, payout };
  });

  return {
    outcome: persisted.existing ? "existing" : "created",
    payoutId: persisted.payout.id,
    itemId: persisted.item.id,
    amountBaseUnits: prepared.amountBaseUnits,
    recipientAddress: prepared.recipientAddress,
    recipientAlias: prepared.recipientAlias,
    memo: prepared.memo,
    state: persisted.payout.status,
    approvalRequired: true,
    buttons: [
      { text: "APPROVE", callbackData: approvalCallbackData("approve", persisted.payout.id) },
      { text: "REJECT", callbackData: approvalCallbackData("reject", persisted.payout.id) },
    ],
  };
}

function validatePreparedPayload(prepared: PreparedPaymentData, workspace: WorkspaceRow): void {
  if (prepared.currency !== "USDC") {
    throw new PreparePaymentBridgeError("invalid_payload", "Only Base USDC payments can be prepared.");
  }
  if (!BASE_UNITS_PATTERN.test(prepared.amountBaseUnits) || BigInt(prepared.amountBaseUnits) <= 0n) {
    throw new PreparePaymentBridgeError("invalid_payload", "The prepared amount is invalid.");
  }
  if (!HEX_ADDRESS_PATTERN.test(prepared.recipientAddress)) {
    throw new PreparePaymentBridgeError("invalid_payload", "The prepared recipient address is invalid.");
  }
  if (prepared.chainId !== workspace.chain_id) {
    throw new PreparePaymentBridgeError("invalid_payload", "The prepared chain does not match the workspace.");
  }
  if (prepared.tokenAddress.toLowerCase() !== workspace.token_address.toLowerCase()) {
    throw new PreparePaymentBridgeError("invalid_payload", "The prepared token does not match the workspace.");
  }
}
