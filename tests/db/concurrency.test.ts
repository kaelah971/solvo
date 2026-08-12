import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";

import { createDbClient } from "../../src/server/db/client.ts";
import { PostgresRepository } from "../../src/server/db/postgres-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import { applyApprovalCallback, validateApprovalCallback } from "../../src/server/telegram/flows/approval-flow.ts";
import {
  applyClaimApprovalCallback,
  claimExpiresAtIso,
  submitClaimRecipient,
  validateClaimApprovalCallback,
} from "../../src/server/claim/service.ts";
import { handlePayInstruction } from "../../src/server/telegram/flows/pay-flow.ts";
import { handleClaimPayInstruction } from "../../src/server/telegram/flows/claim-flow.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";
import { loadEnvForScript } from "../../src/server/keeperhub/config.ts";
import { FakeGateway } from "../execution/fixtures.ts";

/**
 * M8 Postgres concurrency suite — the authoritative proof that database
 * uniqueness/transactions/locks (not memory) enforce exactly-once and the
 * daily cap. Every test gets its own workspace so caps never leak between
 * tests. Run via `npm run test:db`.
 */

loadEnvForScript();

const hasDatabase = Boolean(process.env.DATABASE_URL);
const describeDb = hasDatabase ? describe : describe.skip;

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const MEMBER = "123456789";
const APPROVER = "987654321";

let cleanupSql: import("postgres").Sql;
const workspaceIds: string[] = [];

async function fixtureWorkspace(repo: SolvoRepository, dailyCap = "10000"): Promise<string> {
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: `m8-concurrency-${randomUUID()}`,
    telegramChatId: `-1008${randomUUID().slice(0, 8)}`,
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: dailyCap,
    approvalPolicy: "requires_approval",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
  workspaceIds.push(workspace.id);
  return workspace.id;
}

async function pendingPayout(repo: SolvoRepository, workspaceId: string, amount: string, key: string) {
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: MEMBER,
    sourceType: "telegram_command",
    status: "pending_approval",
    totalAmountBaseUnits: amount,
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: amount,
    memo: null,
    status: "pending_approval",
    idempotencyKey: key,
  });
  return { payout, item };
}

const SPEND_STATES = ["approved", "simulating", "submitted", "confirming", "completed", "execution_unknown"] as const;

describeDb("M8 database concurrency invariants", () => {
  before(async () => {
    cleanupSql = createDbClient({ max: 5 });
  });

  after(async () => {
    if (!cleanupSql) return;
    try {
      for (const workspaceId of workspaceIds) {
        await cleanupSql`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
        await cleanupSql`DELETE FROM claim_links WHERE workspace_id = ${workspaceId}`;
        await cleanupSql`DELETE FROM audit_events WHERE workspace_id = ${workspaceId}`;
        await cleanupSql`
          DELETE FROM execution_attempts
          WHERE payout_item_id IN (SELECT pi.id FROM payout_items pi JOIN payouts p ON p.id = pi.payout_id WHERE p.workspace_id = ${workspaceId})
        `;
        await cleanupSql`DELETE FROM payout_items WHERE payout_id IN (SELECT id FROM payouts WHERE workspace_id = ${workspaceId})`;
        await cleanupSql`DELETE FROM payouts WHERE workspace_id = ${workspaceId}`;
        await cleanupSql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      }
    } finally {
      await cleanupSql.end();
    }
  });

  it("two payouts jointly over the daily cap: exactly one approval wins (workspace lock)", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    // Daily cap = 10000; each payout = 6000; jointly 12000 > 10000.
    const a = await pendingPayout(repo, workspaceId, "6000", `m8-race-a-${randomUUID()}`);
    const b = await pendingPayout(repo, workspaceId, "6000", `m8-race-b-${randomUUID()}`);
    const gateway = new FakeGateway({});
    const chatId = (await repo.getWorkspaceById(workspaceId))?.telegram_chat_id ?? "";

    const va = await validateApprovalCallback({ action: "approve", payoutId: a.payout.id, actorUserId: APPROVER, chatId }, { repo });
    const vb = await validateApprovalCallback({ action: "approve", payoutId: b.payout.id, actorUserId: APPROVER, chatId }, { repo });
    assert.equal(va.ok, true);
    assert.equal(vb.ok, true);
    if (!va.ok || !vb.ok) return;

    // Genuinely concurrent approvals of DIFFERENT payouts.
    const results = await Promise.all([
      applyApprovalCallback(va.context, { repo, gateway }),
      applyApprovalCallback(vb.context, { repo, gateway }),
    ]);
    const executed = results.filter((r) => r.executed === true);
    assert.equal(executed.length, 1, "at most one of the two racing approvals may execute");

    const spend = await repo.sumPayoutItemsByWorkspaceStates(workspaceId, SPEND_STATES, new Date(0).toISOString());
    assert.ok(BigInt(spend) <= 10000n, `reserved spend ${spend} must not exceed the daily cap`);
  });

  it("two claim approvals racing the remaining allowance: exactly one wins", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    const workspace = await repo.getWorkspaceById(workspaceId);
    assert.ok(workspace);
    const gateway = new FakeGateway({});

    const claims = [];
    for (let i = 0; i < 2; i += 1) {
      const token = generateClaimTokenPair();
      const claim = await repo.createClaimLink({
        workspaceId,
        requesterId: MEMBER,
        amountBaseUnits: "6000",
        currencySymbol: "USDC",
        chainId: CHAIN,
        tokenAddress: TOKEN,
        tokenHash: token.hash,
        tokenPrefix: token.prefix,
        expiresAt: claimExpiresAtIso(168),
        idempotencyKey: `m8-claim-race-${randomUUID()}`,
      });
      const submitted = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", new Date().toISOString());
      assert.equal(submitted.ok, true);
      claims.push({ claim, token });
    }

    const validations = await Promise.all(
      claims.map(({ claim }) =>
        validateClaimApprovalCallback({ claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: workspace.telegram_chat_id ?? "" }, repo),
      ),
    );
    assert.ok(validations.every((v) => v.ok));
    if (!validations.every((v) => v.ok)) return;

    const results = await Promise.all(
      validations.map((v) => (v.ok ? applyClaimApprovalCallback(v.context, { repo, gateway }) : Promise.resolve(null))),
    );
    const executed = results.filter((r) => r !== null && r.executed === true);
    assert.equal(executed.length, 1, "only one claim approval may win the remaining daily allowance");

    const spend = await repo.sumPayoutItemsByWorkspaceStates(workspaceId, SPEND_STATES, new Date(0).toISOString());
    assert.ok(BigInt(spend) <= 10000n, `claim approvals must not overspend: ${spend}`);
  });

  it("batch + single payout racing the same limit: at most one passes", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    const workspace = await repo.getWorkspaceById(workspaceId);
    assert.ok(workspace);
    const gateway = new FakeGateway({});

    // Batch with two items (3000 + 3000 = 6000) and a single (6000).
    const batch = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: "6000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    for (let i = 0; i < 2; i += 1) {
      await repo.createPayoutItem({
        payoutId: batch.id,
        recipientAddress: RECIPIENT,
        amountBaseUnits: "3000",
        memo: `item-${i}`,
        status: "pending_approval",
        idempotencyKey: `m8-batch-item-${randomUUID()}`,
      });
    }
    const single = await pendingPayout(repo, workspaceId, "6000", `m8-single-race-${randomUUID()}`);

    const chatId = workspace.telegram_chat_id ?? "";
    const vb = await validateApprovalCallback({ action: "approve", payoutId: batch.id, actorUserId: APPROVER, chatId }, { repo });
    const vs = await validateApprovalCallback({ action: "approve", payoutId: single.payout.id, actorUserId: APPROVER, chatId }, { repo });
    assert.equal(vb.ok, true);
    assert.equal(vs.ok, true);
    if (!vb.ok || !vs.ok) return;

    const results = await Promise.all([
      applyApprovalCallback(vb.context, { repo, gateway }),
      applyApprovalCallback(vs.context, { repo, gateway }),
    ]);
    assert.equal(results.filter((r) => r.executed === true).length, 1);

    const spend = await repo.sumPayoutItemsByWorkspaceStates(workspaceId, SPEND_STATES, new Date(0).toISOString());
    assert.ok(BigInt(spend) <= 10000n, `batch+single must not overspend: ${spend}`);
  });

  it("duplicate /pay delivery raced against itself creates exactly ONE payout", async () => {
    const repo = new PostgresRepository(cleanupSql);
    // Random messageId so repeated runs never collide with prior sandbox rows.
    const messageId = 1_000_000 + Math.floor(Math.random() * 1_000_000);
    const user = { userId: "111222333", chatId: "-100777", chatType: "private" as const, messageId, updateId: 99 };
    const instruction = { kind: "pay" as const, address: RECIPIENT, amount: "0.01", token: "USDC" as const, sourceType: "telegram_command" as const };
    const deps = { repo, gateway: new FakeGateway({}) };

    const [first, second] = await Promise.all([
      handlePayInstruction({ instruction, user, mode: "sandbox", allowedDevUserIds: new Set() }, deps),
      handlePayInstruction({ instruction, user, mode: "sandbox", allowedDevUserIds: new Set() }, deps),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    assert.deepEqual(outcomes, ["duplicate", "simulated"], "one delivery wins, the other is a truthful duplicate");
    assert.equal(first.payoutId, second.payoutId, "both responses reference the same payout");

    const key = `tg:-100777:m${messageId}:pay`;
    const rows = await cleanupSql`
      SELECT p.id FROM payouts p
      JOIN payout_items pi ON pi.payout_id = p.id
      WHERE pi.idempotency_key = ${key}
    `;
    assert.equal(rows.length, 1, "exactly one payout row for the logical intent");
  });

  it("duplicate /claimpay delivery raced against itself creates exactly ONE claim", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    const workspace = await repo.getWorkspaceById(workspaceId);
    assert.ok(workspace);
    const chatId = workspace.telegram_chat_id ?? "";
    const messageId = 2_000_000 + Math.floor(Math.random() * 1_000_000);
    const user = { userId: MEMBER, chatId, chatType: "group" as const, messageId, updateId: 100 };
    const instruction = { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const };

    const [first, second] = await Promise.all([
      handleClaimPayInstruction({ instruction, user }, { repo }),
      handleClaimPayInstruction({ instruction, user }, { repo }),
    ]);
    const outcomes = [first.outcome, second.outcome].sort();
    assert.deepEqual(outcomes, ["created", "existing"]);
    assert.equal(first.claimId, second.claimId);

    const claims = await repo.listClaimsByWorkspace(workspaceId);
    const matching = claims.filter((c) => c.idempotency_key === `tg:${chatId}:m${messageId}:claimpay`);
    assert.equal(matching.length, 1, "exactly one claim row for the logical intent");
  });

  it("concurrent claim double-submit by different wallets: one winner, immutable", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: `m8-double-submit-${randomUUID()}`,
    });
    const other = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
    const now = new Date().toISOString();

    const attempts = await Promise.all([
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", now),
      submitClaimRecipient(repo, token.raw, other, "web", now),
    ]);
    assert.equal(attempts.filter((a) => a.ok).length, 1, "the DB transition itself prevents a double claim");

    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored?.claimed_recipient);
    const mutation = await submitClaimRecipient(repo, token.raw, other, "web", new Date().toISOString());
    assert.equal(mutation.ok, false);
    const reread = await repo.getClaimLinkById(claim.id);
    assert.equal(reread?.claimed_recipient, stored.claimed_recipient, "recipient is immutable after the first claim");
  });

  it("a second payout can never be attached to an already-linked claim", async () => {
    const repo = new PostgresRepository(cleanupSql);
    const workspaceId = await fixtureWorkspace(repo);
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: `m8-double-link-${randomUUID()}`,
    });
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: new Date().toISOString() });
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");

    const payout1 = await pendingPayout(repo, workspaceId, "5000", `m8-link-p1-${randomUUID()}`);
    const payout2 = await pendingPayout(repo, workspaceId, "5000", `m8-link-p2-${randomUUID()}`);

    await repo.setClaimPayoutId(claim.id, payout1.payout.id);
    await assert.rejects(repo.setClaimPayoutId(claim.id, payout2.payout.id), /cannot attach payout/);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.payout_id, payout1.payout.id, "only the first payout may be attached");
  });
});
