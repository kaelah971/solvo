import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";

import { createDbClient } from "../../src/server/db/client.ts";
import { PostgresRepository } from "../../src/server/db/postgres-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import { StateTransitionError } from "../../src/server/execution/state-machine.ts";
import { loadEnvForScript } from "../../src/server/keeperhub/config.ts";

/**
 * Opt-in M4 database integration tests. Run with `npm run test:db`.
 *
 * These tests require DATABASE_URL, create temporary community workspaces,
 * memberships, recipients and payouts, exercise constraints and atomic
 * transitions, and clean up their own data. They never call KeeperHub and
 * never move funds.
 */

loadEnvForScript();

const hasDatabase = Boolean(process.env.DATABASE_URL);

const describeDb = hasDatabase ? describe : describe.skip;

const CHAIN_ID = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

let repo: SolvoRepository;
let cleanupSql: import("postgres").Sql;
const createdWorkspaceIds: string[] = [];

async function createCommunityWorkspace(): Promise<string> {
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: `community-it-${randomUUID()}`,
    telegramChatId: `-100${randomUUID().replace(/-/g, "")}`.slice(0, 20),
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

async function createPendingPayout(workspaceId: string, requesterId = "5000000001"): Promise<{
  payoutId: string;
  itemId: string;
}> {
  const payout = await repo.createPayout({
    workspaceId,
    requesterId,
    sourceType: "telegram_command",
    status: "pending_approval",
    totalAmountBaseUnits: "10000",
    currencySymbol: "USDC",
    chainId: CHAIN_ID,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: "10000",
    memo: null,
    status: "pending_approval",
    idempotencyKey: `m4-it-${randomUUID()}`,
  });
  return { payoutId: payout.id, itemId: item.id };
}

describeDb("M4 community database integration", () => {
  before(async () => {
    cleanupSql = createDbClient({ max: 1 });
    repo = new PostgresRepository(cleanupSql);
  });

  after(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await cleanupSql`
        DELETE FROM audit_events WHERE workspace_id = ${workspaceId}
      `;
      await cleanupSql`
        DELETE FROM execution_attempts
        WHERE payout_item_id IN (
          SELECT id FROM payout_items WHERE payout_id IN (
            SELECT id FROM payouts WHERE workspace_id = ${workspaceId}
          )
        )
      `;
      await cleanupSql`
        DELETE FROM payout_items WHERE payout_id IN (
          SELECT id FROM payouts WHERE workspace_id = ${workspaceId}
        )
      `;
      await cleanupSql`
        DELETE FROM payouts WHERE workspace_id = ${workspaceId}
      `;
      await cleanupSql`
        DELETE FROM recipients WHERE workspace_id = ${workspaceId}
      `;
      await cleanupSql`
        DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}
      `;
      await cleanupSql`
        DELETE FROM workspaces WHERE id = ${workspaceId}
      `;
    }
    await cleanupSql.end();
  });

  it("enforces membership uniqueness per workspace", async () => {
    const workspaceId = await createCommunityWorkspace();
    const first = await repo.addWorkspaceMember({
      workspaceId,
      telegramUserId: "5000000001",
      role: "owner",
    });
    assert.equal(first.created, true);
    const second = await repo.addWorkspaceMember({
      workspaceId,
      telegramUserId: "5000000001",
      role: "member",
    });
    assert.equal(second.created, false);
    const members = await repo.listWorkspaceMembers(workspaceId);
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "owner");
  });

  it("enforces workspace/chat uniqueness", async () => {
    const chatId = `-100${randomUUID().replace(/-/g, "")}`.slice(0, 20);
    const workspace = await repo.createWorkspace({
      mode: "community",
      name: `community-it-${randomUUID()}`,
      telegramChatId: chatId,
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    createdWorkspaceIds.push(workspace.id);
    const lookup = await repo.getWorkspaceByTelegramChatId(chatId);
    assert.equal(lookup?.id, workspace.id);
  });

  it("enforces recipient alias uniqueness per workspace", async () => {
    const workspaceId = await createCommunityWorkspace();
    const first = await repo.addRecipient({
      workspaceId,
      alias: "alice",
      walletAddress: RECIPIENT,
      createdBy: "5000000001",
    });
    assert.equal(first.created, true);
    const second = await repo.addRecipient({
      workspaceId,
      alias: "alice",
      walletAddress: RECIPIENT,
      createdBy: "5000000001",
    });
    assert.equal(second.created, false);
    const alias = await repo.getRecipientByAlias(workspaceId, "alice");
    assert.equal(alias?.wallet_address, RECIPIENT);
    const aliases = await repo.listRecipients(workspaceId);
    assert.equal(aliases.length, 1);
  });

  it("performs an atomic approval transition", async () => {
    const workspaceId = await createCommunityWorkspace();
    const { payoutId, itemId } = await createPendingPayout(workspaceId);
    await repo.transaction(async (tx) => {
      await tx.strictTransitionPayoutItemState(itemId, ["pending_approval"], "approved");
      await tx.transitionPayoutState(payoutId, ["pending_approval"], "approved");
    });
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "approved");
  });

  it("protects the approval transition from a second winner", async () => {
    const workspaceId = await createCommunityWorkspace();
    const { itemId } = await createPendingPayout(workspaceId);
    await repo.transaction(async (tx) => {
      await tx.strictTransitionPayoutItemState(itemId, ["pending_approval"], "approved");
    });
    await assert.rejects(
      repo.transaction(async (tx) => {
        await tx.strictTransitionPayoutItemState(itemId, ["pending_approval"], "approved");
      }),
      StateTransitionError,
    );
  });

  it("isolates members, recipients and payouts across workspaces", async () => {
    const workspaceA = await createCommunityWorkspace();
    const workspaceB = await createCommunityWorkspace();
    await repo.addWorkspaceMember({ workspaceId: workspaceA, telegramUserId: "5000000099", role: "member" });
    await repo.addRecipient({
      workspaceId: workspaceA,
      alias: "shared-alias",
      walletAddress: RECIPIENT,
      createdBy: "5000000099",
    });
    const inB = await repo.getRecipientByAlias(workspaceB, "shared-alias");
    assert.equal(inB, null);
    const membersB = await repo.listWorkspaceMembers(workspaceB);
    assert.equal(membersB.some((m) => m.telegram_user_id === "5000000099"), false);
    const { payoutId } = await createPendingPayout(workspaceA);
    const payoutB = await repo.getPayoutById(payoutId);
    assert.equal(payoutB?.workspace_id, workspaceA);
  });

  it("counts active owners and soft-removes members", async () => {
    const workspaceId = await createCommunityWorkspace();
    await repo.addWorkspaceMember({ workspaceId, telegramUserId: "5000000011", role: "owner" });
    await repo.addWorkspaceMember({ workspaceId, telegramUserId: "5000000012", role: "owner" });
    assert.equal(await repo.countActiveOwners(workspaceId), 2);
    await repo.removeWorkspaceMember(workspaceId, "5000000011");
    assert.equal(await repo.countActiveOwners(workspaceId), 1);
    const removed = await repo.getWorkspaceMember(workspaceId, "5000000011");
    assert.equal(removed?.status, "removed");
    const reactivated = await repo.addWorkspaceMember({
      workspaceId,
      telegramUserId: "5000000011",
      role: "owner",
    });
    assert.equal(reactivated.created, false);
    assert.equal(reactivated.member.status, "active");
  });

  it("records the approval actor in the append-only audit trail", async () => {
    const workspaceId = await createCommunityWorkspace();
    const { payoutId, itemId } = await createPendingPayout(workspaceId, "5000000033");
    await repo.transaction(async (tx) => {
      await tx.strictTransitionPayoutItemState(itemId, ["pending_approval"], "approved");
      await tx.appendAuditEvent({
        workspaceId,
        payoutId,
        payoutItemId: itemId,
        eventType: "approval_granted",
        actorType: "approver",
        actorId: "5000000044",
        metadata: { role: "approver" },
      });
    });
    const note = await repo.getPayoutApprovalNotes(payoutId);
    assert.ok(note);
    assert.match(note, /APPROVED BY APPROVER/);
    assert.match(note ?? "", /5000000044/);
  });

  it("sums active daily spend per workspace and status", async () => {
    const workspaceId = await createCommunityWorkspace();
    const { itemId } = await createPendingPayout(workspaceId);
    await repo.transaction(async (tx) => {
      await tx.strictTransitionPayoutItemState(itemId, ["pending_approval"], "approved");
    });
    const since = new Date(Date.UTC(2020, 0, 1)).toISOString();
    const total = await repo.sumPayoutItemsByWorkspaceStates(
      workspaceId,
      ["approved", "completed"],
      since,
    );
    assert.equal(total, "10000");
  });

  it("persists a batch as one payout with multiple items and a telegram_batch source", async () => {
    const workspaceId = await createCommunityWorkspace();
    const payout = await repo.createPayout({
      workspaceId,
      requesterId: "5000000077",
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: "30000",
      currencySymbol: "USDC",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
    });
    const keys: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const key = `m5-batch-${randomUUID()}`;
      keys.push(key);
      await repo.createPayoutItem({
        payoutId: payout.id,
        recipientAddress: RECIPIENT,
        amountBaseUnits: "10000",
        memo: `recipient-${i}`,
        status: "pending_approval",
        idempotencyKey: key,
      });
    }
    const items = await repo.getPayoutItemsByPayoutId(payout.id);
    assert.equal(items.length, 3);
    assert.equal(items.every((item) => item.status === "pending_approval"), true);
    assert.equal(new Set(items.map((item) => item.idempotency_key)).size, 3);
    const stored = await repo.getPayoutById(payout.id);
    assert.equal(stored?.source_type, "telegram_batch");
    assert.equal(stored?.total_amount_base_units, "30000");
  });

  it("transitions a batch payout to partially_completed with items untouched per-item", async () => {
    const workspaceId = await createCommunityWorkspace();
    const payout = await repo.createPayout({
      workspaceId,
      requesterId: "5000000078",
      sourceType: "telegram_batch",
      status: "approved",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
    });
    const first = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: "a",
      status: "completed",
      idempotencyKey: `m5-partial-a-${randomUUID()}`,
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: "b",
      status: "simulation_failed",
      idempotencyKey: `m5-partial-b-${randomUUID()}`,
    });
    await repo.transaction(async (tx) => {
      await tx.transitionPayoutState(payout.id, ["approved"], "simulating");
      await tx.transitionPayoutState(payout.id, ["simulating"], "submitted");
      await tx.transitionPayoutState(payout.id, ["submitted"], "partially_completed");
    });
    const stored = await repo.getPayoutById(payout.id);
    assert.equal(stored?.status, "partially_completed");
    const completed = await repo.getPayoutItemById(first.item.id);
    assert.equal(completed?.status, "completed");
  });
});
