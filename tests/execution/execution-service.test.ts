import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoDirectExecutionStatus } from "../../src/server/keeperhub/types.ts";
import { ExecutionService } from "../../src/server/execution/execution-service.ts";
import { CHAIN_ID, TOKEN, TX_HASH, completedStatus, createApprovedItem, FakeGateway, RECIPIENT, SIM_OK } from "./fixtures.ts";

const SIM_REVERT = { ...SIM_OK, success: false, wouldRevert: true, revertReason: "Error(revert)" };

describe("execution service", () => {
  it("simulation success → execute called once → completed with tx persisted", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ execute: completedStatus("direct_1") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "completed");
    if (outcome.kind === "completed") {
      assert.equal(outcome.transactionHash, TX_HASH);
      assert.equal(outcome.executionId, "direct_1");
    }
    assert.equal(gateway.simulateCalls, 1);
    assert.equal(gateway.executeCalls, 1);

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "completed");
    assert.equal(loaded.item.transaction_hash, TX_HASH);
    assert.equal(loaded.item.keeperhub_execution_id, "direct_1");
    assert.equal(loaded.item.attempt_count, 1);
    assert.equal(loaded.payout.status, "completed");

    const attempt = await repo.getLatestAttempt(itemId);
    assert.ok(attempt);
    assert.equal(attempt.status, "succeeded");
    assert.equal(attempt.phase, "execution");
    assert.equal(attempt.simulation_result?.success, true);
    assert.equal(attempt.raw_keeperhub_status?.executionId, "direct_1");
  });

  it("simulation failure → execute never called → simulation_failed persisted", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ simulate: SIM_REVERT });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "failed");
    assert.equal(gateway.simulateCalls, 1);
    assert.equal(gateway.executeCalls, 0);

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "simulation_failed");
    assert.equal(loaded.item.keeperhub_execution_id, null);
    assert.equal(loaded.payout.status, "simulation_failed");
  });

  it("accepted but non-terminal → confirming, then poll completes and persists tx", async () => {
    const repo = new MemoryRepository();
    const executing: SolvoDirectExecutionStatus = {
      executionId: "direct_pending",
      status: "running",
      type: "transfer",
      transactionHash: null,
      transactionLink: null,
      sponsored: null,
      receipts: [],
      gasUsedWei: null,
      error: null,
      createdAt: null,
      completedAt: null,
    };
    const gateway = new FakeGateway({ execute: executing, poll: completedStatus("direct_pending") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "completed");
    if (outcome.kind === "completed") assert.equal(outcome.transactionHash, TX_HASH);
    assert.equal(gateway.pollCalls, 1);

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "completed");
    assert.equal(loaded.item.transaction_hash, TX_HASH);
    assert.equal(loaded.item.keeperhub_execution_id, "direct_pending");
  });

  it("execute returns failed → execution_failed persisted, no polling", async () => {
    const repo = new MemoryRepository();
    const failed: SolvoDirectExecutionStatus = {
      executionId: "direct_fail",
      status: "failed",
      type: "transfer",
      transactionHash: null,
      transactionLink: null,
      sponsored: null,
      receipts: [],
      gasUsedWei: null,
      error: "execution reverted",
      createdAt: null,
      completedAt: null,
    };
    const gateway = new FakeGateway({ execute: failed });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "failed");
    assert.equal(gateway.pollCalls, 0);
    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "execution_failed");
  });

  it("poll ambiguity → execution_unknown, NO rebroadcast", async () => {
    const repo = new MemoryRepository();
    const executing: SolvoDirectExecutionStatus = {
      executionId: "direct_ambig",
      status: "running",
      type: "transfer",
      transactionHash: null,
      transactionLink: null,
      sponsored: null,
      receipts: [],
      gasUsedWei: null,
      error: null,
      createdAt: null,
      completedAt: null,
    };
    const gateway = new FakeGateway({
      execute: executing,
      pollError: new Error("timeout: no terminal state"),
      status: executing,
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "unknown");
    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "execution_unknown");
    assert.equal(loaded.item.keeperhub_execution_id, "direct_ambig");
    assert.equal(gateway.executeCalls, 1);

    const retry = await service.executePayoutItem(itemId);
    assert.equal(retry.kind, "unknown");
    assert.equal(gateway.executeCalls, 1, "no rebroadcast after ambiguous outcome");
  });

  it("execute transport failure → execution_unknown, no rebroadcast on retry", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ executeError: new Error("fetch failed: ECONNREFUSED") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "execution_unknown");
    assert.equal(gateway.executeCalls, 1);

    const retry = await service.executePayoutItem(itemId);
    assert.equal(retry.kind, "unknown");
    assert.equal(gateway.executeCalls, 1, "no rebroadcast after transport failure");
  });

  it("existing non-terminal execution id → reconcile by status, never rebroadcast", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await createApprovedItem(repo);
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");
    await repo.setPayoutItemKeeperHubExecution(itemId, "direct_inflight");

    const gateway = new FakeGateway({
      status: {
        executionId: "direct_inflight",
        status: "running",
        type: "transfer",
        transactionHash: null,
        transactionLink: null,
        sponsored: null,
        receipts: [],
        gasUsedWei: null,
        error: null,
        createdAt: null,
        completedAt: null,
      },
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });

    const outcome = await service.executePayoutItem(itemId);

    assert.equal(outcome.kind, "unknown");
    assert.equal(gateway.statusCalls, 1);
    assert.equal(gateway.executeCalls, 0, "must not broadcast when an execution exists");
    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "confirming");
  });

  it("existing execution id with completed status → reconciles to completed with hash", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await createApprovedItem(repo);
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");
    await repo.setPayoutItemKeeperHubExecution(itemId, "direct_done");

    const gateway = new FakeGateway({ status: completedStatus("direct_done") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "completed");
    assert.equal(gateway.executeCalls, 0);

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "completed");
    assert.equal(loaded.item.transaction_hash, TX_HASH);
  });

  it("state without permission → not_executable, no KeeperHub calls", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: "Test",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "auto",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: null,
      sourceType: "direct",
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
      idempotencyKey: `test-key-${Math.random().toString(36).slice(2)}`,
    });

    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });

    const outcome = await service.executePayoutItem(item.id);
    assert.equal(outcome.kind, "not_executable");
    assert.equal(gateway.simulateCalls, 0);
    assert.equal(gateway.executeCalls, 0);
  });

  it("chain/token mismatch → not_executable", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: "Test",
      chainId: "1",
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "auto",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: null,
      sourceType: "direct",
      status: "approved",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: "1",
      tokenAddress: TOKEN,
    });
    const { item } = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null,
      status: "approved",
      idempotencyKey: `test-key-${Math.random().toString(36).slice(2)}`,
    });

    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });

    const outcome = await service.executePayoutItem(item.id);
    assert.equal(outcome.kind, "not_executable");
    assert.equal(gateway.simulateCalls, 0);
  });

  it("completed item → returns completed without any calls", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await createApprovedItem(repo);
    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    await repo.completePayoutItem(itemId, TX_HASH, `https://basescan.org/tx/${TX_HASH}`);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "completed");
    assert.equal(gateway.simulateCalls, 0);
    assert.equal(gateway.executeCalls, 0);
  });

  it("submitted without an execution id (crash window) → execution_unknown, never broadcasts", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await createApprovedItem(repo);
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");

    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");
    assert.equal(gateway.simulateCalls, 0);
    assert.equal(gateway.executeCalls, 0);

    const loaded = await repo.getPayoutItemForExecution(itemId);
    assert.ok(loaded);
    assert.equal(loaded.item.status, "execution_unknown");
  });
});

describe("idempotency", () => {
  it("duplicate idempotency key returns the existing item, never creates a second", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: "Test",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "auto",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: null,
      sourceType: "direct",
      status: "approved",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
    });
    const input = {
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null as string | null,
      status: "approved" as const,
      idempotencyKey: "logical-key-123",
    };

    const first = await repo.createPayoutItem(input);
    const second = await repo.createPayoutItem(input);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.item.id, first.item.id);
    assert.equal(repo.payoutItems.size, 1);
  });

  it("creates distinct items for distinct keys", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "development",
      name: "Test",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "auto",
    });
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: null,
      sourceType: "direct",
      status: "approved",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: CHAIN_ID,
      tokenAddress: TOKEN,
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null,
      status: "approved",
      idempotencyKey: "key-a",
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "10000",
      memo: null,
      status: "approved",
      idempotencyKey: "key-b",
    });
    assert.equal(repo.payoutItems.size, 2);
  });
});
