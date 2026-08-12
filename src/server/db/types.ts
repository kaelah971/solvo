import type { AgentRunStatus } from "../agent/types.ts";

export type WorkspaceMode = "sandbox" | "development" | "personal" | "community" | "judge";

export type ClaimStatus = "created" | "claimed" | "expired" | "cancelled" | "approved" | "executed";

/**
 * Authoritative claim lifecycle graph, enforced inside the repository (both
 * Postgres and memory) regardless of the from-list a caller passes:
 *
 *   created → claimed → approved → executed
 *   created → cancelled
 *   claimed → cancelled
 *   (expired is an effective terminal state, never stored)
 *
 * Impossible transitions (executed→claimed, cancelled→approved,
 * cancelled→executed, expired→claimed, ...) are rejected by the database
 * layer itself.
 */
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  created: ["claimed", "cancelled"],
  claimed: ["approved", "cancelled"],
  approved: ["executed"],
  executed: [],
  expired: [],
  cancelled: [],
};

export function canClaimTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export type ClaimLinkRow = {
  id: string;
  workspace_id: string;
  requester_id: string;
  amount_base_units: string;
  currency_symbol: string;
  chain_id: string;
  token_address: string;
  token_hash: string;
  token_prefix: string;
  status: ClaimStatus;
  claimed_recipient: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  expires_at: string;
  payout_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRow = {
  id: string;
  mode: WorkspaceMode;
  name: string | null;
  telegram_chat_id: string | null;
  chain_id: string;
  token_address: string;
  per_transaction_limit_base_units: string | null;
  daily_limit_base_units: string | null;
  approval_policy: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type MemberRole = "owner" | "approver" | "member";

export type WorkspaceMemberRow = {
  id: string;
  workspace_id: string;
  telegram_user_id: string;
  role: MemberRole;
  status: "active" | "removed";
  created_at: string;
  updated_at: string;
};

export type RecipientRow = {
  id: string;
  workspace_id: string;
  alias: string;
  wallet_address: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PayoutSourceType =
  | "direct"
  | "claim_link"
  | "batch_csv"
  | "m1_proof"
  | "telegram_command"
  | "telegram_natural_language"
  | "telegram_batch"
  | "judge_telegram";

export type PayoutRow = {
  id: string;
  workspace_id: string;
  requester_id: string | null;
  source_type: PayoutSourceType;
  status: string;
  total_amount_base_units: string;
  currency_symbol: string;
  chain_id: string;
  token_address: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
};

export type PayoutItemRow = {
  id: string;
  payout_id: string;
  recipient_address: string;
  amount_base_units: string;
  memo: string | null;
  status: string;
  keeperhub_execution_id: string | null;
  transaction_hash: string | null;
  transaction_explorer_url: string | null;
  attempt_count: number;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ExecutionAttemptRow = {
  id: string;
  payout_item_id: string;
  attempt_number: number;
  phase: "simulation" | "execution";
  keeperhub_execution_id: string | null;
  transaction_hash: string | null;
  simulation_result: Record<string, unknown> | null;
  status: "running" | "succeeded" | "failed" | "unknown";
  error_code: string | null;
  error_message: string | null;
  raw_keeperhub_status: Record<string, unknown> | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AuditEventRow = {
  id: string;
  workspace_id: string;
  payout_id: string | null;
  payout_item_id: string | null;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type PayoutWithRelations = {
  item: PayoutItemRow;
  payout: PayoutRow;
  workspace: WorkspaceRow;
};

/**
 * Observational record of one agent orchestration run. Deliberately carries
 * NO payout/claim state machine: it only records what the agent proposed,
 * decided, and linked to. Payment truth lives in payouts / claim_links.
 */
export type AgentRunRow = {
  id: string;
  workspace_id: string | null;
  surface: string;
  telegram_chat_id: string | null;
  telegram_user_id: string | null;
  telegram_message_id: string | null;
  idempotency_key: string;
  provider: string;
  status: AgentRunStatus;
  intent_kind: string | null;
  plan_action: string | null;
  decision_type: string | null;
  input_hash: string;
  raw_text_redacted: string | null;
  candidates_json: Record<string, unknown>;
  interpretation_json: Record<string, unknown> | null;
  decision_json: Record<string, unknown> | null;
  error_code: string | null;
  error_message_redacted: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  payout_id: string | null;
  claim_id: string | null;
};
