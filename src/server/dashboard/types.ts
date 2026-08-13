import type { ClaimEffectiveStatus } from "../claim/status.ts";
import type { PayoutSourceType, WorkspaceMode } from "../db/types.ts";

/**
 * M12 — Dashboard read-model view contracts.
 *
 * Every view is an explicit allowlist built from repository rows. Views never
 * carry: raw claim tokens, token hashes/prefixes, provider JSON blobs,
 * KeeperHub execution ids/payloads, environment values, or secrets. Views are
 * plain JSON-serializable objects.
 */

/**
 * The safe operator identity passed into every dashboard read. M12.3 will
 * populate this from the web session; M12.2 builds it from repository rows
 * via `resolveDashboardContext`. `role`/`status` are null when the user is
 * not an active member of the workspace — views then render the generic
 * unavailable screen.
 */
export type DashboardContext = {
  workspaceId: string;
  /** Telegram user id — the trusted identity primitive. */
  telegramUserId: string;
  /** Member row id; null when the user is not a workspace member. */
  memberId: string | null;
  /** Member role; null for non-members. */
  role: "owner" | "approver" | "member" | null;
  /** Member status; null for non-members. */
  status: "active" | "removed" | null;
  /** Workspace mode; null when the workspace does not exist. */
  mode: WorkspaceMode | null;
  /** Caller-supplied UTC ISO clock. */
  nowIso: string;
};

export type ClaimStatusBucket = ClaimEffectiveStatus | "unknown";

// ── Overview ───────────────────────────────────────────────────────────────

export type OverviewView = {
  workspace: {
    id: string;
    name: string | null;
    mode: WorkspaceMode | null;
    status: string | null;
  } | null;
  currentMember: {
    role: "owner" | "approver" | "member" | null;
    maskedId: string | null;
  } | null;
  /** Payout items awaiting approval (single + batch legs). */
  pendingApprovals: number;
  /** Claims whose effective status is `pending`. */
  pendingClaimLinks: number;
  /** Claims whose effective status is `claimed` (awaiting approval). */
  claimedWaitingApproval: number;
  /** Completed payout items whose completion happened today (UTC). */
  completedToday: number;
  /** Base-unit sum of items prepared today and still pending approval. */
  preparedTodayUsdc: string;
  /** Base-unit sum of items completed today. */
  completedTodayUsdc: string;
  /** Items in validation/simulation/execution-failed or unknown states. */
  failedOrUnknown: number;
  activeMembers: number;
  recipientCount: number;
  recentAuditEvents: AuditView[];
  recentAgentRuns: AgentRunView[];
  /**
   * True when the claim list used for effective-status counts hit the read
   * cap — counts are then a lower bound, never presented as exact.
   */
  claimCountCapped: boolean;
  computedAt: string;
};

// ── Payouts ────────────────────────────────────────────────────────────────

export type PayoutListItemView = {
  payoutId: string;
  sourceType: PayoutSourceType;
  sourceLabel: string;
  state: string;
  stateLabel: string;
  isBatch: boolean;
  totalUsdc: string;
  currency: string;
  itemCount: number;
  requesterLabel: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Linked claim id when this payout came from a claim approval. */
  claimId: string | null;
};

export type PayoutItemView = {
  itemId: string;
  /** Recipient label: full address for owners/approvers, masked for members. */
  recipient: string;
  /** Alias/memo label; omitted for claim payouts (claim memos carry token
   * prefixes and are never re-shown). */
  memo: string | null;
  amountUsdc: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  completedAt: string | null;
  /** Pipeline proof: tx hash + explorer link ONLY when the item is
   * `completed` and carries a transaction hash. Never invented. */
  txHash: string | null;
  txExplorerUrl: string | null;
};

export type ApproverSummary = {
  role: string;
  maskedId: string;
} | null;

export type PayoutDetailView = PayoutListItemView & {
  items: PayoutItemView[];
  /** Latest approver/rejecter from the approval audit events, else null. */
  decision: ApproverSummary;
  auditTimeline: AuditView[];
  linkedClaim: { claimId: string; effectiveStatus: ClaimStatusBucket } | null;
};

// ── Claims ─────────────────────────────────────────────────────────────────

export type ClaimListItemView = {
  claimId: string;
  effectiveStatus: ClaimStatusBucket;
  storedStatus: string;
  amountUsdc: string;
  currency: string;
  network: string;
  expiresAt: string;
  /** Masked claimed wallet (first 6 + last 4); null when not claimed. */
  maskedWallet: string | null;
  payoutId: string | null;
  requesterLabel: string | null;
  createdAt: string;
};

export type ClaimDetailView = ClaimListItemView & {
  statusView: {
    payoutState: string | null;
    itemCount: number | null;
    claimedAt: string | null;
    /** Pipeline proof ONLY when effective status is `completed`. */
    txHash: string | null;
    txExplorerUrl: string | null;
    safetyNote: string;
  };
  auditTimeline: AuditView[];
  reissueEligible: boolean;
  reissueIneligibleReason: string | null;
};

// ── Members / recipients ───────────────────────────────────────────────────

export type MemberListItemView = {
  memberId: string;
  role: "owner" | "approver" | "member";
  status: "active" | "removed";
  /** Masked telegram identity. */
  maskedId: string;
  createdAt: string;
  updatedAt: string;
};

export type RecipientListItemView = {
  recipientId: string;
  alias: string;
  /** Full wallet for owners/approvers; masked for members. */
  wallet: string;
  createdByLabel: string | null;
  createdAt: string;
  updatedAt: string;
};

// ── Audit ──────────────────────────────────────────────────────────────────

export type AuditEventSource = "payout" | "claim" | "agent" | "workspace" | "system";

export type AuditView = {
  eventId: string;
  eventType: string;
  actorType: string;
  actorMaskedId: string | null;
  createdAt: string;
  payoutId: string | null;
  payoutItemId: string | null;
  claimId: string | null;
  source: AuditEventSource;
  /** Small whitelisted metadata summary; null when nothing safe to show. */
  summary: {
    amountUsdc?: string;
    totalUsdc?: string;
    itemCount?: number;
    reason?: string;
    batchId?: string;
    oldClaimId?: string;
    newClaimId?: string;
    maskedRecipient?: string;
  } | null;
};

// ── Agent runs ─────────────────────────────────────────────────────────────

export type AgentRunView = {
  runId: string;
  surface: string;
  provider: string;
  status: string;
  intentKind: string | null;
  planAction: string | null;
  decisionType: string | null;
  linkedPayoutId: string | null;
  linkedClaimId: string | null;
  /** Already-redacted, truncated input text; null when none was stored. */
  rawTextRedacted: string | null;
  errorCode: string | null;
  errorMessageRedacted: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

/** Constant copy stating the agent-run truth boundary. */
export const AGENT_RUNS_TRUTH_NOTE =
  "Agent runs are observability only. Payment truth lives in the payout and claim records.";
