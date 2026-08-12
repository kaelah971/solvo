import type { ExecutionState } from "../execution/state-machine.ts";
import type {
  AuditEventRow,
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
}
