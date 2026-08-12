import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { ExecutionService } from "../../src/server/execution/execution-service.ts";
import { proofMessage } from "../../src/server/telegram/messages.ts";
import { communityProofMessage } from "../../src/server/telegram/community-messages.ts";
import { judgeProofMessage } from "../../src/server/judge/messages.ts";
import { claimCommunityProofMessage } from "../../src/server/claim/messages.ts";
import { FakeGateway, createApprovedItem, TX_HASH } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("M8 execution truthfulness", () => {
  it("never invents a transaction hash: unknown outcomes carry no hash", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ executeError: new Error("fetch failed") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.transaction_hash, null, "no fabricated hash may be persisted");
    assert.equal(item?.status, "execution_unknown");
    const attempts = [...repo.executionAttempts.values()];
    assert.ok(attempts.every((a) => a.transaction_hash === null), "no attempt may carry a fabricated hash");
  });

  it("failed executions stay truthful and never present a success state", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({
      execute: {
        executionId: "failed-exec",
        status: "failed",
        type: "transfer",
        transactionHash: null,
        transactionLink: null,
        sponsored: null,
        receipts: [],
        gasUsedWei: null,
        error: "execution failed",
        createdAt: "2026-08-12T00:00:00Z",
        completedAt: "2026-08-12T00:00:01Z",
      },
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "failed");
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "execution_failed");
    assert.equal(item?.transaction_hash, null);
    assert.notEqual(item?.status, "completed", "a failed execution must never read as completed");
  });

  it("transient state is never represented as successful", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({
      execute: {
        executionId: "pending-exec",
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
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "execution_unknown");
    assert.equal(item?.transaction_hash, null);
  });

  it("a completed hash is only reported when KeeperHub confirms it, and metadata matches the item", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "completed");
    assert.equal(outcome.transactionHash, TX_HASH);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.transaction_hash, TX_HASH);

    // Executed amount/token/recipient match the approved immutable values.
    const events = repo.auditEvents.filter((e) => e.payout_item_id === itemId && e.event_type === "execution_completed");
    assert.equal(events.length, 1);
    const meta = events[0].metadata as Record<string, unknown>;
    assert.equal(meta.transactionHash, TX_HASH);
    const attempt = [...repo.executionAttempts.values()][0];
    assert.equal(attempt.transaction_hash, TX_HASH);
  });

  it("proof messages only include a BaseScan link when a real hash exists", () => {
    const withHash = proofMessage("exec-1", TX_HASH, `https://basescan.org/tx/${TX_HASH}`);
    assert.match(withHash, /TX HASH/);
    assert.match(withHash, /basescan\.org\/tx\//);

    const noHash = proofMessage("exec-2", "", null);
    assert.ok(!noHash.includes("basescan"), "no link may appear without a hash");
    assert.match(noHash, /TX HASH/);

    // communityProofMessage emits EXECUTION ID + TX HASH (no explorer link).
    const community = communityProofMessage("exec-3", TX_HASH);
    assert.match(community, /TX HASH/);
    assert.match(community, new RegExp(TX_HASH));
    const communityNoHash = communityProofMessage("exec-4", "");
    assert.ok(!communityNoHash.includes("basescan"));
    assert.ok(!communityNoHash.includes("0x"), "an empty hash must not be echoed as a value");

    const judge = judgeProofMessage("exec-5", TX_HASH, "0.01", "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486");
    assert.match(judge, /basescan\.org\/tx\//);

    const claim = claimCommunityProofMessage("exec-6", TX_HASH, "10000", "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486");
    assert.match(claim, /basescan\.org\/tx\//);
    assert.match(claim, /0\.01 USDC/);
  });

  it("retry after completion never creates a duplicate payout or execution", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    await service.executePayoutItem(itemId);
    const second = await service.executePayoutItem(itemId);
    assert.equal(second.kind, "completed");
    assert.equal(gateway.executeCalls, 1, "completed items short-circuit with zero KeeperHub calls");
    assert.equal([...repo.payouts.values()].length, 1);
    assert.equal([...repo.executionAttempts.values()].length, 1);
  });
});
