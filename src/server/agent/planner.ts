import type { SolvoRepository } from "../db/repository.ts";
import type { WorkspaceMemberRow, WorkspaceRow } from "../db/types.ts";
import { canonicalizeAmountLocal, usdcToBaseUnitsLocal, type ExtractionResult } from "./extraction.ts";
import { validateAgentInterpretation } from "./schema.ts";
import {
  inspectPaymentPolicyTool,
  inspectPaymentStatusTool,
  resolveRecipientTool,
  validateClaimRequestTool,
  type AgentToolContext,
} from "./tools.ts";
import type { AgentInterpretation, MissingFieldKey } from "./types.ts";

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

export type AgentPlannerDecision =
  | { decision: "ask_clarifying_question"; planAction: "ask_clarifying_question"; missingFields: MissingFieldKey[]; question: string }
  | { decision: "prepared_payment"; planAction: "prepare_payment"; prepared: PreparedPaymentData }
  | { decision: "prepared_claim_link"; planAction: "create_claim_link"; prepared: PreparedClaimData }
  | { decision: "status_visible"; planAction: "inspect_payment_status"; status: StatusVisibleData }
  | { decision: "status_not_found"; planAction: "inspect_payment_status"; payoutId: string }
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
        // M10.3: the parser recognizes batch intent; planning/persistence
        // lands in M10.4/M10.5. Until then the planner fails safe with no
        // payout or claim artifacts.
        return {
          decision: "unsupported",
          planAction: "decline_unsupported",
          reason: "Batch payments are not wired yet.",
        };
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
