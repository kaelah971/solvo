import { randomUUID } from "node:crypto";

import {
  canTransition,
  StateTransitionError,
  isExecutionState,
  type ExecutionState,
} from "../execution/state-machine.ts";
import type {
  AddRecipientInput,
  AppendAuditEventInput,
  CreateExecutionAttemptInput,
  CreateMemberInput,
  CreatePayoutInput,
  CreatePayoutItemInput,
  CreateWorkspaceInput,
  SolvoRepository,
  UpdateExecutionAttemptInput,
} from "./repository.ts";
import type {
  AuditEventRow,
  ExecutionAttemptRow,
  MemberRole,
  PayoutItemRow,
  PayoutRow,
  PayoutWithRelations,
  RecipientRow,
  WorkspaceMemberRow,
  WorkspaceRow,
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
  readonly workspaces = new Map<string, WorkspaceRow>();
  readonly members = new Map<string, WorkspaceMemberRow>();
  readonly recipients = new Map<string, RecipientRow>();
  readonly payouts = new Map<string, PayoutRow>();
  readonly payoutItems = new Map<string, PayoutItemRow>();
  readonly executionAttempts = new Map<string, ExecutionAttemptRow>();
  readonly auditEvents: AuditEventRow[] = [];

  async transaction<T>(fn: (repo: SolvoRepository) => Promise<T>): Promise<T> {
    return fn(this);
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
}
