import type { WorkspaceMode } from "../db/types.ts";

/**
 * M8 — Agentic payment orchestrator contract types.
 *
 * The agent layer is a PROPOSAL engine: these types describe what a bounded
 * interpreter may propose and what the deterministic application may plan.
 * Nothing in this file implies execution authority. There is intentionally
 * NO execution tool, NO KeeperHub call, and NO payout mutation surface here.
 */

/** Supported message surfaces. Bounded; only Telegram exists today. */
export type AgentSurface = "telegram";

/**
 * Normalized, sanitized agent input. Carries only what the interpreter needs;
 * never carries secrets, credentials, tokens, or authorization material.
 */
export type AgentInput = {
  surface: AgentSurface;
  /** Telegram chat id (group chat id for community workspaces). */
  chatId: string;
  /** Telegram numeric user id — the trusted identity primitive. */
  userId: string;
  /** Telegram message id; null when the update has no message. */
  messageId: number | null;
  /** Raw user text. Treated as hostile data; never persisted verbatim. */
  rawText: string;
  /** Caller-supplied UTC ISO timestamp. Never synthesized by the parser. */
  timestampIso: string;
  /** Sanitized workspace context (no secrets). Null when unknown. */
  workspace: SanitizedWorkspaceContext | null;
  /** Mode/context flags. */
  flags: AgentInputFlags;
  /** Deterministically extracted candidates (provenance carriers). */
  candidates: PaymentCandidates;
};

/** Sanitized workspace context: what the model may see. No env/keys. */
export type SanitizedWorkspaceContext = {
  id: string;
  mode: WorkspaceMode;
  chainId: string;
  tokenAddress: string;
  aliases: string[];
  perTransactionLimitUsdc: string | null;
  dailyLimitUsdc: string | null;
  workspaceActive: boolean;
};

export type AgentInputFlags = {
  workspaceMode: WorkspaceMode | null;
  isMember: boolean;
};

/**
 * External action vocabulary (plan §3). Maps 1:1 to a bounded intent kind via
 * `classifyAgentAction`. No execution action exists here.
 */
export type AgentAction = "pay" | "claim_pay" | "status" | "unknown";

export const AGENT_ACTIONS: readonly AgentAction[] = ["pay", "claim_pay", "status", "unknown"];

export function isAgentAction(value: unknown): value is AgentAction {
  return (AGENT_ACTIONS as readonly unknown[]).includes(value);
}

/**
 * Bounded internal intent classification. `clarify_missing_fields` is a
 * planner-stage intent (produced as ask_clarifying_question); interpretation
 * in S1 yields one of the other four via `classifyAgentAction`.
 */
export type AgentIntentKind =
  | "prepare_payment"
  | "create_claim_link"
  | "inspect_payment_status"
  | "clarify_missing_fields"
  | "unsupported";

export const AGENT_INTENT_KINDS: readonly AgentIntentKind[] = [
  "prepare_payment",
  "create_claim_link",
  "inspect_payment_status",
  "clarify_missing_fields",
  "unsupported",
];

export function isAgentIntentKind(value: unknown): value is AgentIntentKind {
  return (AGENT_INTENT_KINDS as readonly unknown[]).includes(value);
}

export function classifyAgentAction(action: AgentAction): AgentIntentKind {
  switch (action) {
    case "pay":
      return "prepare_payment";
    case "claim_pay":
      return "create_claim_link";
    case "status":
      return "inspect_payment_status";
    case "unknown":
      return "unsupported";
  }
}

// ── Candidate extraction (provenance carriers) ─────────────────────────────

/** Where a candidate came from. */
export type CandidateSourceField =
  | "raw_amount"
  | "raw_token"
  | "raw_chain"
  | "raw_address"
  | "raw_alias"
  | "raw_payout_id"
  | "workspace_config";

export type CandidateValidationStatus = "valid" | "invalid" | "pending";

type CandidateBase = {
  /** Verbatim text as it appeared (or the config value verbatim). */
  raw: string;
  /** Normalized form (canonical decimal, lowercase address/alias, ...). */
  normalized: string | null;
  validationStatus: CandidateValidationStatus;
};

export type CandidateAmount = CandidateBase & {
  sourceField: "raw_amount";
  /** Associated token symbol (lowercase) when the amount is directly
   * followed by a token mention in the source text. */
  token?: string | null;
  /** Deterministic integer base units (6-decimal USDC) when well formed. */
  baseUnits?: string | null;
};
export type CandidateToken = CandidateBase & { sourceField: "raw_token" };
export type CandidateChain = CandidateBase & { sourceField: "raw_chain" | "workspace_config" };
export type CandidateAddress = CandidateBase & { sourceField: "raw_address" };
export type CandidateAlias = CandidateBase & { sourceField: "raw_alias" };
export type CandidatePayoutId = CandidateBase & { sourceField: "raw_payout_id" };
export type CandidateClaimAmount = CandidateBase & {
  sourceField: "raw_amount";
  token?: string | null;
  baseUnits?: string | null;
};

export type PaymentCandidates = {
  amounts: CandidateAmount[];
  tokens: CandidateToken[];
  chains: CandidateChain[];
  addresses: CandidateAddress[];
  aliases: CandidateAlias[];
  payoutIds: CandidatePayoutId[];
  claimAmounts: CandidateClaimAmount[];
};

// ── Structured intent ──────────────────────────────────────────────────────

export type RecipientKind = "address" | "alias" | "username" | "name" | null;

export type PaymentRecipient = {
  /** Original surface form, e.g. "daniel", "@daniel", "0xabc...". */
  raw: string | null;
  kind: RecipientKind;
  /** Verbatim address string IF deterministically extracted (provenance). */
  address: string | null;
  /** Workspace alias IF deterministically matched (provenance). */
  alias: string | null;
};

/** Canonical missing-field keys. */
export type MissingFieldKey = "amount" | "recipient" | "currency" | "workspace";

export const MISSING_FIELD_KEYS: readonly MissingFieldKey[] = [
  "amount",
  "recipient",
  "currency",
  "workspace",
];

export type PaymentIntent = {
  action: AgentAction;
  /**
   * Deterministically selected amount TEXT. Provenance-bound: must equal a
   * candidate raw/normalized value. Never executed directly — the planner
   * re-derives authoritative integer base units.
   */
  amount: string | null;
  /** "USDC" only; anything else fails closed. */
  currency: "USDC" | null;
  recipient: PaymentRecipient | null;
  /** Display-only free text (≤140 chars, sanitized). Never authoritative. */
  memo: string | null;
  missingFields: MissingFieldKey[];
  /** The candidate set the interpreter was allowed to select from. */
  candidates: PaymentCandidates;
  source: "natural_language";
};

/**
 * Schema-validated interpretation produced by an IntentInterpreter.
 * `intentKind` must equal `classifyAgentAction(intent.action)`.
 */
export type AgentInterpretation = {
  intent: PaymentIntent;
  intentKind: AgentIntentKind;
  /** Short sanitized paraphrase for audit; never the raw message. */
  summary: string;
  /** Provider identifier (e.g. "static"); never keys or credentials. */
  provider: string;
};

// ── Bounded plan ───────────────────────────────────────────────────────────

/**
 * Safe next-step actions the deterministic application may take. There is
 * deliberately NO execution action: execution happens only through the
 * existing human approval pipeline and `/judgepay`, never through a plan.
 */
export type AgentPlanAction =
  | "ask_clarifying_question"
  | "prepare_payment"
  | "create_claim_link"
  | "inspect_payment_status"
  | "decline_unsupported";

export const AGENT_PLAN_ACTIONS: readonly AgentPlanAction[] = [
  "ask_clarifying_question",
  "prepare_payment",
  "create_claim_link",
  "inspect_payment_status",
  "decline_unsupported",
];

export function isAgentPlanAction(value: unknown): value is AgentPlanAction {
  return (AGENT_PLAN_ACTIONS as readonly unknown[]).includes(value);
}

export type AgentPlan =
  | { action: "ask_clarifying_question"; missingFields: MissingFieldKey[]; question: string }
  | {
      action: "prepare_payment";
      payout: {
        recipientAddress: string;
        amountBaseUnits: string;
        memo: string | null;
      };
    }
  | { action: "create_claim_link"; claim: { amountBaseUnits: string } }
  | { action: "inspect_payment_status"; payoutId: string | null }
  | { action: "decline_unsupported"; reason: string };

// ── Result ─────────────────────────────────────────────────────────────────

export type AgentReplyMeta = {
  text: string;
  buttons: Array<{ text: string; callbackData: string }>;
};

export type AgentResult = {
  intent: PaymentIntent | null;
  plan: AgentPlan | null;
  candidates: PaymentCandidates;
  reply: AgentReplyMeta | null;
  safetyFlags: string[];
};

// ── Run recording (observability ONLY — never a second state machine) ─────

/**
 * The nine recording states for an agent run. Deliberately excludes every
 * payout/claim machine state: agent_runs never duplicates payment truth.
 * Once a payout or claim exists, its persistence is authoritative.
 */
export type AgentRunStatus =
  | "received"
  | "interpreted"
  | "planned"
  | "needs_clarification"
  | "prepared"
  | "claim_created"
  | "blocked"
  | "unknown"
  | "failed";

export const AGENT_RUN_STATUSES: readonly AgentRunStatus[] = [
  "received",
  "interpreted",
  "planned",
  "needs_clarification",
  "prepared",
  "claim_created",
  "blocked",
  "unknown",
  "failed",
];

export function isAgentRunStatus(value: unknown): value is AgentRunStatus {
  return (AGENT_RUN_STATUSES as readonly unknown[]).includes(value);
}
