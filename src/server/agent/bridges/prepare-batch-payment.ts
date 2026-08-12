import type { SolvoRepository } from "../../db/repository.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../db/types.ts";
import { evaluateBatchRequest } from "../../telegram/policy.ts";
import { approvalCallbackData } from "../../telegram/community-messages.ts";
import type { AgentPlannerDecision, PreparedBatchData } from "../planner.ts";

/**
 * M10.5 — prepare_batch_payment application bridge.
 *
 * The ONLY application-owned path that turns a planner-level
 * `prepared_batch_payment` decision into a real `pending_approval` batch
 * payout reusing the canonical M5 batch persistence shape: ONE `payouts`
 * row (`source_type = 'telegram_batch'`) + N `payout_items` rows, all
 * pending_approval, plus per-item `request_created` audits and ONE batch
 * `approval_required` audit. It is NOT a model-facing tool.
 *
 * Authority boundary: the bridge creates a request that waits for a human
 * owner/approver. It cannot approve, self-approve, simulate, execute, call
 * KeeperHub, or fabricate proof — the existing M5 approval/execution pipeline
 * stays the only path from pending_approval to execution. Judge Mode and
 * claim-link batches never reach this bridge.
 */

export type PrepareBatchPaymentBridgeInput = {
  decision: AgentPlannerDecision;
  run: AgentRunRow;
  workspace: WorkspaceRow;
  member: WorkspaceMemberRow;
  userId: string;
};

export type PrepareBatchPaymentBridgeResult = {
  outcome: "created" | "existing";
  payoutId: string;
  itemCount: number;
  totalAmountBaseUnits: string;
  recipients: Array<{
    label: string;
    address: string;
    amountBaseUnits: string;
    memo: string | null;
  }>;
  /** Sanitized batch reason; display-only, never authoritative. */
  memo: string | null;
  state: string;
  approvalRequired: boolean;
  buttons: Array<{ text: string; callbackData: string }>;
};

export type PrepareBatchPaymentBridgeDeps = {
  repo: SolvoRepository;
};

export type PrepareBatchPaymentBridgeErrorCode =
  | "invalid_decision"
  | "workspace_required"
  | "member_required"
  | "community_only"
  | "judge_blocked"
  | "invalid_payload"
  | "policy_blocked";

export class PrepareBatchPaymentBridgeError extends Error {
  readonly code: PrepareBatchPaymentBridgeErrorCode;

  constructor(code: PrepareBatchPaymentBridgeErrorCode, message: string) {
    super(message);
    this.name = "PrepareBatchPaymentBridgeError";
    this.code = code;
  }
}

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS_PATTERN = /^\d+$/;
const MAX_BATCH_RECIPIENTS = 10;
const MIN_BATCH_RECIPIENTS = 2;
const BATCH_SOURCE = "telegram_natural_language_batch";

/** Daily-spend states mirrored from the M5 /batch command path. */
const DAILY_SPEND_STATES = [
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "execution_unknown",
] as const;

export async function bridgePreparedBatchPayment(
  input: PrepareBatchPaymentBridgeInput,
  deps: PrepareBatchPaymentBridgeDeps,
): Promise<PrepareBatchPaymentBridgeResult> {
  if (input.decision.decision !== "prepared_batch_payment") {
    throw new PrepareBatchPaymentBridgeError(
      "invalid_decision",
      `The prepare-batch bridge only accepts prepared_batch_payment decisions (got ${input.decision.decision}).`,
    );
  }
  if (input.workspace === null || input.workspace === undefined) {
    throw new PrepareBatchPaymentBridgeError("workspace_required", "Workspace context is required to prepare a batch payment.");
  }
  if (input.member === null || input.member === undefined || input.member.status !== "active") {
    throw new PrepareBatchPaymentBridgeError("member_required", "Active workspace membership is required to prepare a batch payment.");
  }
  if (input.workspace.mode === "judge") {
    throw new PrepareBatchPaymentBridgeError("judge_blocked", "Judge Mode is not reachable through the agent bridge.");
  }
  if (input.workspace.mode !== "community") {
    throw new PrepareBatchPaymentBridgeError(
      "community_only",
      "Agent batch payments are only prepared in community workspaces.",
    );
  }

  const prepared = input.decision.batch;
  validatePreparedBatchPayload(prepared, input.workspace);

  // Deterministic policy recheck (per-item per-tx limits + total daily
  // limit). The authoritative daily-cap re-check still happens at approval
  // time inside the existing transition transaction.
  const dailySpend = await deps.repo.sumPayoutItemsByWorkspaceStates(
    input.workspace.id,
    DAILY_SPEND_STATES,
    utcDayStartIso(),
  );
  const policy = evaluateBatchRequest({
    workspaceActive: input.workspace.status === "active",
    isMember: true,
    chainId: input.workspace.chain_id,
    tokenAddress: input.workspace.token_address,
    items: prepared.recipients.map((recipient) => ({
      amountBaseUnits: recipient.amountBaseUnits,
      perTransactionLimitBaseUnits: input.workspace.per_transaction_limit_base_units,
    })),
    totalBaseUnits: prepared.totalAmountBaseUnits,
    dailyLimitBaseUnits: input.workspace.daily_limit_base_units,
    currentDailySpendBaseUnits: dailySpend,
  });
  if (policy.decision === "blocked") {
    throw new PrepareBatchPaymentBridgeError("policy_blocked", policy.reason);
  }

  const firstItemKey = `ag:${input.run.idempotency_key}:batch:0`;

  const persisted = await deps.repo.transaction(async (tx) => {
    // Serialize identical deliveries: concurrent bridge calls resolve to ONE
    // payout, never a second batch intent (advisory lock on the first item
    // key mirrors the M5 command batch flow).
    await tx.lockIdempotencyKey(firstItemKey);
    const raced = await tx.getPayoutItemByIdempotencyKey(firstItemKey);
    if (raced) {
      const payout = await tx.getPayoutById(raced.payout_id);
      if (!payout) {
        throw new PrepareBatchPaymentBridgeError("invalid_payload", "The existing batch payout could not be loaded.");
      }
      await tx.updateAgentRun(input.run.id, { status: "prepared", payoutId: payout.id });
      return { existing: true, payout };
    }

    const payout = await tx.createPayout({
      workspaceId: input.workspace.id,
      requesterId: input.userId,
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: prepared.totalAmountBaseUnits,
      currencySymbol: "USDC",
      chainId: input.workspace.chain_id,
      tokenAddress: input.workspace.token_address,
    });
    for (let index = 0; index < prepared.recipients.length; index += 1) {
      const recipient = prepared.recipients[index];
      const { item, created } = await tx.createPayoutItem({
        payoutId: payout.id,
        recipientAddress: recipient.address.toLowerCase(),
        amountBaseUnits: recipient.amountBaseUnits,
        memo: recipient.label,
        status: "pending_approval",
        idempotencyKey: `ag:${input.run.idempotency_key}:batch:${index}`,
      });
      if (!created) {
        throw new PrepareBatchPaymentBridgeError("invalid_payload", "The batch item idempotency key collided.");
      }
      await tx.appendAuditEvent({
        workspaceId: input.workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "request_created",
        actorType: "member",
        actorId: input.userId,
        metadata: {
          source: BATCH_SOURCE,
          channel: "telegram",
          label: recipient.label,
          index,
          agentRunId: input.run.id,
        },
      });
    }
    await tx.appendAuditEvent({
      workspaceId: input.workspace.id,
      payoutId: payout.id,
      payoutItemId: null,
      eventType: "approval_required",
      actorType: "member",
      actorId: input.userId,
      metadata: {
        reason: policy.reason,
        itemCount: prepared.recipients.length,
        totalBaseUnits: prepared.totalAmountBaseUnits,
        source: BATCH_SOURCE,
        agentRunId: input.run.id,
      },
    });
    await tx.updateAgentRun(input.run.id, {
      status: "prepared",
      intentKind: "prepare_batch_payment",
      planAction: "prepare_batch_payment",
      decisionType: "prepared_batch_payment",
      payoutId: payout.id,
      decisionJson: {
        decision: "prepared_batch_payment",
        itemCount: prepared.recipients.length,
        totalAmountBaseUnits: prepared.totalAmountBaseUnits,
        source: BATCH_SOURCE,
        memo: prepared.memo,
      },
    });
    return { existing: false, payout };
  });

  return {
    outcome: persisted.existing ? "existing" : "created",
    payoutId: persisted.payout.id,
    itemCount: prepared.recipients.length,
    totalAmountBaseUnits: prepared.totalAmountBaseUnits,
    recipients: prepared.recipients.map((recipient) => ({
      label: recipient.label,
      address: recipient.address,
      amountBaseUnits: recipient.amountBaseUnits,
      memo: recipient.memo,
    })),
    memo: prepared.memo,
    state: persisted.payout.status,
    approvalRequired: true,
    buttons: [
      { text: "APPROVE BATCH", callbackData: approvalCallbackData("approve", persisted.payout.id) },
      { text: "REJECT", callbackData: approvalCallbackData("reject", persisted.payout.id) },
    ],
  };
}

function validatePreparedBatchPayload(prepared: PreparedBatchData, workspace: WorkspaceRow): void {
  if (prepared.currency !== "USDC") {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", "Only Base USDC batch payments can be prepared.");
  }
  if (prepared.chainId !== workspace.chain_id) {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", "The prepared batch chain does not match the workspace.");
  }
  if (prepared.tokenAddress.toLowerCase() !== workspace.token_address.toLowerCase()) {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", "The prepared batch token does not match the workspace.");
  }
  if (
    !Array.isArray(prepared.recipients) ||
    prepared.recipients.length < MIN_BATCH_RECIPIENTS ||
    prepared.recipients.length > MAX_BATCH_RECIPIENTS
  ) {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", `A batch requires ${MIN_BATCH_RECIPIENTS}-${MAX_BATCH_RECIPIENTS} recipients.`);
  }
  if (!BASE_UNITS_PATTERN.test(prepared.totalAmountBaseUnits) || BigInt(prepared.totalAmountBaseUnits) <= 0n) {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", "The prepared batch total is invalid.");
  }
  const seenAddresses = new Set<string>();
  for (const recipient of prepared.recipients) {
    if (!HEX_ADDRESS_PATTERN.test(recipient.address)) {
      throw new PrepareBatchPaymentBridgeError("invalid_payload", "A prepared batch recipient address is invalid.");
    }
    const normalized = recipient.address.toLowerCase();
    if (seenAddresses.has(normalized)) {
      throw new PrepareBatchPaymentBridgeError("invalid_payload", "Duplicate recipient: two batch legs resolve to the same address.");
    }
    seenAddresses.add(normalized);
    if (!BASE_UNITS_PATTERN.test(recipient.amountBaseUnits) || BigInt(recipient.amountBaseUnits) <= 0n) {
      throw new PrepareBatchPaymentBridgeError("invalid_payload", "A prepared batch item amount is invalid.");
    }
    if (recipient.label.length === 0) {
      throw new PrepareBatchPaymentBridgeError("invalid_payload", "A prepared batch item label is required.");
    }
  }
  const sum = prepared.recipients.reduce((acc, recipient) => acc + BigInt(recipient.amountBaseUnits), 0n);
  if (sum.toString() !== prepared.totalAmountBaseUnits) {
    throw new PrepareBatchPaymentBridgeError("invalid_payload", "The prepared batch total must equal the sum of item amounts.");
  }
}

function utcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}
