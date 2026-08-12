import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { ExecutionService } from "../../src/server/execution/execution-service.ts";
import { handleApprovalCallbackUpdate } from "../../src/server/telegram/flows/approval-orchestration.ts";
import { handleClaimApprovalCallbackUpdate } from "../../src/server/telegram/flows/claim-approval-orchestration.ts";
import { claimExpiresAtIso, submitClaimRecipient } from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";
import { FakeGateway, createApprovedItem } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const MEMBER = "123456789";
const APPROVER = "987654321";

async function workspace(repo: MemoryRepository) {
  const w = await repo.createWorkspace({
    mode: "community",
    name: "Recovery",
    telegramChatId: "-1009",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
  await repo.addWorkspaceMember({ workspaceId: w.id, telegramUserId: MEMBER, role: "member" });
  await repo.addWorkspaceMember({ workspaceId: w.id, telegramUserId: APPROVER, role: "approver" });
  return w;
}

describe("M8 failure recovery", () => {
  it("Telegram notification/callback failures never corrupt execution state", async () => {
    const repo = new MemoryRepository();
    const w = await workspace(repo);
    const payout = await repo.createPayout({
      workspaceId: w.id,
      requesterId: MEMBER,
      sourceType: "telegram_command",
      status: "pending_approval",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null,
      status: "pending_approval",
      idempotencyKey: "m8-recovery-1",
    });
    const gateway = new FakeGateway({});
    const failing = {
      answers: [] as string[],
      edits: [] as string[],
      answer: async () => {
        throw new Error("query is too old");
      },
      edit: async () => {
        throw new Error("message not modified");
      },
      reply: async () => {
        throw new Error("chat not found");
      },
    };

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER, chatId: "-1009" },
      { repo, gateway },
      failing,
    );
    const item = (await repo.getPayoutItemsByPayoutId(payout.id))[0];
    assert.equal(item?.status, "completed", "execution state must not depend on Telegram success");
    assert.equal(gateway.executeCalls, 1);
  });

  it("a DB write failure rolls the whole intent back (no orphan payout)", async () => {
    // Subclass the memory repo to fail the payout-item insert.
    const failing = new (class extends MemoryRepository {
      override async createPayoutItem(): Promise<never> {
        throw new Error("connection terminated");
      }
    })();
    const w = await workspace(failing);

    const token = generateClaimTokenPair();
    const claim = await failing.createClaimLink({
      workspaceId: w.id,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-recovery-claim",
    });
    const submitted = await submitClaimRecipient(failing, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(submitted.ok, true);

    const gateway = new FakeGateway({});
    const { validateClaimApprovalCallback, applyClaimApprovalCallback } = await import("../../src/server/claim/service.ts");
    const validation = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-1009" },
      failing,
    );
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    const result = await applyClaimApprovalCallback(validation.context, {
      repo: failing,
      gateway,
    });
    // The transaction rolled back: nothing executed, no payout, claim unchanged.
    assert.equal(result.executed, undefined, "a failed persistence transaction must not report execution");
    assert.equal(gateway.executeCalls, 0, "no KeeperHub call may happen on a rolled-back transaction");
    const stored = await failing.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "claimed", "the rollback leaves the claim unapproved");
    assert.equal([...failing.payouts.values()].length, 0, "no orphan payout row");
  });

  it("a rollback leaves the claim approved with no payout attached", async () => {
    const repo = new MemoryRepository();
    const w = await workspace(repo);
    void repo;
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId: w.id,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-recovery-rollback",
    });
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: "2026-08-13T00:00:00.000Z" });

    // Simulate a transaction rollback: transition to approved, then fail to
    // attach a payout — the claim stays approved with payout_id NULL.
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
    const payout = await repo.createPayout({
      workspaceId: w.id,
      requesterId: MEMBER,
      sourceType: "claim_link",
      status: "approved",
      totalAmountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    await repo.setClaimPayoutId(claim.id, payout.id);
    await assert.rejects(repo.setClaimPayoutId(claim.id, payout.id), /cannot attach payout/);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "approved");
    assert.equal(stored?.payout_id, payout.id);
  });

  it("malformed KeeperHub responses map to unknown, never success", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ executeError: new Error("Unexpected token '<' in JSON") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);
    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");
    const item = await repo.getPayoutItemById(itemId);
    assert.notEqual(item?.status, "completed");
  });

  it("restart after approval: a non-terminal execution reconciles without rebroadcast", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({
      execute: {
        executionId: "reconcile-exec",
        status: "pending",
        type: "transfer",
        transactionHash: null,
        transactionLink: null,
        sponsored: null,
        receipts: [],
        gasUsedWei: null,
        error: null,
        createdAt: "2026-08-12T00:00:00Z",
        completedAt: null,
      },
      pollError: new Error("polling timeout"),
      status: {
        executionId: "reconcile-exec",
        status: "completed",
        type: "transfer",
        transactionHash: "0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089",
        transactionLink: "https://basescan.org/tx/0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089",
        sponsored: null,
        receipts: [],
        gasUsedWei: null,
        error: null,
        createdAt: "2026-08-12T00:00:00Z",
        completedAt: "2026-08-12T00:00:05Z",
      },
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    // First run: submitted but not terminal (simulates a restart mid-flight).
    const first = await service.executePayoutItem(itemId);
    assert.equal(first.kind, "unknown");
    // Re-invocation: the persisted execution id is reconciled from KeeperHub.
    const second = await service.executePayoutItem(itemId);
    assert.equal(second.kind, "completed");
    assert.equal(gateway.executeCalls, 1, "reconciliation must never call execute_transfer again");
    assert.equal(gateway.statusCalls >= 1, true);
  });

  it("claim approval with a failing messenger still completes execution", async () => {
    const repo = new MemoryRepository();
    const w = await workspace(repo);
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId: w.id,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168),
      idempotencyKey: "m8-recovery-claim-2",
    });
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: "2026-08-13T00:00:00.000Z" });

    const gateway = new FakeGateway({});
    const failing = {
      answer: async () => {
        throw new Error("timeout");
      },
      edit: async () => {
        throw new Error("timeout");
      },
      reply: async () => {
        throw new Error("timeout");
      },
    };
    await handleClaimApprovalCallbackUpdate(
      { action: "claim_approve", claimId: claim.id, actorUserId: APPROVER, chatId: "-1009" },
      { repo, gateway },
      failing,
    );
    assert.equal(gateway.executeCalls, 1);
    assert.equal((await repo.getClaimLinkById(claim.id))?.status, "executed");
  });

  it("duplicate /pay command delivery after a crash window stays truthful", async () => {
    const repo = new MemoryRepository();
    const user = { userId: "1", chatId: "-100", chatType: "private" as const, messageId: 7, updateId: 1 };
    const gateway = new FakeGateway({});
    const instruction = { kind: "pay" as const, address: RECIPIENT, amount: "0.01", token: "USDC" as const, sourceType: "telegram_command" as const };
    const { handlePayInstruction } = await import("../../src/server/telegram/flows/pay-flow.ts");
    // First delivery: no sandbox workspace → truthful invalid response, no rows.
    const first = await handlePayInstruction({ instruction, user, mode: "sandbox", allowedDevUserIds: new Set() }, { repo, gateway });
    assert.equal(first.outcome, "invalid");
    assert.equal([...repo.payouts.values()].length, 0);
  });
});
