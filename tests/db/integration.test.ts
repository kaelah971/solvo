import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";

import { createDbClient } from "../../src/server/db/client.ts";
import type { PayoutItemRow } from "../../src/server/db/types.ts";
import { PostgresRepository } from "../../src/server/db/postgres-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import { StateTransitionError } from "../../src/server/execution/state-machine.ts";
import { loadEnvForScript } from "../../src/server/keeperhub/config.ts";

/**
 * Opt-in database integration tests. Run with `npm run test:db`.
 *
 * These tests require DATABASE_URL to be configured, create temporary
 * development records, exercise constraints, and clean up their own data.
 * They never call KeeperHub and never move funds.
 *
 * Isolation rules: every test creates its own payout + payout_item with a
 * unique idempotency key, so no test depends on another test's mutations or
 * on execution order.
 */

loadEnvForScript();

const hasDatabase = Boolean(process.env.DATABASE_URL);

const describeDb = hasDatabase ? describe : describe.skip;

const CHAIN_ID = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

let workspaceId: string;
let cleanupSql: import("postgres").Sql;

async function createFixtureItem(
  repo: SolvoRepository,
  options: { status?: "draft" | "approved" } = {},
): Promise<{ item: PayoutItemRow; payoutId: string }> {
  const status = options.status ?? "approved";
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: null,
    sourceType: "direct",
    status,
    totalAmountBaseUnits: "10000",
    currencySymbol: "USDC",
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: "10000",
    memo: `integration test ${randomUUID()}`,
    status,
    idempotencyKey: `it-${randomUUID()}`,
  });
  return { item, payoutId: payout.id };
}

describeDb("database integration", () => {
  before(async () => {
    cleanupSql = createDbClient({ max: 1 });
    const repo = new PostgresRepository(cleanupSql);
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: `integration-test-${randomUUID()}`,
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "auto",
    });
    workspaceId = workspace.id;
  });

  after(async () => {
    if (!cleanupSql) return;
    try {
      await cleanupSql`DELETE FROM audit_events WHERE workspace_id = ${workspaceId}`;
      await cleanupSql`
        DELETE FROM execution_attempts
        WHERE payout_item_id IN (
          SELECT pi.id FROM payout_items pi
          JOIN payouts p ON p.id = pi.payout_id
          WHERE p.workspace_id = ${workspaceId}
        )
      `;
      await cleanupSql`
        DELETE FROM payout_items
        WHERE payout_id IN (SELECT id FROM payouts WHERE workspace_id = ${workspaceId})
      `;
      await cleanupSql`DELETE FROM payouts WHERE workspace_id = ${workspaceId}`;
      await cleanupSql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    } finally {
      await cleanupSql.end();
    }
  });

  it("connects and reads back the created records", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspace = await repo.getWorkspaceById(workspaceId);
    assert.ok(workspace);
    assert.equal(workspace.chain_id, CHAIN_ID);
    assert.equal(workspace.token_address, TOKEN);

    const { item, payoutId } = await createFixtureItem(repo);
    const loaded = await repo.getPayoutItemForExecution(item.id);
    assert.ok(loaded);
    assert.equal(loaded.item.recipient_address, RECIPIENT);
    assert.equal(loaded.item.amount_base_units, "10000");
    assert.equal(loaded.payout.workspace_id, workspaceId);
    assert.equal(loaded.payout.status, "approved");
    assert.equal(loaded.workspace.mode, "development");
    void payoutId;
  });

  it("enforces the unique idempotency key", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item } = await createFixtureItem(repo);
    const existing = await repo.getPayoutItemByIdempotencyKey(item.idempotency_key);
    const dup = await repo.createPayoutItem({
      payoutId: item.payout_id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null,
      status: "approved",
      idempotencyKey: item.idempotency_key,
    });
    assert.ok(existing);
    assert.equal(dup.created, false);
    assert.equal(dup.item.id, existing.id);
  });

  it("rejects an invalid state transition with StateTransitionError", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item } = await createFixtureItem(repo);
    assert.equal(item.status, "approved");
    await assert.rejects(
      repo.transitionPayoutItemState(item.id, ["approved"], "submitted"),
      (error: unknown) =>
        error instanceof StateTransitionError &&
        error.from === "approved" &&
        error.to === "submitted",
    );
    const unchanged = await repo.getPayoutItemForExecution(item.id);
    assert.ok(unchanged);
    assert.equal(unchanged.item.status, "approved");
  });

  it("applies valid transitions and persists timestamps", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item } = await createFixtureItem(repo);
    assert.equal(item.status, "approved");

    const simulating = await repo.transitionPayoutItemState(item.id, ["approved"], "simulating");
    assert.equal(simulating.status, "simulating");

    const submitted = await repo.transitionPayoutItemState(item.id, ["simulating"], "submitted");
    assert.equal(submitted.status, "submitted");
    assert.notEqual(submitted.updated_at, item.updated_at);

    const loaded = await repo.getPayoutItemForExecution(item.id);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "submitted");
  });

  it("rejects a regression back from submitted to simulating", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item } = await createFixtureItem(repo);
    await repo.transitionPayoutItemState(item.id, ["approved"], "simulating");
    await repo.transitionPayoutItemState(item.id, ["simulating"], "submitted");
    await assert.rejects(
      repo.transitionPayoutItemState(item.id, ["submitted"], "simulating"),
      (error: unknown) => error instanceof StateTransitionError,
    );
  });

  it("appends audit events that read back", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item, payoutId } = await createFixtureItem(repo);
    await repo.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: item.id,
      eventType: "simulation_started",
      actorType: "system",
      metadata: { attemptNumber: 1 },
    });
    const rows = await cleanupSql<{ event_type: string }[]>`
      SELECT event_type FROM audit_events WHERE payout_item_id = ${item.id}
    `;
    assert.ok(rows.some((row) => row.event_type === "simulation_started"));
  });

  it("keeps audit event order truthful within one transaction (M5.1 regression)", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item, payoutId } = await createFixtureItem(repo);

    // The synchronous KeeperHub completion path appends BOTH events inside a
    // single transaction. now() is transaction-scoped, so before the
    // clock_timestamp() default these rows shared an identical created_at and
    // the random-UUID id tiebreaker could surface
    // execution_completed BEFORE execution_submitted. The invariant is:
    //   simulation_started < simulation_passed
    //   < execution_submitted < execution_completed
    await repo.transaction(async (tx) => {
      await tx.appendAuditEvent({
        workspaceId,
        payoutId,
        payoutItemId: item.id,
        eventType: "simulation_started",
        actorType: "system",
        metadata: { attemptNumber: 1 },
      });
      await tx.appendAuditEvent({
        workspaceId,
        payoutId,
        payoutItemId: item.id,
        eventType: "simulation_passed",
        actorType: "system",
        metadata: { attemptNumber: 1 },
      });
      await tx.appendAuditEvent({
        workspaceId,
        payoutId,
        payoutItemId: item.id,
        eventType: "execution_submitted",
        actorType: "system",
        metadata: { attemptNumber: 1, executionId: "regression-exec" },
      });
      await tx.appendAuditEvent({
        workspaceId,
        payoutId,
        payoutItemId: item.id,
        eventType: "execution_completed",
        actorType: "system",
        metadata: { attemptNumber: 1, executionId: "regression-exec" },
      });
    });

    const rows = await cleanupSql<{ event_type: string; created_at: string }[]>`
      SELECT event_type, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS.US') AS created_at
      FROM audit_events
      WHERE payout_item_id = ${item.id}
      ORDER BY created_at
    `;
    assert.deepEqual(
      rows.map((row) => row.event_type),
      ["simulation_started", "simulation_passed", "execution_submitted", "execution_completed"],
      "audit events appended in one transaction must sort in truthful order by created_at",
    );
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i].created_at > rows[i - 1].created_at,
        `created_at must strictly increase: ${rows[i - 1].event_type} ${rows[i - 1].created_at} -> ${rows[i].event_type} ${rows[i].created_at}`,
      );
    }
  });

  it("populates payout approved_at/completed_at on aggregate transitions (M5.1)", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const { item, payoutId } = await createFixtureItem(repo, { status: "draft" });
    assert.equal(item.status, "draft");

    await repo.transitionPayoutState(payoutId, ["draft"], "validated");
    const approved = await repo.transitionPayoutState(payoutId, ["validated"], "approved");
    assert.equal(approved.status, "approved");
    assert.ok(approved.approved_at, "approved_at must be set when a payout reaches approved");

    await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
    await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
    const completed = await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
    assert.equal(completed.status, "completed");
    assert.ok(completed.completed_at, "completed_at must be set when a payout reaches completed");
    assert.ok(
      completed.approved_at && completed.completed_at >= completed.approved_at,
      "completed_at must not precede approved_at",
    );

    // Idempotent: stamps are never overwritten once set.
    const reread = await repo.getPayoutById(payoutId);
    assert.ok(reread);
    assert.equal(reread.approved_at, approved.approved_at);
    assert.equal(reread.completed_at, completed.completed_at);
  });
});
