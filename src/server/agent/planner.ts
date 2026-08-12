import type { SolvoRepository } from "../db/repository.ts";
import type { WorkspaceMemberRow, WorkspaceRow } from "../db/types.ts";
import { evaluateBatchRequest } from "../telegram/policy.ts";
import { canonicalizeAmountLocal, usdcToBaseUnitsLocal, type ExtractionResult } from "./extraction.ts";
import { validateAgentInterpretation } from "./schema.ts";
import {
  inspectPaymentPolicyTool,
  inspectPaymentStatusTool,
  resolveRecipientTool,
  validateClaimRequestTool,
  type AgentToolContext,
} from "./tools.ts";
import type { AgentInterpretation, BatchPaymentMode, MissingFieldKey } from "./types.ts";

/**
 * M8 — Deterministic agent planner.
 *
 * Pure application logic: it decides the next safe step from an
 * interpretation + extraction + injected context. It never performs
 * irreversible actions — no payouts, no claims, no approvals, no execution.
 * Repository access is injected; everything stays offline and deterministic.
 */

export type AgentPlannerContext = {
  repo: SolvoRepository;
  workspace: WorkspaceRow | null;
  member: WorkspaceMemberRow | null;
  userId: string;
  /** Claim expiry policy (hours) when available; informational only. */
  claimExpiryHours?: number | null;
};

export type PreparedPaymentData = {
  recipientAddress: string;
  recipientAlias: string | null;
  amountBaseUnits: string;
  currency: "USDC";
  chainId: string;
  tokenAddress: string;
  memo: string | null;
  approvalRequired: boolean;
  policyReason: string;
  perTxLimitUsdc: string | null;
  remainingPerTxUsdc: string | null;
};

export type PreparedClaimData = {
  source: "claim_request" | "recipient_unresolved";
  amountBaseUnits: string;
  currency: "USDC";
  chainId: string;
  tokenAddress: string;
  expiryHours: number | null;
};

export type StatusVisibleData = {
  payoutId: string;
  state: string;
  itemCount: number;
  completedAt: string | null;
};

/**
 * One resolved batch leg. `address` is the normalized EVM destination; the
 * label is the alias (lowercase) or a short "0x1234…" address — display only,
 * never authoritative. Amounts are canonical integer base units plus a
 * display-only USDC decimal (the bridge re-derives money from base units).
 */
export type PreparedBatchRecipientData = {
  label: string;
  address: string;
  amountBaseUnits: string;
  amountDisplay: string;
  memo: string | null;
};

/**
 * M10.4 — a planner-level prepared batch (pending human approval). Pure
 * proposal data: nothing here persists, approves, or executes. Persistence
 * lands in M10.5 via an application-owned bridge.
 */
export type PreparedBatchData = {
  recipients: PreparedBatchRecipientData[];
  totalAmountBaseUnits: string;
  totalAmountDisplay: string;
  currency: "USDC";
  chainId: string;
  tokenAddress: string;
  approvalRequired: true;
  policyReason: string;
  perTxLimitUsdc: string | null;
  remainingPerTxUsdc: string | null;
  memo: string | null;
  /** Parsed grammar mode (uniform "each", equal split, explicit amounts). */
  mode: BatchPaymentMode;
  source: "natural_language";
  /** Reserved for future safe user-facing warnings; v1 decisions never populate it. */
  warnings: string[];
};

export type AgentPlannerDecision =
  | { decision: "ask_clarifying_question"; planAction: "ask_clarifying_question"; missingFields: MissingFieldKey[]; question: string }
  | { decision: "prepared_payment"; planAction: "prepare_payment"; prepared: PreparedPaymentData }
  | { decision: "prepared_claim_link"; planAction: "create_claim_link"; prepared: PreparedClaimData }
  | { decision: "status_visible"; planAction: "inspect_payment_status"; status: StatusVisibleData }
  | { decision: "status_not_found"; planAction: "inspect_payment_status"; payoutId: string }
  | { decision: "prepared_batch_payment"; planAction: "prepare_batch_payment"; batch: PreparedBatchData }
  | { decision: "blocked"; planAction: "decline_unsupported"; reason: string }
  | { decision: "unsupported"; planAction: "decline_unsupported"; reason: string };

export class AgentPlanner {
  private readonly context: AgentPlannerContext;

  constructor(context: AgentPlannerContext) {
    this.context = context;
  }

  async plan(extraction: ExtractionResult, interpretation: AgentInterpretation): Promise<AgentPlannerDecision> {
    const validation = validateAgentInterpretation(interpretation);
    if (!validation.ok) {
      return { decision: "unsupported", planAction: "decline_unsupported", reason: "The interpretation could not be validated." };
    }

    switch (interpretation.intentKind) {
      case "prepare_payment":
        return this.planPayment(extraction, interpretation);
      case "create_claim_link":
        return this.planClaim(extraction, interpretation);
      case "inspect_payment_status":
        return this.planStatus(extraction, interpretation);
      case "clarify_missing_fields":
        return this.clarify(interpretation.intent.missingFields);
      case "unsupported":
        return { decision: "unsupported", planAction: "decline_unsupported", reason: interpretation.summary };
      case "prepare_batch_payment":
        // M10.4: parsed NL batch intents become a planner-level
        // prepared_batch_payment decision (all-or-clarify, policy-checked).
        // No persistence here — the M10.5 bridge owns payout creation.
        return this.planBatch(extraction, interpretation);
    }
  }

  /** Safety checks applied defensively inside every actionable path. */
  private safetyGate(extraction: ExtractionResult): AgentPlannerDecision | null {
    if (extraction.unsafeFlags.length > 0) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Instruction contains unsafe text." };
    }
    const invalidToken = extraction.candidates.tokens.some((candidate) => candidate.validationStatus === "invalid");
    const invalidChain = extraction.candidates.chains.some((candidate) => candidate.validationStatus === "invalid");
    if (invalidToken || invalidChain) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Unsupported token or chain." };
    }
    return null;
  }

  // ── Payment planning ─────────────────────────────────────────────────────

  private async planPayment(extraction: ExtractionResult, interpretation: AgentInterpretation): Promise<AgentPlannerDecision> {
    const safety = this.safetyGate(extraction);
    if (safety) return safety;
    const gate = this.contextGate();
    if (gate) return gate;

    const workspace = this.context.workspace as WorkspaceRow;
    const intent = interpretation.intent;

    if (intent.amount === null) {
      return this.clarify(["amount"]);
    }
    const amountBaseUnits = this.amountToBaseUnits(intent.amount);
    if (amountBaseUnits === null) {
      return this.clarify(["amount"]);
    }
    if (intent.currency === null) {
      return this.clarify(["currency"]);
    }

    if (intent.recipient === null) {
      return this.clarify(["recipient"]);
    }
    const candidate = intent.recipient.address ?? intent.recipient.alias ?? intent.recipient.raw;
    if (candidate === null) {
      return this.clarify(["recipient"]);
    }
    const resolution = await resolveRecipientTool(this.toolContext(workspace), { candidate });

    if (resolution.status === "ambiguous") {
      return this.clarify(["recipient"]);
    }
    if (resolution.status === "invalid") {
      return { decision: "blocked", planAction: "decline_unsupported", reason: resolution.reason };
    }
    if (resolution.status === "needs_resolution") {
      return { decision: "blocked", planAction: "decline_unsupported", reason: resolution.reason };
    }
    if (resolution.status === "unresolved") {
      // No verified destination exists: the supported safe path is a claim
      // link (created later by the application-owned service, never here).
      return this.preparedClaim("recipient_unresolved", workspace, amountBaseUnits);
    }

    const policy = await inspectPaymentPolicyTool(this.toolContext(workspace), {
      amountBaseUnits,
      token: intent.currency,
      chainId: workspace.chain_id,
    });
    if (policy.denied || (!policy.allowed && policy.missingContext)) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: policy.reason };
    }

    return {
      decision: "prepared_payment",
      planAction: "prepare_payment",
      prepared: {
        recipientAddress: resolution.address,
        recipientAlias: resolution.alias,
        amountBaseUnits,
        currency: "USDC",
        chainId: workspace.chain_id,
        tokenAddress: workspace.token_address.toLowerCase(),
        memo: intent.memo,
        approvalRequired: policy.approvalRequired,
        policyReason: policy.reason,
        perTxLimitUsdc: policy.perTxLimitUsdc,
        remainingPerTxUsdc: policy.remainingPerTxUsdc,
      },
    };
  }

  // ── Claim-link planning ──────────────────────────────────────────────────

  private async planClaim(extraction: ExtractionResult, interpretation: AgentInterpretation): Promise<AgentPlannerDecision> {
    const safety = this.safetyGate(extraction);
    if (safety) return safety;
    const gate = this.contextGate();
    if (gate) return gate;

    const workspace = this.context.workspace as WorkspaceRow;
    const intent = interpretation.intent;

    if (intent.amount === null) {
      return this.clarify(["amount"]);
    }
    const amountBaseUnits = this.amountToBaseUnits(intent.amount);
    if (amountBaseUnits === null) {
      return this.clarify(["amount"]);
    }

    const validation = await validateClaimRequestTool(this.toolContext(workspace), {
      amount: intent.amount,
      token: intent.currency,
      chainId: workspace.chain_id,
    });
    if (validation.status !== "valid") {
      return {
        decision: "blocked",
        planAction: "decline_unsupported",
        reason: validation.status === "needs_context" ? "Workspace context is required to plan a claim link." : validation.reason,
      };
    }

    return {
      decision: "prepared_claim_link",
      planAction: "create_claim_link",
      prepared: {
        source: "claim_request",
        amountBaseUnits,
        currency: "USDC",
        chainId: validation.claim.chainId,
        tokenAddress: validation.claim.tokenAddress,
        expiryHours: this.context.claimExpiryHours ?? null,
      },
    };
  }

  // ── Status planning ──────────────────────────────────────────────────────

  private async planStatus(extraction: ExtractionResult, interpretation: AgentInterpretation): Promise<AgentPlannerDecision> {
    const safety = this.safetyGate(extraction);
    if (safety) return safety;
    const gate = this.contextGate();
    if (gate) return gate;

    const workspace = this.context.workspace as WorkspaceRow;
    const payoutId = interpretation.intent.candidates.payoutIds.find((candidate) => candidate.validationStatus === "valid")?.normalized ?? null;
    if (payoutId === null) {
      return this.clarify(["payout_id"]);
    }

    const inspection = await inspectPaymentStatusTool(this.toolContext(workspace), { payoutId });
    switch (inspection.status) {
      case "visible":
        return {
          decision: "status_visible",
          planAction: "inspect_payment_status",
          status: {
            payoutId: inspection.payoutId,
            state: inspection.state,
            itemCount: inspection.itemCount,
            completedAt: inspection.completedAt,
          },
        };
      case "not_found":
        return { decision: "status_not_found", planAction: "inspect_payment_status", payoutId: inspection.payoutId };
      case "malformed":
        return { decision: "blocked", planAction: "decline_unsupported", reason: inspection.reason };
      case "forbidden":
        return { decision: "blocked", planAction: "decline_unsupported", reason: inspection.reason };
    }
  }

  // ── Batch payment planning (M10.4) ───────────────────────────────────────

  /**
   * Plans a parsed NL batch intent into a `prepared_batch_payment` decision.
   * The decision exists ONLY when every leg resolves to a verified
   * destination, no two legs share an address, every amount is positive, the
   * workspace is community with an active member, and the deterministic batch
   * policy (evaluateBatchRequest — per-item per-tx limits + daily total)
   * passes. Any failure returns a clarification or a safe decline — never a
   * partial batch, and never a payout/claim artifact (M10.5 owns persistence).
   */
  private async planBatch(extraction: ExtractionResult, interpretation: AgentInterpretation): Promise<AgentPlannerDecision> {
    const safety = this.safetyGate(extraction);
    if (safety) return safety;
    const gate = this.contextGate();
    if (gate) return gate;

    const workspace = this.context.workspace as WorkspaceRow;
    const batch = interpretation.intent.batch;
    if (batch === null) {
      return { decision: "unsupported", planAction: "decline_unsupported", reason: "The batch intent is incomplete." };
    }
    if (batch.currency !== "USDC") {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Only Base USDC batches can be prepared." };
    }
    if (batch.chainId !== BASE_CHAIN_ID) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Only Base batches can be prepared." };
    }
    if (batch.recipients.length < 2 || batch.recipients.length > BATCH_MAX_PLAN_RECIPIENTS) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "A batch requires between 2 and 10 recipients." };
    }

    // All-or-clarify resolution: every leg must resolve to a verified
    // destination before any batch decision can exist.
    const recipients: PreparedBatchRecipientData[] = [];
    const seenAddresses = new Set<string>();
    for (const recipient of batch.recipients) {
      let address: string;
      if (recipient.address !== null) {
        if (recipient.address.toLowerCase() === ZERO_ADDRESS) {
          return { decision: "blocked", planAction: "decline_unsupported", reason: "The zero address is not an acceptable batch recipient." };
        }
        address = recipient.address.toLowerCase();
      } else {
        const resolution = await resolveRecipientTool(this.toolContext(workspace), { candidate: recipient.label });
        if (resolution.status === "unresolved" || resolution.status === "ambiguous") {
          return this.clarify(["recipient"]);
        }
        if (resolution.status === "invalid" || resolution.status === "needs_resolution") {
          return { decision: "blocked", planAction: "decline_unsupported", reason: resolution.reason };
        }
        address = resolution.address.toLowerCase();
      }
      if (seenAddresses.has(address)) {
        return {
          decision: "blocked",
          planAction: "decline_unsupported",
          reason: "Duplicate recipient: two batch legs resolve to the same address.",
        };
      }
      seenAddresses.add(address);
      const amountUnits = BigInt(recipient.amountBaseUnits);
      if (amountUnits <= 0n) {
        return { decision: "blocked", planAction: "decline_unsupported", reason: "Every batch amount must be greater than zero." };
      }
      recipients.push({
        label: /^0x/i.test(recipient.label) ? shortAddress(address) : recipient.label.toLowerCase(),
        address,
        amountBaseUnits: amountUnits.toString(),
        amountDisplay: baseUnitsToUsdcDecimal(amountUnits.toString()),
        memo: null,
      });
    }

    // Deterministic policy: per-item per-tx limits + total daily limit
    // (mirrors the M5 /batch command path; the transactional approval-time
    // re-check remains authoritative once the M10.5 bridge exists).
    const dailySpend = await this.context.repo.sumPayoutItemsByWorkspaceStates(
      workspace.id,
      DAILY_SPEND_STATES,
      utcDayStartIso(),
    );
    const policy = evaluateBatchRequest({
      workspaceActive: workspace.status === "active",
      isMember: this.context.member !== null && this.context.member.status === "active",
      chainId: workspace.chain_id,
      tokenAddress: workspace.token_address,
      items: recipients.map((recipient) => ({
        amountBaseUnits: recipient.amountBaseUnits,
        perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
      })),
      totalBaseUnits: batch.totalAmountBaseUnits,
      dailyLimitBaseUnits: workspace.daily_limit_base_units,
      currentDailySpendBaseUnits: dailySpend,
    });
    if (policy.decision === "blocked") {
      return { decision: "blocked", planAction: "decline_unsupported", reason: policy.reason };
    }

    const maxItemUnits = recipients.reduce(
      (max, recipient) => (BigInt(recipient.amountBaseUnits) > max ? BigInt(recipient.amountBaseUnits) : max),
      0n,
    );
    const perTxLimitUsdc =
      workspace.per_transaction_limit_base_units !== null
        ? baseUnitsToUsdcDecimal(workspace.per_transaction_limit_base_units)
        : null;
    const remainingPerTxUsdc =
      workspace.per_transaction_limit_base_units !== null
        ? baseUnitsToUsdcDecimal((BigInt(workspace.per_transaction_limit_base_units) - maxItemUnits).toString())
        : null;

    return {
      decision: "prepared_batch_payment",
      planAction: "prepare_batch_payment",
      batch: {
        recipients,
        totalAmountBaseUnits: batch.totalAmountBaseUnits,
        totalAmountDisplay: baseUnitsToUsdcDecimal(batch.totalAmountBaseUnits),
        currency: "USDC",
        chainId: workspace.chain_id,
        tokenAddress: workspace.token_address.toLowerCase(),
        approvalRequired: true,
        policyReason: policy.reason,
        perTxLimitUsdc,
        remainingPerTxUsdc,
        memo: batch.memo,
        mode: batch.mode,
        source: "natural_language",
        warnings: [],
      },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private clarify(missingFields: MissingFieldKey[]): AgentPlannerDecision {
    return {
      decision: "ask_clarifying_question",
      planAction: "ask_clarifying_question",
      missingFields,
      question: `Please provide: ${missingFields.join(", ")}.`,
    };
  }

  private preparedClaim(
    source: "claim_request" | "recipient_unresolved",
    workspace: WorkspaceRow,
    amountBaseUnits: string,
  ): AgentPlannerDecision {
    return {
      decision: "prepared_claim_link",
      planAction: "create_claim_link",
      prepared: {
        source,
        amountBaseUnits,
        currency: "USDC",
        chainId: workspace.chain_id,
        tokenAddress: workspace.token_address.toLowerCase(),
        expiryHours: this.context.claimExpiryHours ?? null,
      },
    };
  }

  /**
   * Conservative gate: community workspace + active member required. Judge
   * Mode and every other mode are blocked here — the agent planner can never
   * be a second execution surface.
   */
  private contextGate(): AgentPlannerDecision | null {
    const { workspace, member } = this.context;
    if (workspace === null) {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Workspace context is required." };
    }
    if (workspace.mode !== "community") {
      return {
        decision: "blocked",
        planAction: "decline_unsupported",
        reason: "Natural-language planning is only available in a community workspace.",
      };
    }
    if (member === null || member.status !== "active") {
      return { decision: "blocked", planAction: "decline_unsupported", reason: "Workspace membership is required." };
    }
    return null;
  }

  private amountToBaseUnits(amount: string): string | null {
    const canonical = canonicalizeAmountLocal(amount);
    if (canonical === "invalid" || canonical === "0") return null;
    return usdcToBaseUnitsLocal(canonical);
  }

  private toolContext(workspace: WorkspaceRow): AgentToolContext {
    return {
      repo: this.context.repo,
      workspace,
      member: this.context.member,
      userId: this.context.userId,
    };
  }
}

const BASE_CHAIN_ID = "8453";
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const BATCH_MAX_PLAN_RECIPIENTS = 10;

/** Daily-spend states mirrored from the M5 /batch command path. */
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

/** Display-only short address label ("0x1234abcd…"), mirroring the /batch flow. */
function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…`;
}

/** Integer base units → USDC decimal string for display (never authoritative). */
function baseUnitsToUsdcDecimal(value: string): string {
  const v = BigInt(value);
  const whole = v / 1000000n;
  const fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}
