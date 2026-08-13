import type { ExecutionState } from "../execution/state-machine.ts";
import type { AgentRunStatus } from "../agent/types.ts";
import type {
  AgentRunRow,
  AuditEventRow,
  ClaimLinkRow,
  ClaimStatus,
  ExecutionAttemptRow,
  MemberRole,
  PayoutItemRow,
  PayoutRow,
  PayoutSourceType,
  PayoutWithRelations,
  RecipientRow,
  WorkspaceMemberRow,
  WorkspaceMode,
  WorkspaceRow,
} from "./types.ts";

export type CreateWorkspaceInput = {
  mode: WorkspaceMode;
  name: string | null;
  telegramChatId?: string | null;
  chainId: string;
  tokenAddress: string;
  perTransactionLimitBaseUnits: string | null;
  dailyLimitBaseUnits: string | null;
  approvalPolicy: string;
  status?: string;
};

export type CreateMemberInput = {
  workspaceId: string;
  telegramUserId: string;
  role: MemberRole;
};

export type AddRecipientInput = {
  workspaceId: string;
  alias: string;
  walletAddress: string;
  createdBy: string | null;
};

export type CreatePayoutInput = {
  workspaceId: string;
  requesterId: string | null;
  sourceType: PayoutSourceType;
  status: ExecutionState;
  totalAmountBaseUnits: string;
  currencySymbol: string;
  chainId: string;
  tokenAddress: string;
};

export type CreatePayoutItemInput = {
  payoutId: string;
  recipientAddress: string;
  amountBaseUnits: string;
  memo: string | null;
  status: ExecutionState;
  idempotencyKey: string;
};

export type CreateExecutionAttemptInput = {
  payoutItemId: string;
  attemptNumber: number;
  phase: "simulation" | "execution";
  status?: "running" | "succeeded" | "failed" | "unknown";
};

export type UpdateExecutionAttemptInput = {
  phase?: "simulation" | "execution";
  keeperhubExecutionId?: string | null;
  transactionHash?: string | null;
  simulationResult?: Record<string, unknown> | null;
  status?: "running" | "succeeded" | "failed" | "unknown";
  errorCode?: string | null;
  errorMessage?: string | null;
  rawKeeperhubStatus?: Record<string, unknown> | null;
  completedAt?: string | null;
};

export type AppendAuditEventInput = {
  workspaceId: string;
  payoutId: string | null;
  payoutItemId: string | null;
  eventType: string;
  actorType: string;
  actorId?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateAgentRunInput = {
  workspaceId: string | null;
  surface: string;
  telegramChatId: string | null;
  telegramUserId: string | null;
  telegramMessageId: string | null;
  idempotencyKey: string;
  provider: string;
  status?: AgentRunStatus;
  inputHash: string;
  rawTextRedacted?: string | null;
  candidatesJson?: Record<string, unknown> | null;
  /** Optional caller-supplied start time; defaults to the DB clock. */
  startedAt?: string | null;
  errorCode?: string | null;
  errorMessageRedacted?: string | null;
};

// ── M12 dashboard read-model options ───────────────────────────────────────

/** Dashboard read defaults: deterministic, bounded, workspace-scoped. */
export const DASHBOARD_DEFAULT_LIMIT = 50;
export const DASHBOARD_MAX_LIMIT = 200;

export function clampDashboardLimit(limit: number | undefined): number {
  if (limit === undefined) return DASHBOARD_DEFAULT_LIMIT;
  if (limit < 1) return 1;
  return Math.min(limit, DASHBOARD_MAX_LIMIT);
}

export type DashboardListOptions = {
  /** Pagination cursor: rows are ordered (created_at, id) DESC, so `before`
   * is the last seen `created_at` and `beforeId` the last seen id. */
  before?: string;
  beforeId?: string;
  /** Max rows to return; clamped to [1, DASHBOARD_MAX_LIMIT]. */
  limit?: number;
};

export type ListPayoutsOptions = DashboardListOptions & {
  /** Filter by payout state (single value or list). */
  status?: ExecutionState | readonly ExecutionState[];
  /** Filter by source type (single value or list). */
  sourceType?: PayoutSourceType | readonly PayoutSourceType[];
};

export type ListClaimLinksOptions = DashboardListOptions & {
  status?: ClaimStatus | readonly ClaimStatus[];
};

export type ListAuditEventsOptions = DashboardListOptions & {
  payoutId?: string;
  actorId?: string;
  eventType?: string;
  /** Matches audit metadata `claimId` (claim events store it there). */
  claimId?: string;
};

export type ListAgentRunsOptions = DashboardListOptions;

export type ListPayoutItemsOptions = DashboardListOptions & {
  statuses?: readonly ExecutionState[];
  createdSinceIso?: string;
  completedSinceIso?: string;
};

export type UpdateAgentRunInput = {
  status?: AgentRunStatus;
  intentKind?: string | null;
  planAction?: string | null;
  decisionType?: string | null;
  interpretationJson?: Record<string, unknown> | null;
  decisionJson?: Record<string, unknown> | null;
  payoutId?: string | null;
  claimId?: string | null;
  errorCode?: string | null;
  errorMessageRedacted?: string | null;
};

/**
 * Server-only persistence surface for Solvo execution state.
 *
 * `transaction(fn)` runs `fn` against a transactional view of the repository
 * so that state transitions and their audit events commit together. The
 * Postgres implementation maps this to a real BEGIN/COMMIT; the in-memory
 * implementation used by offline tests runs `fn` directly.
 */
export interface SolvoRepository {
  transaction<T>(fn: (repo: SolvoRepository) => Promise<T>): Promise<T>;

  /**
   * Serializes per-workspace capacity accounting: locks the workspace row for
   * the rest of the current transaction so concurrent approvals/executions in
   * the same workspace cannot both read the same daily-spend sum and
   * overspend. Must be called BEFORE the sum that reserves capacity.
   */
  lockWorkspaceForUpdate(workspaceId: string): Promise<void>;

  /**
   * Serializes handling of the same logical instruction: takes a Postgres
   * advisory transaction lock keyed by the idempotency key so concurrent
   * duplicate deliveries resolve to ONE intent row. No-op in memory.
   */
  lockIdempotencyKey(idempotencyKey: string): Promise<void>;

  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRow>;
  getWorkspaceById(id: string): Promise<WorkspaceRow | null>;
  getWorkspaceByMode(mode: WorkspaceMode): Promise<WorkspaceRow | null>;
  getWorkspaceByTelegramChatId(chatId: string): Promise<WorkspaceRow | null>;

  getWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRow[]>;
  addWorkspaceMember(input: CreateMemberInput): Promise<{ created: boolean; member: WorkspaceMemberRow }>;
  updateWorkspaceMemberRole(
    workspaceId: string,
    telegramUserId: string,
    role: MemberRole,
  ): Promise<WorkspaceMemberRow | null>;
  removeWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null>;
  countActiveOwners(workspaceId: string): Promise<number>;

  addRecipient(input: AddRecipientInput): Promise<{ created: boolean; recipient: RecipientRow }>;
  getRecipientByAlias(workspaceId: string, alias: string): Promise<RecipientRow | null>;
  listRecipients(workspaceId: string): Promise<RecipientRow[]>;

  createPayout(input: CreatePayoutInput): Promise<PayoutRow>;
  getPayoutById(id: string): Promise<PayoutRow | null>;
  getPayoutItemsByPayoutId(payoutId: string): Promise<PayoutItemRow[]>;
  transitionPayoutState(id: string, from: readonly ExecutionState[], to: ExecutionState): Promise<PayoutRow>;

  createPayoutItem(input: CreatePayoutItemInput): Promise<{ created: boolean; item: PayoutItemRow }>;
  getPayoutItemByIdempotencyKey(idempotencyKey: string): Promise<PayoutItemRow | null>;
  getPayoutItemById(id: string): Promise<PayoutItemRow | null>;
  getPayoutItemForExecution(id: string): Promise<PayoutWithRelations | null>;
  transitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow>;
  /**
   * Same as transitionPayoutItemState but without the no-op when the state
   * already equals `to`: it throws StateTransitionError unless the current
   * state is inside `from`. Used for the approval transition so that two
   * concurrent approvers can never both win.
   */
  strictTransitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow>;
  setPayoutItemKeeperHubExecution(id: string, executionId: string): Promise<PayoutItemRow>;
  setPayoutItemAttemptCount(id: string, count: number): Promise<PayoutItemRow>;
  completePayoutItem(id: string, transactionHash: string, explorerUrl: string): Promise<PayoutItemRow>;
  failPayoutItem(id: string): Promise<PayoutItemRow>;
  markPayoutItemUnknown(id: string): Promise<PayoutItemRow>;

  sumPayoutItemsByWorkspaceStates(
    workspaceId: string,
    statuses: readonly ExecutionState[],
    sinceIso: string,
  ): Promise<string>;

  /**
   * Counts payout items in a workspace that belong to one requester and are
   * in any of the given states. Used by Judge Mode to enforce the per-user
   * successful-execution cap.
   */
  countPayoutItemsByRequesterStates(
    workspaceId: string,
    requesterId: string,
    statuses: readonly ExecutionState[],
  ): Promise<number>;

  createExecutionAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttemptRow>;
  updateExecutionAttempt(id: string, input: UpdateExecutionAttemptInput): Promise<ExecutionAttemptRow>;
  getLatestAttempt(payoutItemId: string): Promise<ExecutionAttemptRow | null>;

  getPayoutApprovalNotes(payoutId: string): Promise<string | null>;

  appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEventRow>;

  // ── M12 dashboard read helpers (workspace-scoped, deterministic) ────────

  /**
   * Payouts for one workspace, newest first (`created_at`, `id` DESC), with
   * optional status/source filters and a (created_at, id) cursor for paging.
   * Never crosses workspace boundaries.
   */
  listPayoutsByWorkspace(workspaceId: string, options?: ListPayoutsOptions): Promise<PayoutRow[]>;

  /**
   * Payout items for the given payout ids, scoped to one workspace (items
   * whose payout belongs to another workspace are never returned).
   */
  listPayoutItemsByPayoutIds(workspaceId: string, payoutIds: string[]): Promise<PayoutItemRow[]>;

  /**
   * Payout items for one workspace (joined through payouts), newest first,
   * with optional state/time filters. Used by read models that need item
   * counts/sums with exact time semantics (e.g. completed_at windows).
   */
  listPayoutItemsByWorkspace(workspaceId: string, options?: ListPayoutItemsOptions): Promise<PayoutItemRow[]>;

  /**
   * Claim links for one workspace, newest first, with optional status filter
   * and cursor paging. Kept distinct from `listClaimsByWorkspace` (ascending,
   * no options) to preserve existing callers.
   */
  listClaimLinksByWorkspace(workspaceId: string, options?: ListClaimLinksOptions): Promise<ClaimLinkRow[]>;

  /**
   * Audit events for one workspace, newest first, with optional payout/actor/
   * event-type/claim filters and cursor paging.
   */
  listAuditEventsByWorkspace(workspaceId: string, options?: ListAuditEventsOptions): Promise<AuditEventRow[]>;

  /**
   * Agent runs for one workspace (observability only), newest first, with
   * cursor paging. Agent runs are never payment truth.
   */
  listAgentRunsByWorkspace(workspaceId: string, options?: ListAgentRunsOptions): Promise<AgentRunRow[]>;

  /**
   * Count of payout items in the workspace matching the given states,
   * optionally restricted to items created since `createdSinceIso` (mirrors
   * `sumPayoutItemsByWorkspaceStates` window semantics).
   */
  countPayoutItemsByWorkspaceStates(
    workspaceId: string,
    statuses: readonly ExecutionState[],
    createdSinceIso?: string,
  ): Promise<number>;

  // ── M7 claim links ─────────────────────────────────────────────────────

  createClaimLink(input: {
    workspaceId: string;
    requesterId: string;
    amountBaseUnits: string;
    currencySymbol: string;
    chainId: string;
    tokenAddress: string;
    tokenHash: string;
    tokenPrefix: string;
    expiresAt: string;
    idempotencyKey: string;
  }): Promise<ClaimLinkRow>;

  getClaimLinkByTokenHash(tokenHash: string): Promise<ClaimLinkRow | null>;
  getClaimLinkById(id: string): Promise<ClaimLinkRow | null>;
  getClaimLinkByIdempotencyKey(idempotencyKey: string): Promise<ClaimLinkRow | null>;
  getClaimLinkByPayoutId(payoutId: string): Promise<ClaimLinkRow | null>;
  listClaimsByWorkspace(workspaceId: string): Promise<ClaimLinkRow[]>;

  /**
   * Single-claim guarantee: only succeeds when the claim is still `created`
   * AND not expired; stores the recipient atomically. Returns the updated row
   * or null when the claim is no longer claimable.
   */
  claimClaimLink(input: {
    claimId: string;
    recipientAddress: string;
    claimedBy: string;
    nowIso: string;
  }): Promise<ClaimLinkRow | null>;

  /**
   * Strict status transition for claims (created→cancelled, claimed→cancelled,
   * claimed→approved, approved→executed). Throws when the current status is
   * not inside `from`.
   */
  transitionClaimStatus(id: string, from: readonly ClaimStatus[], to: ClaimStatus): Promise<ClaimLinkRow>;

  setClaimPayoutId(id: string, payoutId: string): Promise<ClaimLinkRow>;

  // ── M8 agent runs (observational; never a payout/claim state machine) ──

  createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRow>;
  getAgentRunByIdempotencyKey(idempotencyKey: string): Promise<AgentRunRow | null>;
  getAgentRunById(id: string): Promise<AgentRunRow | null>;
  updateAgentRun(id: string, input: UpdateAgentRunInput): Promise<AgentRunRow>;
  countAgentRunsSince(input: { telegramUserId: string; sinceIso: string }): Promise<number>;
}
