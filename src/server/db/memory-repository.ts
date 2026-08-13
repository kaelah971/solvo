import { randomUUID } from "node:crypto";

import {
  canTransition,
  StateTransitionError,
  isExecutionState,
  type ExecutionState,
} from "../execution/state-machine.ts";
import { isAgentRunStatus, isAgentRunTerminalOutcome } from "../agent/types.ts";
import type {
  AddRecipientInput,
  AppendAuditEventInput,
  CreateAgentRunInput,
  CreateDashboardLoginTokenInput,
  CreateExecutionAttemptInput,
  CreateMemberInput,
  CreatePayoutInput,
  CreatePayoutItemInput,
  CreateWorkspaceInput,
  SolvoRepository,
  UpdateAgentRunInput,
  UpdateExecutionAttemptInput,
  ListAgentRunsOptions,
  ListAuditEventsOptions,
  ListClaimLinksOptions,
  ListPayoutItemsOptions,
  ListPayoutsOptions,
  DashboardLoginTokenRow,
} from "./repository.ts";
import { clampDashboardLimit } from "./repository.ts";
import {
  canClaimTransition,
  type AgentRunRow,
  type AuditEventRow,
  type ClaimLinkRow,
  type ClaimStatus,
  type ExecutionAttemptRow,
  type MemberRole,
  type PayoutItemRow,
  type PayoutRow,
  type PayoutWithRelations,
  type RecipientRow,
  type WorkspaceMemberRow,
  type WorkspaceRow,
} from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Offline in-memory implementation of SolvoRepository used by unit tests.
 * Mirrors the Postgres semantics: unique idempotency keys and guarded state
 * transitions. `transaction` runs the callback directly (single-threaded).
 */
export class MemoryRepository implements SolvoRepository {
  workspaces = new Map<string, WorkspaceRow>();
  members = new Map<string, WorkspaceMemberRow>();
  recipients = new Map<string, RecipientRow>();
  payouts = new Map<string, PayoutRow>();
  payoutItems = new Map<string, PayoutItemRow>();
  executionAttempts = new Map<string, ExecutionAttemptRow>();
  auditEvents: AuditEventRow[] = [];
  claimLinks = new Map<string, ClaimLinkRow>();
  agentRuns = new Map<string, AgentRunRow>();

  /**
   * Mirrors Postgres transaction semantics: transactions are serialized (like
   * the workspace/idempotency locks in Postgres) and on failure every mutation
   * made inside the callback is rolled back, so memory and Postgres
   * repositories expose the same externally observable invariants (no orphan
   * rows, no half-applied transitions, no clobbered concurrent commits).
   */
  private txTail: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (repo: SolvoRepository) => Promise<T>): Promise<T> {
    const previous = this.txTail;
    let release: () => void = () => {};
    this.txTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const workspaces = new Map(this.workspaces);
    const members = new Map(this.members);
    const recipients = new Map(this.recipients);
    const payouts = new Map(this.payouts);
    const payoutItems = new Map(this.payoutItems);
    const executionAttempts = new Map(this.executionAttempts);
    const auditEvents = [...this.auditEvents];
    const claimLinks = new Map(this.claimLinks);
    const agentRuns = new Map(this.agentRuns);
    const dashboardLoginTokens = new Map(this.dashboardLoginTokens);
    try {
      return await fn(this);
    } catch (error) {
      this.workspaces = workspaces;
      this.members = members;
      this.recipients = recipients;
      this.payouts = payouts;
      this.payoutItems = payoutItems;
      this.executionAttempts = executionAttempts;
      this.auditEvents = auditEvents;
      this.claimLinks = claimLinks;
      this.agentRuns = agentRuns;
      this.dashboardLoginTokens = dashboardLoginTokens;
      throw error;
    } finally {
      release();
    }
  }

  async lockWorkspaceForUpdate(): Promise<void> {
    // Single-threaded in-memory repository: no cross-transaction concurrency.
  }

  async lockIdempotencyKey(): Promise<void> {
    // Single-threaded in-memory repository: no cross-transaction concurrency.
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRow> {
    const row: WorkspaceRow = {
      id: randomUUID(),
      mode: input.mode,
      name: input.name,
      telegram_chat_id: input.telegramChatId ?? null,
      chain_id: input.chainId,
      token_address: input.tokenAddress,
      per_transaction_limit_base_units: input.perTransactionLimitBaseUnits,
      daily_limit_base_units: input.dailyLimitBaseUnits,
      approval_policy: input.approvalPolicy,
      status: input.status ?? "active",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.workspaces.set(row.id, row);
    return row;
  }

  async getWorkspaceById(id: string): Promise<WorkspaceRow | null> {
    return this.workspaces.get(id) ?? null;
  }

  async getWorkspaceByMode(mode: WorkspaceRow["mode"]): Promise<WorkspaceRow | null> {
    return [...this.workspaces.values()].find((workspace) => workspace.mode === mode) ?? null;
  }

  async getWorkspaceByTelegramChatId(chatId: string): Promise<WorkspaceRow | null> {
    return [...this.workspaces.values()].find((workspace) => workspace.telegram_chat_id === chatId) ?? null;
  }

  async getWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null> {
    return (
      [...this.members.values()].find(
        (member) => member.workspace_id === workspaceId && member.telegram_user_id === telegramUserId,
      ) ?? null
    );
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRow[]> {
    return [...this.members.values()]
      .filter((member) => member.workspace_id === workspaceId && member.status === "active")
      .sort((a, b) => a.role.localeCompare(b.role) || a.telegram_user_id.localeCompare(b.telegram_user_id));
  }

  async addWorkspaceMember(input: CreateMemberInput): Promise<{
    created: boolean;
    member: WorkspaceMemberRow;
  }> {
    const existing = await this.getWorkspaceMember(input.workspaceId, input.telegramUserId);
    if (existing && existing.status === "active") {
      return { created: false, member: existing };
    }
    const row: WorkspaceMemberRow = {
      id: existing?.id ?? randomUUID(),
      workspace_id: input.workspaceId,
      telegram_user_id: input.telegramUserId,
      role: input.role,
      status: "active",
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
    };
    this.members.set(row.id, row);
    return { created: existing === null, member: row };
  }

  async updateWorkspaceMemberRole(
    workspaceId: string,
    telegramUserId: string,
    role: MemberRole,
  ): Promise<WorkspaceMemberRow | null> {
    const existing = await this.getWorkspaceMember(workspaceId, telegramUserId);
    if (!existing || existing.status !== "active") return null;
    const updated = { ...existing, role, updated_at: nowIso() };
    this.members.set(updated.id, updated);
    return updated;
  }

  async removeWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null> {
    const existing = await this.getWorkspaceMember(workspaceId, telegramUserId);
    if (!existing || existing.status !== "active") return null;
    const updated = { ...existing, status: "removed" as const, updated_at: nowIso() };
    this.members.set(updated.id, updated);
    return updated;
  }

  async countActiveOwners(workspaceId: string): Promise<number> {
    return [...this.members.values()].filter(
      (member) => member.workspace_id === workspaceId && member.role === "owner" && member.status === "active",
    ).length;
  }

  async addRecipient(input: AddRecipientInput): Promise<{ created: boolean; recipient: RecipientRow }> {
    const existing = [...this.recipients.values()].find(
      (recipient) => recipient.workspace_id === input.workspaceId && recipient.alias === input.alias,
    );
    if (existing) return { created: false, recipient: existing };
    const row: RecipientRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      alias: input.alias,
      wallet_address: input.walletAddress,
      created_by: input.createdBy,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.recipients.set(row.id, row);
    return { created: true, recipient: row };
  }

  async getRecipientByAlias(workspaceId: string, alias: string): Promise<RecipientRow | null> {
    return (
      [...this.recipients.values()].find(
        (recipient) => recipient.workspace_id === workspaceId && recipient.alias === alias,
      ) ?? null
    );
  }

  async listRecipients(workspaceId: string): Promise<RecipientRow[]> {
    return [...this.recipients.values()]
      .filter((recipient) => recipient.workspace_id === workspaceId)
      .sort((a, b) => a.alias.localeCompare(b.alias));
  }

  async sumPayoutItemsByWorkspaceStates(
    workspaceId: string,
    statuses: readonly ExecutionState[],
    sinceIso: string,
  ): Promise<string> {
    let total = 0n;
    for (const item of this.payoutItems.values()) {
      const payout = this.payouts.get(item.payout_id);
      if (!payout || payout.workspace_id !== workspaceId) continue;
      if (item.created_at < sinceIso) continue;
      if (!statuses.includes(item.status as ExecutionState)) continue;
      total += BigInt(item.amount_base_units);
    }
    return total.toString();
  }

  async countPayoutItemsByRequesterStates(
    workspaceId: string,
    requesterId: string,
    statuses: readonly ExecutionState[],
  ): Promise<number> {
    let count = 0;
    for (const item of this.payoutItems.values()) {
      const payout = this.payouts.get(item.payout_id);
      if (!payout || payout.workspace_id !== workspaceId) continue;
      if (payout.requester_id !== requesterId) continue;
      if (!statuses.includes(item.status as ExecutionState)) continue;
      count += 1;
    }
    return count;
  }

  // ── M12 dashboard read helpers (workspace-scoped, deterministic) ─────────

  async listPayoutsByWorkspace(
    workspaceId: string,
    options: ListPayoutsOptions = {},
  ): Promise<PayoutRow[]> {
    const limit = clampDashboardLimit(options.limit);
    const statuses = options.status === undefined ? null : toList(options.status);
    const sourceTypes = options.sourceType === undefined ? null : toList(options.sourceType);
    return [...this.payouts.values()]
      .filter((payout) => payout.workspace_id === workspaceId)
      .filter((payout) => statuses === null || statuses.includes(payout.status as ExecutionState))
      .filter((payout) => sourceTypes === null || sourceTypes.includes(payout.source_type))
      .filter((payout) => !isAfterCursor(payout, options.before, options.beforeId))
      .sort((a, b) => compareNewestFirst(a, b))
      .slice(0, limit);
  }

  async listPayoutItemsByPayoutIds(workspaceId: string, payoutIds: string[]): Promise<PayoutItemRow[]> {
    const owned = new Set(
      [...this.payouts.values()]
        .filter((payout) => payout.workspace_id === workspaceId)
        .map((payout) => payout.id),
    );
    return [...this.payoutItems.values()]
      .filter((item) => payoutIds.includes(item.payout_id) && owned.has(item.payout_id))
      .sort((a, b) => compareNewestFirst(a, b));
  }

  async listPayoutItemsByWorkspace(
    workspaceId: string,
    options: ListPayoutItemsOptions = {},
  ): Promise<PayoutItemRow[]> {
    const limit = clampDashboardLimit(options.limit);
    const statuses = options.statuses === undefined ? null : options.statuses;
    const items = [...this.payoutItems.values()].filter((item) => {
      const payout = this.payouts.get(item.payout_id);
      if (!payout || payout.workspace_id !== workspaceId) return false;
      if (statuses !== null && !statuses.includes(item.status as ExecutionState)) return false;
      if (options.createdSinceIso !== undefined && item.created_at < options.createdSinceIso) return false;
      if (options.completedSinceIso !== undefined && (item.completed_at ?? "") < options.completedSinceIso) {
        return false;
      }
      return true;
    });
    return items.sort((a, b) => compareNewestFirst(a, b)).slice(0, limit);
  }

  async listClaimLinksByWorkspace(
    workspaceId: string,
    options: ListClaimLinksOptions = {},
  ): Promise<ClaimLinkRow[]> {
    const limit = clampDashboardLimit(options.limit);
    const statuses = options.status === undefined ? null : toList(options.status);
    return [...this.claimLinks.values()]
      .filter((claim) => claim.workspace_id === workspaceId)
      .filter((claim) => statuses === null || statuses.includes(claim.status))
      .filter((claim) => !isAfterCursor(claim, options.before, options.beforeId))
      .sort((a, b) => compareNewestFirst(a, b))
      .slice(0, limit);
  }

  async listAuditEventsByWorkspace(
    workspaceId: string,
    options: ListAuditEventsOptions = {},
  ): Promise<AuditEventRow[]> {
    const limit = clampDashboardLimit(options.limit);
    return [...this.auditEvents]
      .filter((event) => event.workspace_id === workspaceId)
      .filter((event) => options.payoutId === undefined || event.payout_id === options.payoutId)
      .filter((event) => options.payoutIds === undefined || (event.payout_id !== null && options.payoutIds.includes(event.payout_id)))
      .filter((event) => options.actorId === undefined || event.actor_id === options.actorId)
      .filter((event) => options.eventType === undefined || event.event_type === options.eventType)
      .filter((event) => options.claimId === undefined || event.metadata.claimId === options.claimId)
      .filter((event) => !isAfterCursor(event, options.before, options.beforeId))
      .sort((a, b) => compareNewestFirst(a, b))
      .slice(0, limit);
  }

  async listAgentRunsByWorkspace(
    workspaceId: string,
    options: ListAgentRunsOptions = {},
  ): Promise<AgentRunRow[]> {
    const limit = clampDashboardLimit(options.limit);
    return [...this.agentRuns.values()]
      .filter((run) => run.workspace_id === workspaceId)
      .filter((run) => !isAfterCursor(run, options.before, options.beforeId))
      .sort((a, b) => compareNewestFirst(a, b))
      .slice(0, limit);
  }

  async countPayoutItemsByWorkspaceStates(
    workspaceId: string,
    statuses: readonly ExecutionState[],
    createdSinceIso?: string,
  ): Promise<number> {
    let count = 0;
    for (const item of this.payoutItems.values()) {
      const payout = this.payouts.get(item.payout_id);
      if (!payout || payout.workspace_id !== workspaceId) continue;
      if (createdSinceIso !== undefined && item.created_at < createdSinceIso) continue;
      if (!statuses.includes(item.status as ExecutionState)) continue;
      count += 1;
    }
    return count;
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutRow> {
    const row: PayoutRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      requester_id: input.requesterId,
      source_type: input.sourceType,
      status: input.status,
      total_amount_base_units: input.totalAmountBaseUnits,
      currency_symbol: input.currencySymbol,
      chain_id: input.chainId,
      token_address: input.tokenAddress,
      created_at: nowIso(),
      updated_at: nowIso(),
      approved_at: input.status === "approved" ? nowIso() : null,
      completed_at: input.status === "completed" ? nowIso() : null,
      cancelled_at: input.status === "cancelled" ? nowIso() : null,
    };
    this.payouts.set(row.id, row);
    return row;
  }

  async getPayoutById(id: string): Promise<PayoutRow | null> {
    return this.payouts.get(id) ?? null;
  }

  async getPayoutItemsByPayoutId(payoutId: string): Promise<PayoutItemRow[]> {
    return [...this.payoutItems.values()].filter((item) => item.payout_id === payoutId);
  }

  async transitionPayoutState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutRow> {
    const row = this.payouts.get(id);
    if (!row) throw new Error(`payouts: record not found: ${id}`);
    if (!isExecutionState(row.status)) throw new Error(`payouts: invalid stored state: ${row.status}`);
    if (row.status === to) return row;
    if (!canTransition(row.status, to)) {
      throw new StateTransitionError(row.status, to);
    }
    if (!from.includes(row.status)) {
      throw new StateTransitionError(row.status, to);
    }
    const updated = { ...row, status: to, updated_at: nowIso() };
    if (to === "approved") updated.approved_at = row.approved_at ?? nowIso();
    if (to === "completed") updated.completed_at = row.completed_at ?? nowIso();
    if (to === "cancelled") updated.cancelled_at = row.cancelled_at ?? nowIso();
    this.payouts.set(id, updated);
    return updated;
  }

  async createPayoutItem(input: CreatePayoutItemInput): Promise<{ created: boolean; item: PayoutItemRow }> {
    const existing = [...this.payoutItems.values()].find(
      (item) => item.idempotency_key === input.idempotencyKey,
    );
    if (existing) return { created: false, item: existing };
    const row: PayoutItemRow = {
      id: randomUUID(),
      payout_id: input.payoutId,
      recipient_address: input.recipientAddress,
      amount_base_units: input.amountBaseUnits,
      memo: input.memo,
      status: input.status,
      keeperhub_execution_id: null,
      transaction_hash: null,
      transaction_explorer_url: null,
      attempt_count: 0,
      idempotency_key: input.idempotencyKey,
      created_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };
    this.payoutItems.set(row.id, row);
    return { created: true, item: row };
  }

  async getPayoutItemByIdempotencyKey(idempotencyKey: string): Promise<PayoutItemRow | null> {
    return [...this.payoutItems.values()].find((item) => item.idempotency_key === idempotencyKey) ?? null;
  }

  async getPayoutItemById(id: string): Promise<PayoutItemRow | null> {
    return this.payoutItems.get(id) ?? null;
  }

  async getPayoutItemForExecution(id: string): Promise<PayoutWithRelations | null> {
    const item = this.payoutItems.get(id);
    if (!item) return null;
    const payout = this.payouts.get(item.payout_id);
    if (!payout) return null;
    const workspace = this.workspaces.get(payout.workspace_id);
    if (!workspace) return null;
    return { item, payout, workspace };
  }

  async transitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    if (!isExecutionState(row.status)) throw new Error(`payout_items: invalid stored state: ${row.status}`);
    if (row.status === to) return row;
    if (!canTransition(row.status, to)) {
      throw new StateTransitionError(row.status, to);
    }
    if (!from.includes(row.status)) {
      throw new StateTransitionError(row.status, to);
    }
    const updated = { ...row, status: to, updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async strictTransitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    if (!isExecutionState(row.status)) throw new Error(`payout_items: invalid stored state: ${row.status}`);
    if (!from.includes(row.status)) {
      throw new StateTransitionError(row.status, to);
    }
    if (!canTransition(row.status, to)) {
      throw new StateTransitionError(row.status, to);
    }
    const updated = { ...row, status: to, updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async setPayoutItemKeeperHubExecution(id: string, executionId: string): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    const updated = { ...row, keeperhub_execution_id: executionId, updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async setPayoutItemAttemptCount(id: string, count: number): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    const updated = { ...row, attempt_count: count, updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async completePayoutItem(id: string, transactionHash: string, explorerUrl: string): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    const updated: PayoutItemRow = {
      ...row,
      status: "completed",
      transaction_hash: transactionHash,
      transaction_explorer_url: explorerUrl,
      completed_at: nowIso(),
      updated_at: nowIso(),
    };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async failPayoutItem(id: string): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    const updated = { ...row, status: "execution_failed", updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async markPayoutItemUnknown(id: string): Promise<PayoutItemRow> {
    const row = this.payoutItems.get(id);
    if (!row) throw new Error(`payout_items: record not found: ${id}`);
    const updated = { ...row, status: "execution_unknown", updated_at: nowIso() };
    this.payoutItems.set(id, updated);
    return updated;
  }

  async createExecutionAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttemptRow> {
    const row: ExecutionAttemptRow = {
      id: randomUUID(),
      payout_item_id: input.payoutItemId,
      attempt_number: input.attemptNumber,
      phase: input.phase,
      keeperhub_execution_id: null,
      transaction_hash: null,
      simulation_result: null,
      status: input.status ?? "running",
      error_code: null,
      error_message: null,
      raw_keeperhub_status: null,
      started_at: nowIso(),
      updated_at: nowIso(),
      completed_at: null,
    };
    this.executionAttempts.set(row.id, row);
    return row;
  }

  async updateExecutionAttempt(id: string, input: UpdateExecutionAttemptInput): Promise<ExecutionAttemptRow> {
    const row = this.executionAttempts.get(id);
    if (!row) throw new Error(`execution_attempts: record not found: ${id}`);
    const updated: ExecutionAttemptRow = { ...row };
    if (input.phase !== undefined) updated.phase = input.phase;
    if (input.keeperhubExecutionId !== undefined) updated.keeperhub_execution_id = input.keeperhubExecutionId;
    if (input.transactionHash !== undefined) updated.transaction_hash = input.transactionHash;
    if (input.simulationResult !== undefined) updated.simulation_result = input.simulationResult;
    if (input.status !== undefined) updated.status = input.status;
    if (input.errorCode !== undefined) updated.error_code = input.errorCode;
    if (input.errorMessage !== undefined) updated.error_message = input.errorMessage;
    if (input.rawKeeperhubStatus !== undefined) updated.raw_keeperhub_status = input.rawKeeperhubStatus;
    if (input.completedAt !== undefined) updated.completed_at = input.completedAt;
    updated.updated_at = nowIso();
    this.executionAttempts.set(id, updated);
    return updated;
  }

  async getLatestAttempt(payoutItemId: string): Promise<ExecutionAttemptRow | null> {
    const attempts = [...this.executionAttempts.values()]
      .filter((attempt) => attempt.payout_item_id === payoutItemId)
      .sort((a, b) => b.attempt_number - a.attempt_number);
    return attempts[0] ?? null;
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEventRow> {
    const row: AuditEventRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      payout_id: input.payoutId,
      payout_item_id: input.payoutItemId,
      event_type: input.eventType,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      metadata: input.metadata ?? {},
      created_at: nowIso(),
    };
    this.auditEvents.push(row);
    return row;
  }

  async getPayoutApprovalNotes(payoutId: string): Promise<string | null> {
    const events = [...this.auditEvents]
      .filter(
        (event) =>
          event.payout_id === payoutId &&
          (event.event_type === "approval_granted" || event.event_type === "approval_rejected"),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const latest = events[events.length - 1];
    if (!latest) return null;
    const actor = latest.actor_id !== null ? ` (${latest.actor_id})` : "";
    const role = latest.actor_type.toUpperCase();
    return latest.event_type === "approval_rejected"
      ? `REJECTED BY ${role}${actor}`
      : `APPROVED BY ${role}${actor}`;
  }

  // ── M7 claim links ─────────────────────────────────────────────────────

  async createClaimLink(input: {
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
  }): Promise<ClaimLinkRow> {
    const row: ClaimLinkRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      requester_id: input.requesterId,
      amount_base_units: input.amountBaseUnits,
      currency_symbol: input.currencySymbol,
      chain_id: input.chainId,
      token_address: input.tokenAddress,
      token_hash: input.tokenHash,
      token_prefix: input.tokenPrefix,
      status: "created",
      claimed_recipient: null,
      claimed_by: null,
      claimed_at: null,
      expires_at: input.expiresAt,
      payout_id: null,
      idempotency_key: input.idempotencyKey,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.claimLinks.set(row.id, row);
    return row;
  }

  async getClaimLinkByTokenHash(tokenHash: string): Promise<ClaimLinkRow | null> {
    return [...this.claimLinks.values()].find((claim) => claim.token_hash === tokenHash) ?? null;
  }

  async getClaimLinkById(id: string): Promise<ClaimLinkRow | null> {
    return this.claimLinks.get(id) ?? null;
  }

  async getClaimLinkByIdempotencyKey(idempotencyKey: string): Promise<ClaimLinkRow | null> {
    return [...this.claimLinks.values()].find((claim) => claim.idempotency_key === idempotencyKey) ?? null;
  }

  async getClaimLinkByPayoutId(payoutId: string): Promise<ClaimLinkRow | null> {
    return [...this.claimLinks.values()].find((claim) => claim.payout_id === payoutId) ?? null;
  }

  async listClaimsByWorkspace(workspaceId: string): Promise<ClaimLinkRow[]> {
    return [...this.claimLinks.values()]
      .filter((claim) => claim.workspace_id === workspaceId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async claimClaimLink(input: {
    claimId: string;
    recipientAddress: string;
    claimedBy: string;
    nowIso: string;
  }): Promise<ClaimLinkRow | null> {
    const row = this.claimLinks.get(input.claimId);
    if (!row || row.status !== "created") return null;
    if (row.expires_at <= input.nowIso) return null;
    const updated: ClaimLinkRow = {
      ...row,
      status: "claimed",
      claimed_recipient: input.recipientAddress,
      claimed_by: input.claimedBy,
      claimed_at: input.nowIso,
      updated_at: nowIso(),
    };
    this.claimLinks.set(input.claimId, updated);
    return updated;
  }

  async transitionClaimStatus(
    id: string,
    from: readonly ClaimStatus[],
    to: ClaimStatus,
  ): Promise<ClaimLinkRow> {
    const row = this.claimLinks.get(id);
    if (!row) throw new Error(`claim_links: record not found: ${id}`);
    if (!from.includes(row.status)) {
      throw new StateTransitionError(row.status as ExecutionState, to as ExecutionState);
    }
    if (!canClaimTransition(row.status, to)) {
      throw new StateTransitionError(row.status as ExecutionState, to as ExecutionState);
    }
    const updated = { ...row, status: to, updated_at: nowIso() };
    this.claimLinks.set(id, updated);
    return updated;
  }

  async setClaimPayoutId(id: string, payoutId: string): Promise<ClaimLinkRow> {
    const row = this.claimLinks.get(id);
    if (!row) throw new Error(`claim_links: record not found: ${id}`);
    if (row.status !== "approved" || row.payout_id !== null) {
      throw new Error(
        `claim_links: cannot attach payout to claim ${id}: status=${row.status}, payout_id=${row.payout_id ?? "null"}`,
      );
    }
    const updated = { ...row, payout_id: payoutId, updated_at: nowIso() };
    this.claimLinks.set(id, updated);
    return updated;
  }

  // ── M8 agent runs (observational; never a payout/claim state machine) ──

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRunRow> {
    const status = input.status ?? "received";
    if (!isAgentRunStatus(status)) {
      throw new Error(`invalid agent run status: ${status}`);
    }
    const existing = [...this.agentRuns.values()].find((run) => run.idempotency_key === input.idempotencyKey);
    if (existing) {
      throw new Error(`agent run idempotency key ${input.idempotencyKey} violates unique constraint`);
    }
    const now = nowIso();
    const row: AgentRunRow = {
      id: randomUUID(),
      workspace_id: input.workspaceId,
      surface: input.surface,
      telegram_chat_id: input.telegramChatId,
      telegram_user_id: input.telegramUserId,
      telegram_message_id: input.telegramMessageId,
      idempotency_key: input.idempotencyKey,
      provider: input.provider,
      status,
      intent_kind: null,
      plan_action: null,
      decision_type: null,
      input_hash: input.inputHash,
      raw_text_redacted: input.rawTextRedacted ?? null,
      candidates_json: input.candidatesJson ?? {},
      interpretation_json: null,
      decision_json: null,
      error_code: input.errorCode ?? null,
      error_message_redacted: input.errorMessageRedacted ?? null,
      started_at: input.startedAt ?? now,
      completed_at: null,
      created_at: now,
      updated_at: now,
      payout_id: null,
      claim_id: null,
    };
    this.agentRuns.set(row.id, row);
    return row;
  }

  async getAgentRunByIdempotencyKey(idempotencyKey: string): Promise<AgentRunRow | null> {
    return [...this.agentRuns.values()].find((run) => run.idempotency_key === idempotencyKey) ?? null;
  }

  async getAgentRunById(id: string): Promise<AgentRunRow | null> {
    return this.agentRuns.get(id) ?? null;
  }

  async updateAgentRun(id: string, input: UpdateAgentRunInput): Promise<AgentRunRow> {
    const row = this.agentRuns.get(id);
    if (!row) throw new Error(`agent_runs: record not found: ${id}`);
    if (input.status !== undefined && !isAgentRunStatus(input.status)) {
      throw new Error(`invalid agent run status: ${input.status}`);
    }
    const updated: AgentRunRow = {
      ...row,
      status: input.status ?? row.status,
      intent_kind: input.intentKind !== undefined ? input.intentKind : row.intent_kind,
      plan_action: input.planAction !== undefined ? input.planAction : row.plan_action,
      decision_type: input.decisionType !== undefined ? input.decisionType : row.decision_type,
      interpretation_json:
        input.interpretationJson !== undefined ? input.interpretationJson : row.interpretation_json,
      decision_json: input.decisionJson !== undefined ? input.decisionJson : row.decision_json,
      payout_id: input.payoutId !== undefined ? input.payoutId : row.payout_id,
      claim_id: input.claimId !== undefined ? input.claimId : row.claim_id,
      error_code: input.errorCode !== undefined ? input.errorCode : row.error_code,
      error_message_redacted:
        input.errorMessageRedacted !== undefined ? input.errorMessageRedacted : row.error_message_redacted,
      updated_at: nowIso(),
    };
    if (input.status !== undefined && isAgentRunTerminalOutcome(input.status)) {
      // COALESCE semantics: the first completion time is preserved.
      updated.completed_at = row.completed_at ?? nowIso();
    }
    this.agentRuns.set(id, updated);
    return updated;
  }

  async countAgentRunsSince(input: { telegramUserId: string; sinceIso: string }): Promise<number> {
    return [...this.agentRuns.values()].filter(
      (run) => run.telegram_user_id === input.telegramUserId && run.started_at >= input.sinceIso,
    ).length;
  }

  // ── M12.4 dashboard login tokens (hash-only, single-use) ─────────────────

  dashboardLoginTokens = new Map<string, DashboardLoginTokenRow>();

  async createDashboardLoginToken(input: CreateDashboardLoginTokenInput): Promise<DashboardLoginTokenRow> {
    const existing = this.dashboardLoginTokens.get(input.tokenHash);
    if (existing) return existing;
    const row: DashboardLoginTokenRow = {
      id: randomUUID(),
      token_hash: input.tokenHash,
      workspace_id: input.workspaceId,
      telegram_user_id: input.telegramUserId,
      member_id: input.memberId,
      role: input.role,
      expires_at: input.expiresAt,
      used_at: null,
      created_at: nowIso(),
    };
    this.dashboardLoginTokens.set(row.token_hash, row);
    return row;
  }

  async getDashboardLoginTokenByHash(tokenHash: string): Promise<DashboardLoginTokenRow | null> {
    return this.dashboardLoginTokens.get(tokenHash) ?? null;
  }

  async consumeDashboardLoginToken(tokenHash: string, usedAtIso: string): Promise<DashboardLoginTokenRow | null> {
    const row = this.dashboardLoginTokens.get(tokenHash);
    if (!row || row.used_at !== null) return null;
    const updated: DashboardLoginTokenRow = { ...row, used_at: usedAtIso };
    this.dashboardLoginTokens.set(tokenHash, updated);
    return updated;
  }
}

// ── M12 dashboard read helper functions (deterministic ordering/cursors) ───

function toList<T>(value: T | readonly T[]): T[] {
  return (Array.isArray(value) ? [...value] : [value]) as T[];
}

function createdKey(row: { created_at: string; id: string }): string {
  return `${row.created_at}\u0000${row.id}`;
}

/** Newest first: (created_at, id) descending. */
function compareNewestFirst(a: { created_at: string; id: string }, b: { created_at: string; id: string }): number {
  return createdKey(b).localeCompare(createdKey(a));
}

/** True when the row sorts at or before the cursor (strictly newer rows kept). */
function isAfterCursor(
  row: { created_at: string; id: string },
  before: string | undefined,
  beforeId: string | undefined,
): boolean {
  if (before === undefined) return false;
  if (row.created_at !== before) return row.created_at > before;
  return row.id > (beforeId ?? "");
}
