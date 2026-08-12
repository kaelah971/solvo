import type { Sql } from "postgres";

import { canTransition, StateTransitionError, type ExecutionState } from "../execution/state-machine.ts";
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

type RawRow = Record<string, unknown>;

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function mapWorkspace(row: RawRow): WorkspaceRow {
  return {
    id: String(row.id),
    mode: row.mode as WorkspaceRow["mode"],
    name: text(row.name),
    telegram_chat_id: text(row.telegram_chat_id),
    chain_id: String(row.chain_id),
    token_address: String(row.token_address),
    per_transaction_limit_base_units: text(row.per_transaction_limit_base_units),
    daily_limit_base_units: text(row.daily_limit_base_units),
    approval_policy: String(row.approval_policy),
    status: String(row.status),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  };
}

function mapPayout(row: RawRow): PayoutRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    requester_id: text(row.requester_id),
    source_type: row.source_type as PayoutRow["source_type"],
    status: String(row.status),
    total_amount_base_units: String(row.total_amount_base_units),
    currency_symbol: String(row.currency_symbol),
    chain_id: String(row.chain_id),
    token_address: String(row.token_address),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    approved_at: iso(row.approved_at),
    completed_at: iso(row.completed_at),
    cancelled_at: iso(row.cancelled_at),
  };
}

function mapPayoutItem(row: RawRow): PayoutItemRow {
  return {
    id: String(row.id),
    payout_id: String(row.payout_id),
    recipient_address: String(row.recipient_address),
    amount_base_units: String(row.amount_base_units),
    memo: text(row.memo),
    status: String(row.status),
    keeperhub_execution_id: text(row.keeperhub_execution_id),
    transaction_hash: text(row.transaction_hash),
    transaction_explorer_url: text(row.transaction_explorer_url),
    attempt_count: Number(row.attempt_count ?? 0),
    idempotency_key: String(row.idempotency_key),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    completed_at: iso(row.completed_at),
  };
}

function mapAttempt(row: RawRow): ExecutionAttemptRow {
  return {
    id: String(row.id),
    payout_item_id: String(row.payout_item_id),
    attempt_number: Number(row.attempt_number),
    phase: row.phase as ExecutionAttemptRow["phase"],
    keeperhub_execution_id: text(row.keeperhub_execution_id),
    transaction_hash: text(row.transaction_hash),
    simulation_result: (row.simulation_result as Record<string, unknown> | null) ?? null,
    status: row.status as ExecutionAttemptRow["status"],
    error_code: text(row.error_code),
    error_message: text(row.error_message),
    raw_keeperhub_status: (row.raw_keeperhub_status as Record<string, unknown> | null) ?? null,
    started_at: iso(row.started_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
    completed_at: iso(row.completed_at),
  };
}

function mapAuditEvent(row: RawRow): AuditEventRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    payout_id: text(row.payout_id),
    payout_item_id: text(row.payout_item_id),
    event_type: String(row.event_type),
    actor_type: String(row.actor_type),
    actor_id: text(row.actor_id),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: iso(row.created_at) ?? "",
  };
}

function mapWorkspaceMember(row: RawRow): WorkspaceMemberRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    telegram_user_id: String(row.telegram_user_id),
    role: row.role as MemberRole,
    status: row.status as WorkspaceMemberRow["status"],
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  };
}

function mapRecipient(row: RawRow): RecipientRow {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    alias: String(row.alias),
    wallet_address: String(row.wallet_address),
    created_by: text(row.created_by),
    created_at: iso(row.created_at) ?? "",
    updated_at: iso(row.updated_at) ?? "",
  };
}

export class PostgresRepository implements SolvoRepository {
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
  }

  transaction<T>(fn: (repo: SolvoRepository) => Promise<T>): Promise<T> {
    return this.sql.begin(
      async (tx): Promise<T> => fn(new PostgresRepository(tx as unknown as Sql)),
    ) as Promise<T>;
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRow> {
    const rows = await this.sql<RawRow[]>`
      INSERT INTO workspaces (
        mode, name, telegram_chat_id, chain_id, token_address,
        per_transaction_limit_base_units, daily_limit_base_units, approval_policy, status
      ) VALUES (
        ${input.mode}, ${input.name}, ${input.telegramChatId ?? null}, ${input.chainId}, ${input.tokenAddress},
        ${input.perTransactionLimitBaseUnits}, ${input.dailyLimitBaseUnits},
        ${input.approvalPolicy}, ${input.status ?? "active"}
      )
      RETURNING *
    `;
    return mapWorkspace(rows[0]);
  }

  async getWorkspaceById(id: string): Promise<WorkspaceRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM workspaces WHERE id = ${id}`;
    return rows.length > 0 ? mapWorkspace(rows[0]) : null;
  }

  async getWorkspaceByMode(mode: WorkspaceRow["mode"]): Promise<WorkspaceRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM workspaces WHERE mode = ${mode} LIMIT 1`;
    return rows.length > 0 ? mapWorkspace(rows[0]) : null;
  }

  async getWorkspaceByTelegramChatId(chatId: string): Promise<WorkspaceRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM workspaces WHERE telegram_chat_id = ${chatId} LIMIT 1`;
    return rows.length > 0 ? mapWorkspace(rows[0]) : null;
  }

  async getWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null> {
    const rows = await this.sql<RawRow[]>`
      SELECT * FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND telegram_user_id = ${telegramUserId}
      LIMIT 1
    `;
    return rows.length > 0 ? mapWorkspaceMember(rows[0]) : null;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRow[]> {
    const rows = await this.sql<RawRow[]>`
      SELECT * FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND status = 'active'
      ORDER BY role, telegram_user_id
    `;
    return rows.map(mapWorkspaceMember);
  }

  async addWorkspaceMember(input: CreateMemberInput): Promise<{
    created: boolean;
    member: WorkspaceMemberRow;
  }> {
    const existing = await this.getWorkspaceMember(input.workspaceId, input.telegramUserId);
    if (existing) {
      if (existing.status === "active") {
        return { created: false, member: existing };
      }
      const rows = await this.sql<RawRow[]>`
        UPDATE workspace_members
        SET role = ${input.role}, status = 'active'
        WHERE id = ${existing.id}
        RETURNING *
      `;
      return { created: false, member: mapWorkspaceMember(rows[0]) };
    }
    const rows = await this.sql<RawRow[]>`
      INSERT INTO workspace_members (workspace_id, telegram_user_id, role, status)
      VALUES (${input.workspaceId}, ${input.telegramUserId}, ${input.role}, 'active')
      ON CONFLICT (workspace_id, telegram_user_id) DO UPDATE
        SET role = ${input.role}, status = 'active'
      RETURNING *
    `;
    return { created: true, member: mapWorkspaceMember(rows[0]) };
  }

  async updateWorkspaceMemberRole(
    workspaceId: string,
    telegramUserId: string,
    role: MemberRole,
  ): Promise<WorkspaceMemberRow | null> {
    const rows = await this.sql<RawRow[]>`
      UPDATE workspace_members
      SET role = ${role}
      WHERE workspace_id = ${workspaceId} AND telegram_user_id = ${telegramUserId} AND status = 'active'
      RETURNING *
    `;
    return rows.length > 0 ? mapWorkspaceMember(rows[0]) : null;
  }

  async removeWorkspaceMember(workspaceId: string, telegramUserId: string): Promise<WorkspaceMemberRow | null> {
    const rows = await this.sql<RawRow[]>`
      UPDATE workspace_members
      SET status = 'removed'
      WHERE workspace_id = ${workspaceId} AND telegram_user_id = ${telegramUserId} AND status = 'active'
      RETURNING *
    `;
    return rows.length > 0 ? mapWorkspaceMember(rows[0]) : null;
  }

  async countActiveOwners(workspaceId: string): Promise<number> {
    const rows = await this.sql<{ n: string }[]>`
      SELECT count(*) AS n FROM workspace_members
      WHERE workspace_id = ${workspaceId} AND role = 'owner' AND status = 'active'
    `;
    return Number(rows[0].n);
  }

  async addRecipient(input: AddRecipientInput): Promise<{ created: boolean; recipient: RecipientRow }> {
    const rows = await this.sql<RawRow[]>`
      INSERT INTO recipients (workspace_id, alias, wallet_address, created_by)
      VALUES (${input.workspaceId}, ${input.alias}, ${input.walletAddress}, ${input.createdBy})
      ON CONFLICT (workspace_id, alias) DO NOTHING
      RETURNING *
    `;
    if (rows.length > 0) {
      return { created: true, recipient: mapRecipient(rows[0]) };
    }
    const existing = await this.sql<RawRow[]>`
      SELECT * FROM recipients WHERE workspace_id = ${input.workspaceId} AND alias = ${input.alias}
    `;
    return { created: false, recipient: mapRecipient(existing[0]) };
  }

  async getRecipientByAlias(workspaceId: string, alias: string): Promise<RecipientRow | null> {
    const rows = await this.sql<RawRow[]>`
      SELECT * FROM recipients WHERE workspace_id = ${workspaceId} AND alias = ${alias} LIMIT 1
    `;
    return rows.length > 0 ? mapRecipient(rows[0]) : null;
  }

  async listRecipients(workspaceId: string): Promise<RecipientRow[]> {
    const rows = await this.sql<RawRow[]>`
      SELECT * FROM recipients WHERE workspace_id = ${workspaceId} ORDER BY alias
    `;
    return rows.map(mapRecipient);
  }

  async sumPayoutItemsByWorkspaceStates(
    workspaceId: string,
    statuses: readonly ExecutionState[],
    sinceIso: string,
  ): Promise<string> {
    const rows = await this.sql<{ total: string | null }[]>`
      SELECT sum(pi.amount_base_units) AS total
      FROM payout_items pi
      JOIN payouts p ON p.id = pi.payout_id
      WHERE p.workspace_id = ${workspaceId}
        AND pi.status::text = ANY(${statuses as string[]})
        AND pi.created_at >= ${sinceIso}
    `;
    return rows[0].total ?? "0";
  }

  async createPayout(input: CreatePayoutInput): Promise<PayoutRow> {
    const rows = await this.sql<RawRow[]>`
      INSERT INTO payouts (
        workspace_id, requester_id, source_type, status,
        total_amount_base_units, currency_symbol, chain_id, token_address,
        approved_at, completed_at, cancelled_at
      ) VALUES (
        ${input.workspaceId}, ${input.requesterId}, ${input.sourceType}, ${input.status},
        ${input.totalAmountBaseUnits}, ${input.currencySymbol}, ${input.chainId}, ${input.tokenAddress},
        CASE WHEN ${input.status} = 'approved' THEN now() ELSE NULL END,
        CASE WHEN ${input.status} = 'completed' THEN now() ELSE NULL END,
        CASE WHEN ${input.status} = 'cancelled' THEN now() ELSE NULL END
      )
      RETURNING *
    `;
    return mapPayout(rows[0]);
  }

  async getPayoutById(id: string): Promise<PayoutRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM payouts WHERE id = ${id}`;
    return rows.length > 0 ? mapPayout(rows[0]) : null;
  }

  async getPayoutItemsByPayoutId(payoutId: string): Promise<PayoutItemRow[]> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM payout_items WHERE payout_id = ${payoutId}`;
    return rows.map(mapPayoutItem);
  }

  async transitionPayoutState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutRow> {
    const current = await this.sql<RawRow[]>`SELECT status FROM payouts WHERE id = ${id}`;
    if (current.length === 0) throw new Error(`payouts: record not found: ${id}`);
    const state = current[0].status as ExecutionState;
    if (state === to) {
      const full = await this.sql<RawRow[]>`SELECT * FROM payouts WHERE id = ${id}`;
      return mapPayout(full[0]);
    }
    if (!canTransition(state, to)) {
      throw new StateTransitionError(state, to);
    }
    const rows = await this.sql<RawRow[]>`
      UPDATE payouts
      SET status = ${to},
          approved_at = CASE WHEN ${to} = 'approved' THEN COALESCE(approved_at, now()) ELSE approved_at END,
          completed_at = CASE WHEN ${to} = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END,
          cancelled_at = CASE WHEN ${to} = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE cancelled_at END
      WHERE id = ${id} AND status::text = ANY(${from as string[]})
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new StateTransitionError(state, to);
    }
    return mapPayout(rows[0]);
  }

  async createPayoutItem(input: CreatePayoutItemInput): Promise<{ created: boolean; item: PayoutItemRow }> {
    const rows = await this.sql<RawRow[]>`
      INSERT INTO payout_items (
        payout_id, recipient_address, amount_base_units, memo, status, idempotency_key
      ) VALUES (
        ${input.payoutId}, ${input.recipientAddress}, ${input.amountBaseUnits},
        ${input.memo}, ${input.status}, ${input.idempotencyKey}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING *
    `;
    if (rows.length > 0) {
      return { created: true, item: mapPayoutItem(rows[0]) };
    }
    const existing = await this.sql<RawRow[]>`
      SELECT * FROM payout_items WHERE idempotency_key = ${input.idempotencyKey}
    `;
    return { created: false, item: mapPayoutItem(existing[0]) };
  }

  async getPayoutItemByIdempotencyKey(idempotencyKey: string): Promise<PayoutItemRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM payout_items WHERE idempotency_key = ${idempotencyKey}`;
    return rows.length > 0 ? mapPayoutItem(rows[0]) : null;
  }

  async getPayoutItemById(id: string): Promise<PayoutItemRow | null> {
    const rows = await this.sql<RawRow[]>`SELECT * FROM payout_items WHERE id = ${id}`;
    return rows.length > 0 ? mapPayoutItem(rows[0]) : null;
  }

  async getPayoutItemForExecution(id: string): Promise<PayoutWithRelations | null> {
    const rows = await this.sql<RawRow[]>`
      SELECT
        pi.id AS pi_id, pi.payout_id AS pi_payout_id, pi.recipient_address,
        pi.amount_base_units, pi.memo, pi.status AS pi_status,
        pi.keeperhub_execution_id, pi.transaction_hash, pi.transaction_explorer_url,
        pi.attempt_count, pi.idempotency_key,
        pi.created_at AS pi_created_at, pi.updated_at AS pi_updated_at, pi.completed_at AS pi_completed_at,
        p.id AS p_id, p.workspace_id, p.requester_id, p.source_type, p.status AS p_status,
        p.total_amount_base_units, p.currency_symbol, p.chain_id AS p_chain_id,
        p.token_address AS p_token_address,
        p.created_at AS p_created_at, p.updated_at AS p_updated_at, p.approved_at,
        p.completed_at AS p_completed_at, p.cancelled_at,
        w.id AS w_id, w.mode, w.name, w.telegram_chat_id, w.chain_id AS w_chain_id,
        w.token_address AS w_token_address, w.per_transaction_limit_base_units,
        w.daily_limit_base_units, w.approval_policy, w.status AS w_status,
        w.created_at AS w_created_at, w.updated_at AS w_updated_at
      FROM payout_items pi
      JOIN payouts p ON p.id = pi.payout_id
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE pi.id = ${id}
    `;
    if (rows.length === 0) return null;
    const r = rows[0];
    const item: PayoutItemRow = {
      id: String(r.pi_id),
      payout_id: String(r.pi_payout_id),
      recipient_address: String(r.recipient_address),
      amount_base_units: String(r.amount_base_units),
      memo: text(r.memo),
      status: String(r.pi_status),
      keeperhub_execution_id: text(r.keeperhub_execution_id),
      transaction_hash: text(r.transaction_hash),
      transaction_explorer_url: text(r.transaction_explorer_url),
      attempt_count: Number(r.attempt_count ?? 0),
      idempotency_key: String(r.idempotency_key),
      created_at: iso(r.pi_created_at) ?? "",
      updated_at: iso(r.pi_updated_at) ?? "",
      completed_at: iso(r.pi_completed_at),
    };
    const payout: PayoutRow = {
      id: String(r.p_id),
      workspace_id: String(r.workspace_id),
      requester_id: text(r.requester_id),
      source_type: r.source_type as PayoutRow["source_type"],
      status: String(r.p_status),
      total_amount_base_units: String(r.total_amount_base_units),
      currency_symbol: String(r.currency_symbol),
      chain_id: String(r.p_chain_id),
      token_address: String(r.p_token_address),
      created_at: iso(r.p_created_at) ?? "",
      updated_at: iso(r.p_updated_at) ?? "",
      approved_at: iso(r.approved_at),
      completed_at: iso(r.p_completed_at),
      cancelled_at: iso(r.cancelled_at),
    };
    const workspace: WorkspaceRow = {
      id: String(r.w_id),
      mode: r.mode as WorkspaceRow["mode"],
      name: text(r.name),
      telegram_chat_id: text(r.telegram_chat_id),
      chain_id: String(r.w_chain_id),
      token_address: String(r.w_token_address),
      per_transaction_limit_base_units: text(r.per_transaction_limit_base_units),
      daily_limit_base_units: text(r.daily_limit_base_units),
      approval_policy: String(r.approval_policy),
      status: String(r.w_status),
      created_at: iso(r.w_created_at) ?? "",
      updated_at: iso(r.w_updated_at) ?? "",
    };
    return { item, payout, workspace };
  }

  async transitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow> {
    const current = await this.sql<RawRow[]>`SELECT status FROM payout_items WHERE id = ${id}`;
    if (current.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    const state = current[0].status as ExecutionState;
    if (state === to) {
      const full = await this.sql<RawRow[]>`SELECT * FROM payout_items WHERE id = ${id}`;
      return mapPayoutItem(full[0]);
    }
    if (!canTransition(state, to)) {
      throw new StateTransitionError(state, to);
    }
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items SET status = ${to}
      WHERE id = ${id} AND status::text = ANY(${from as string[]})
      RETURNING *
    `;
    if (rows.length === 0) {
      throw new StateTransitionError(state, to);
    }
    return mapPayoutItem(rows[0]);
  }

  async strictTransitionPayoutItemState(
    id: string,
    from: readonly ExecutionState[],
    to: ExecutionState,
  ): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items SET status = ${to}
      WHERE id = ${id} AND status::text = ANY(${from as string[]})
      RETURNING *
    `;
    if (rows.length === 0) {
      const current = await this.sql<RawRow[]>`SELECT status FROM payout_items WHERE id = ${id}`;
      if (current.length === 0) throw new Error(`payout_items: record not found: ${id}`);
      throw new StateTransitionError(current[0].status as ExecutionState, to);
    }
    return mapPayoutItem(rows[0]);
  }

  async setPayoutItemKeeperHubExecution(id: string, executionId: string): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items
      SET keeperhub_execution_id = ${executionId}
      WHERE id = ${id}
      RETURNING *
    `;
    if (rows.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    return mapPayoutItem(rows[0]);
  }

  async setPayoutItemAttemptCount(id: string, count: number): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items SET attempt_count = ${count} WHERE id = ${id} RETURNING *
    `;
    if (rows.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    return mapPayoutItem(rows[0]);
  }

  async completePayoutItem(id: string, transactionHash: string, explorerUrl: string): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items
      SET transaction_hash = ${transactionHash},
          transaction_explorer_url = ${explorerUrl},
          completed_at = now(),
          status = 'completed'
      WHERE id = ${id}
      RETURNING *
    `;
    if (rows.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    return mapPayoutItem(rows[0]);
  }

  async failPayoutItem(id: string): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items SET status = 'execution_failed' WHERE id = ${id} RETURNING *
    `;
    if (rows.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    return mapPayoutItem(rows[0]);
  }

  async markPayoutItemUnknown(id: string): Promise<PayoutItemRow> {
    const rows = await this.sql<RawRow[]>`
      UPDATE payout_items SET status = 'execution_unknown' WHERE id = ${id} RETURNING *
    `;
    if (rows.length === 0) throw new Error(`payout_items: record not found: ${id}`);
    return mapPayoutItem(rows[0]);
  }

  async createExecutionAttempt(input: CreateExecutionAttemptInput): Promise<ExecutionAttemptRow> {
    const rows = await this.sql<RawRow[]>`
      INSERT INTO execution_attempts (payout_item_id, attempt_number, phase, status)
      VALUES (${input.payoutItemId}, ${input.attemptNumber}, ${input.phase}, ${input.status ?? "running"})
      RETURNING *
    `;
    return mapAttempt(rows[0]);
  }

  async updateExecutionAttempt(id: string, input: UpdateExecutionAttemptInput): Promise<ExecutionAttemptRow> {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      assignments.push(`${column} = $${params.length + 1}`);
      params.push(value);
    };
    if (input.phase !== undefined) set("phase", input.phase);
    if (input.keeperhubExecutionId !== undefined) set("keeperhub_execution_id", input.keeperhubExecutionId);
    if (input.transactionHash !== undefined) set("transaction_hash", input.transactionHash);
    if (input.simulationResult !== undefined) set("simulation_result", input.simulationResult);
    if (input.status !== undefined) set("status", input.status);
    if (input.errorCode !== undefined) set("error_code", input.errorCode);
    if (input.errorMessage !== undefined) set("error_message", input.errorMessage);
    if (input.rawKeeperhubStatus !== undefined) set("raw_keeperhub_status", input.rawKeeperhubStatus);
    if (input.completedAt !== undefined) set("completed_at", input.completedAt);
    if (assignments.length === 0) {
      const current = await this.sql<RawRow[]>`SELECT * FROM execution_attempts WHERE id = ${id}`;
      if (current.length === 0) throw new Error(`execution_attempts: record not found: ${id}`);
      return mapAttempt(current[0]);
    }
    assignments.push("updated_at = now()");
    type PgParams = NonNullable<Parameters<Sql["unsafe"]>[1]>;
    const rows = await this.sql.unsafe<RawRow[]>(
      `UPDATE execution_attempts SET ${assignments.join(", ")} WHERE id = $${params.length + 1} RETURNING *`,
      [...params, id] as unknown as PgParams,
    );
    if (rows.length === 0) throw new Error(`execution_attempts: record not found: ${id}`);
    return mapAttempt(rows[0]);
  }

  async getLatestAttempt(payoutItemId: string): Promise<ExecutionAttemptRow | null> {
    const rows = await this.sql<RawRow[]>`
      SELECT * FROM execution_attempts
      WHERE payout_item_id = ${payoutItemId}
      ORDER BY attempt_number DESC
      LIMIT 1
    `;
    return rows.length > 0 ? mapAttempt(rows[0]) : null;
  }

  async appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEventRow> {
    type JsonParam = Parameters<Sql["json"]>[0];
    const rows = await this.sql<RawRow[]>`
      INSERT INTO audit_events (workspace_id, payout_id, payout_item_id, event_type, actor_type, actor_id, metadata)
      VALUES (
        ${input.workspaceId}, ${input.payoutId}, ${input.payoutItemId},
        ${input.eventType}, ${input.actorType}, ${input.actorId ?? null},
        ${this.sql.json(input.metadata as JsonParam)}
      )
      RETURNING *
    `;
    return mapAuditEvent(rows[0]);
  }

  async getPayoutApprovalNotes(payoutId: string): Promise<string | null> {
    const rows = await this.sql<RawRow[]>`
      SELECT event_type, actor_type, actor_id, metadata FROM audit_events
      WHERE payout_id = ${payoutId}
        AND event_type IN ('approval_granted', 'approval_rejected')
      ORDER BY created_at DESC
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const row = rows[0];
    const actor = row.actor_id !== null && row.actor_id !== undefined ? ` (${String(row.actor_id)})` : "";
    const role = String(row.actor_type).toUpperCase();
    if (row.event_type === "approval_rejected") {
      return `REJECTED BY ${role}${actor}`;
    }
    return `APPROVED BY ${role}${actor}`;
  }
}
