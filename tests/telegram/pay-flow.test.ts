import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import type { SolvoDirectExecutionStatus } from "../../src/server/keeperhub/types.ts";
import { handlePayInstruction, resolveMode, telegramIdempotencyKey } from "../../src/server/telegram/flows/pay-flow.ts";
import { handleStatusInstruction } from "../../src/server/telegram/flows/status-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway, TX_HASH } from "../execution/fixtures.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const USER_ID = "111111111";
const ALLOWED = new Set([USER_ID]);
const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: USER_ID,
    chatId: "12345",
    chatType: "private",
    messageId: 42,
    updateId: 900,
    ...overrides,
  };
}

async function seedWorkspaces(repo: SolvoRepository): Promise<void> {
  await repo.createWorkspace({
    mode: "sandbox",
    name: "Sandbox",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "auto",
  });
  await repo.createWorkspace({
    mode: "development",
    name: "Development",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "auto",
  });
}

describe("resolveMode", () => {
  it("assigns development to allowlisted users and sandbox to everyone else", () => {
    assert.equal(resolveMode("111111111", new Set(["111111111"])), "development");
    assert.equal(resolveMode("333333333", new Set(["111111111"])), "sandbox");
    assert.equal(resolveMode("111111111", new Set()), "sandbox");
  });
});

describe("telegramIdempotencyKey", () => {
  it("is stable for the same chat and message", () => {
    assert.equal(telegramIdempotencyKey(user()), telegramIdempotencyKey(user()));
  });

  it("changes when the message changes", () => {
    assert.notEqual(telegramIdempotencyKey(user()), telegramIdempotencyKey(user({ messageId: 43 })));
  });

  it("falls back to the update id when there is no message id", () => {
    const a = telegramIdempotencyKey(user({ messageId: null, updateId: 100 }));
    const b = telegramIdempotencyKey(user({ messageId: null, updateId: 101 }));
    assert.notEqual(a, b);
  });
});

describe("handlePayInstruction — sandbox", () => {
  it("simulates without moving funds and persists the request", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );

    assert.equal(reply.outcome, "simulated");
    assert.ok(reply.payoutId);
    assert.match(reply.final, /SIMULATION COMPLETE/);
    assert.match(reply.final, /NO FUNDS WERE MOVED/);
    assert.equal(gateway.simulateCalls, 0, "sandbox must never call KeeperHub simulation");
    assert.equal(gateway.executeCalls, 0, "sandbox must never call execute_transfer");

    const loaded = reply.itemId ? await repo.getPayoutItemForExecution(reply.itemId) : null;
    assert.ok(loaded);
    assert.equal(loaded.item.status, "simulating");
    assert.equal(loaded.item.transaction_hash, null);
    assert.equal(loaded.item.keeperhub_execution_id, null);
    assert.equal(loaded.payout.workspace_id, [...repo.workspaces.values()].find((w) => w.mode === "sandbox")?.id);
  });

  it("rejects an invalid address with nothing persisted", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: "0x123", amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );
    assert.equal(reply.outcome, "invalid");
    assert.match(reply.final, /Nothing was submitted/);
    assert.equal(repo.payoutItems.size, 0);
    assert.equal(gateway.executeCalls, 0);
  });

  it("rejects an amount above the cap", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "5", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway: new FakeGateway({}) },
    );
    assert.equal(reply.outcome, "invalid");
    assert.match(reply.final, /cap/i);
    assert.equal(repo.payoutItems.size, 0);
  });
});

describe("handlePayInstruction — development", () => {
  it("executes a real flow for an allowlisted user and returns proof", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );

    assert.equal(reply.outcome, "completed");
    assert.ok(reply.payoutId);
    assert.match(reply.final, /Payment completed/);
    assert.match(reply.final, /TX HASH/);
    assert.equal(gateway.simulateCalls, 1);
    assert.equal(gateway.executeCalls, 1);

    const loaded = reply.itemId ? await repo.getPayoutItemForExecution(reply.itemId) : null;
    assert.ok(loaded);
    assert.equal(loaded.item.status, "completed");
    assert.equal(loaded.item.transaction_hash, TX_HASH);
    assert.ok(loaded.item.keeperhub_execution_id);
  });

  it("does not execute when the amount is above the cap", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.11", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );
    assert.equal(reply.outcome, "invalid");
    assert.equal(gateway.executeCalls, 0);
  });

  it("reports simulation failure without broadcasting", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({
      simulate: {
        success: false,
        wouldRevert: true,
        from: null,
        to: null,
        value: null,
        gasEstimate: null,
        revertReason: "Error(revert)",
        code: null,
        balanceWei: null,
        requiredWei: null,
        shortfallWei: null,
        error: "Error(revert)",
      },
    });
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );
    assert.equal(reply.outcome, "failed");
    assert.match(reply.final, /simulation failed/i);
    assert.match(reply.final, /No transaction was broadcast/i);
    assert.equal(gateway.executeCalls, 0);
  });

  it("reports execution failure", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
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
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway: new FakeGateway({ execute: failed }) },
    );
    assert.equal(reply.outcome, "failed");
    assert.match(reply.final, /Review is required/);
  });

  it("reports execution unknown without retrying", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({ executeError: new Error("fetch failed: ECONNREFUSED") });
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );
    assert.equal(reply.outcome, "unknown");
    assert.match(reply.final, /will not automatically send another transaction/);
    assert.equal(gateway.executeCalls, 1);
  });
});

describe("idempotency — duplicate delivery", () => {
  it("delivering the same update twice creates one payout and runs at most one execution", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const instruction = { kind: "pay" as const, address: ADDRESS, amount: "0.01", token: "USDC" as const, sourceType: "telegram_command" as const };
    const input = { instruction, user: user(), mode: "development" as const, allowedDevUserIds: ALLOWED };

    const first = await handlePayInstruction(input, { repo, gateway });
    const second = await handlePayInstruction(input, { repo, gateway });

    assert.equal(first.outcome, "completed");
    assert.equal(second.outcome, "duplicate");
    assert.equal(second.payoutId, first.payoutId);
    assert.equal(second.itemId, first.itemId);
    assert.equal(gateway.executeCalls, 1, "max one execute call for one instruction");
    assert.equal(repo.payouts.size, 1);
    assert.equal(repo.payoutItems.size, 1);
  });

  it("same message id in a different chat is a different instruction", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const instruction = { kind: "pay" as const, address: ADDRESS, amount: "0.01", token: "USDC" as const, sourceType: "telegram_command" as const };

    const a = await handlePayInstruction(
      { instruction, user: user({ chatId: "1" }), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );
    const b = await handlePayInstruction(
      { instruction, user: user({ chatId: "2" }), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );
    assert.equal(a.outcome, "simulated");
    assert.equal(b.outcome, "simulated");
    assert.notEqual(a.payoutId, b.payoutId);
    assert.equal(repo.payoutItems.size, 2);
  });
});

describe("handleStatusInstruction", () => {
  it("returns not found for unknown payouts", async () => {
    const repo = new MemoryRepository();
    const reply = await handleStatusInstruction("missing", repo);
    assert.equal(reply.found, false);
    assert.match(reply.text, /not found/i);
  });

  it("shows the sandbox state and notes no funds moved", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway: new FakeGateway({}) },
    );
    assert.ok(reply.payoutId);
    const status = await handleStatusInstruction(reply.payoutId, repo);
    assert.equal(status.found, true);
    assert.match(status.text, /NO FUNDS WERE MOVED/);
    assert.match(status.text, /PAYOUT STATUS/);
  });

  it("shows execution_unknown without offering an automatic retry", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({ executeError: new Error("fetch failed") });
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user(), mode: "development", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );
    assert.ok(reply.payoutId);
    const status = await handleStatusInstruction(reply.payoutId, repo);
    assert.match(status.text, /Execution state is unknown/);
    assert.match(status.text, /will not automatically retry/);
  });
});

describe("security", () => {
  it("a non-allowlisted user is routed to sandbox and cannot trigger real execution", async () => {
    const repo = new MemoryRepository();
    await seedWorkspaces(repo);
    const gateway = new FakeGateway({});
    const reply = await handlePayInstruction(
      { instruction: { kind: "pay", address: ADDRESS, amount: "0.01", token: "USDC", sourceType: "telegram_command" }, user: user({ userId: "333333333" }), mode: "sandbox", allowedDevUserIds: ALLOWED },
      { repo, gateway },
    );
    assert.equal(reply.outcome, "simulated");
    assert.equal(gateway.executeCalls, 0);
  });
});
