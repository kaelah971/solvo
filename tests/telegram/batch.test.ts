import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import type { SolvoDirectExecutionStatus, SolvoSimulationResult } from "../../src/server/keeperhub/types.ts";
import { handleApprovalCallback } from "../../src/server/telegram/flows/approval-flow.ts";
import { handleApprovalCallbackUpdate } from "../../src/server/telegram/flows/approval-orchestration.ts";
import {
  handleCommunityBatchInstruction,
  parseBatchBody,
  validateBatchItems,
} from "../../src/server/telegram/flows/community-batch-flow.ts";
import { handleMemberAdd } from "../../src/server/telegram/flows/member-flow.ts";
import { handleWorkspaceInit } from "../../src/server/telegram/flows/workspace-flow.ts";
import { handleStatusInstruction } from "../../src/server/telegram/flows/status-flow.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import type { KeeperHubExecutionGateway } from "../../src/server/execution/execution-service.ts";
import { completedStatus, SIM_OK } from "../execution/fixtures.ts";

const OWNER = "100000001";
const APPROVER = "100000002";
const MEMBER = "100000003";
const OTHER = "100000004";
const CHAT = "-1001234567890";
const ADDRESS_A = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const ADDRESS_B = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DEV_OPERATORS = new Set([OWNER]);

function groupUser(userId: string, messageId = 1): TelegramUser {
  return { userId, chatId: CHAT, chatType: "supergroup", messageId, updateId: 2000 + messageId };
}

const SIM_FAIL: SolvoSimulationResult = {
  success: false,
  wouldRevert: true,
  from: null,
  to: null,
  value: null,
  gasEstimate: null,
  revertReason: "Error(revert)",
  code: "simulation_reverted",
  balanceWei: null,
  requiredWei: null,
  shortfallWei: null,
  error: "Error(revert)",
};

class ScriptedGateway implements KeeperHubExecutionGateway {
  simulateCalls = 0;
  executeCalls = 0;
  private readonly simulateScript: Array<SolvoSimulationResult | { throw: Error }>;
  private readonly executeScript: Array<SolvoDirectExecutionStatus | { throw: Error }>;

  constructor(
    simulateScript: Array<SolvoSimulationResult | { throw: Error }>,
    executeScript: Array<SolvoDirectExecutionStatus | { throw: Error }> = [],
  ) {
    this.simulateScript = simulateScript;
    this.executeScript = executeScript;
  }

  async simulateTransfer(): Promise<SolvoSimulationResult> {
    this.simulateCalls += 1;
    const result = this.simulateScript.shift() ?? SIM_OK;
    if ("throw" in result) throw result.throw;
    return result;
  }

  async executeTransfer(): Promise<SolvoDirectExecutionStatus> {
    this.executeCalls += 1;
    const result = this.executeScript.shift() ?? completedStatus(`exec_${this.executeCalls}`);
    if ("throw" in result) throw result.throw;
    return result;
  }

  async getDirectExecutionStatus(): Promise<SolvoDirectExecutionStatus> {
    return completedStatus("poll_status");
  }

  async pollUntilTerminal(): Promise<SolvoDirectExecutionStatus> {
    return completedStatus("poll_status");
  }
}

async function seedWorkspace(
  repo: SolvoRepository,
): Promise<{ workspaceId: string }> {
  const init = await handleWorkspaceInit(
    { user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS },
    { repo },
  );
  assert.equal(init.outcome, "created");
  await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
  await handleMemberAdd({ user: groupUser(OWNER, 3), targetUserId: MEMBER, role: "member" }, { repo });
  await repo.addRecipient({ workspaceId: (await repo.getWorkspaceByTelegramChatId(CHAT))!.id, alias: "alice", walletAddress: ADDRESS_A.toLowerCase(), createdBy: OWNER });
  await repo.addRecipient({ workspaceId: (await repo.getWorkspaceByTelegramChatId(CHAT))!.id, alias: "bob", walletAddress: ADDRESS_B.toLowerCase(), createdBy: OWNER });
  return { workspaceId: (await repo.getWorkspaceByTelegramChatId(CHAT))!.id };
}

const BATCH_3 = "alice 0.01 USDC\nbob 0.02 USDC\n0x1111111111111111111111111111111111111111 0.01 USDC";

async function submitBatch(repo: SolvoRepository, body = BATCH_3, userId = MEMBER, messageId = 4): Promise<{
  payoutId: string;
  items: Array<{ id: string; address: string; amountBaseUnits: string }>;
}> {
  const reply = await handleCommunityBatchInstruction(
    { instruction: { kind: "batch", body }, user: groupUser(userId, messageId) },
    { repo },
  );
  assert.ok(reply.buttons, `expected buttons, got: ${reply.text}`);
  const match = /^solvo:(?:approve|reject):([0-9a-f-]{36})$/.exec(reply.buttons[0].callbackData);
  assert.ok(match);
  const payoutId = match[1];
  const items = await repo.getPayoutItemsByPayoutId(payoutId);
  return {
    payoutId,
    items: items.map((item) => ({
      id: item.id,
      address: item.recipient_address,
      amountBaseUnits: item.amount_base_units,
    })),
  };
}

describe("batch parsing", () => {
  it("parses /batch with space-separated lines", () => {
    const result = parseInstruction("/batch\nalice 0.01 USDC\nbob 0.02 USDC");
    assert.equal(result.kind, "batch");
    if (result.kind === "batch") {
      const parsed = parseBatchBody(result.body);
      assert.equal(parsed.errors.length, 0);
      assert.equal(parsed.lines.length, 2);
      assert.equal(parsed.lines[0].recipient, "alice");
      assert.equal(parsed.lines[0].amount, "0.01");
    }
  });

  it("parses comma-separated lines", () => {
    const result = parseInstruction("/batch\nalice,0.01\nbob,0.02 USDC");
    assert.equal(result.kind, "batch");
    if (result.kind === "batch") {
      const parsed = parseBatchBody(result.body);
      assert.equal(parsed.errors.length, 0);
      assert.equal(parsed.lines.length, 2);
      assert.equal(parsed.lines[1].amount, "0.02");
    }
  });

  it("rejects an empty /batch", () => {
    assert.equal(parseInstruction("/batch").kind, "failure");
  });

  it("rejects malformed lines individually", () => {
    const parsed = parseBatchBody("alice 0.01 USDC\ngarbage line\n0xabc 1 usdc");
    assert.equal(parsed.lines.length, 2);
    assert.equal(parsed.errors.length, 1);
  });

  it("rejects address-shaped strings that are not valid aliases or addresses", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC\n0xabc 1 usdc" }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /Invalid recipient 0xabc/);
    assert.equal([...repo.payouts.values()].length, 0);
  });

  it("rejects unsupported tokens", () => {
    const parsed = parseBatchBody("alice 0.01 ETH");
    assert.equal(parsed.errors.length, 1);
  });

  it("rejects usernames as recipients", () => {
    const parsed = parseBatchBody("@alex 0.01 USDC");
    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0], /Usernames cannot authorize/);
  });

  it("rejects an amount above the item cap", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 1 USDC" }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /Invalid amount/);
  });
});

describe("batch validation", () => {
  it("rejects the whole batch when one row is invalid", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const reply = await handleCommunityBatchInstruction(
      {
        instruction: { kind: "batch", body: "alice 0.01 USDC\nunknownalias 0.02 USDC" },
        user: groupUser(MEMBER, 4),
      },
      { repo },
    );
    assert.match(reply.text, /Unknown recipient/);
    assert.equal([...repo.payouts.values()].length, 0, "nothing was persisted");
  });

  it("rejects duplicate resolved addresses deterministically", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const result = await validateBatchItems(
      parseBatchBody("alice 0.01 USDC\n0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC").lines,
      (await repo.getWorkspaceByTelegramChatId(CHAT))!.id,
      repo,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Duplicate recipient/);
  });

  it("rejects duplicate aliases resolving to the same address", async () => {
    const repo = new MemoryRepository();
    const { workspaceId } = await seedWorkspace(repo);
    await repo.addRecipient({ workspaceId, alias: "alice2", walletAddress: ADDRESS_A.toLowerCase(), createdBy: OWNER });
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC\nalice2 0.01 USDC" }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /Duplicate recipient/);
  });

  it("rejects batches above the 20-item cap", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const lines = Array.from({ length: 21 }, (_, i) => `0x${String(i + 1).padStart(40, "0")} 0.01 USDC`).join("\n");
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: lines }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /too many recipients/);
  });

  it("blocks non-members", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC" }, user: groupUser(OTHER, 4) },
      { repo },
    );
    assert.match(reply.text, /not a member/);
  });
});

describe("batch persistence", () => {
  it("persists one payout with three items, all pending_approval", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId, items } = await submitBatch(repo);
    assert.equal(items.length, 3);
    const payout = await repo.getPayoutById(payoutId);
    assert.equal(payout?.status, "pending_approval");
    assert.equal(payout?.total_amount_base_units, "40000");
    assert.equal(payout?.source_type, "telegram_batch");
    assert.equal(payout?.workspace_id, (await repo.getWorkspaceByTelegramChatId(CHAT))!.id);
    for (const item of items) {
      const loaded = await repo.getPayoutItemById(item.id);
      assert.equal(loaded?.status, "pending_approval");
    }
    const keys = new Set((await repo.getPayoutItemsByPayoutId(payoutId)).map((item) => item.idempotency_key));
    assert.equal(keys.size, 3, "every item has a unique idempotency key");
  });

  it("duplicate Telegram delivery returns the existing batch", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const first = await submitBatch(repo, BATCH_3, MEMBER, 7);
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC\nbob 0.02 USDC\n0x1111111111111111111111111111111111111111 0.01 USDC" }, user: groupUser(MEMBER, 7) },
      { repo },
    );
    assert.match(reply.text, /already received/);
    const all = [...repo.payouts.values()];
    assert.equal(all.length, 1);
    assert.equal(first.payoutId, all[0].id);
  });

  it("the batch preview shows the total and per-item summaries", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC\nbob 0.02 USDC" }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /BATCH PAYOUT/);
    assert.match(reply.text, /RECIPIENTS\s+2/);
    assert.match(reply.text, /TOTAL\s+0\.03 USDC/);
    assert.match(reply.text, /APPROVAL\s+REQUIRED/);
    assert.match(reply.text, /alice/);
    assert.match(reply.text, /bob/);
    assert.equal(reply.buttons?.length, 2);
  });
});

describe("batch approval security", () => {
  it("a member cannot approve a batch", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: MEMBER, chatId: CHAT },
      { repo, gateway: new ScriptedGateway([]) },
    );
    assert.equal(result.answer, "You are not authorized to approve this request.");
  });

  it("the requester cannot self-approve their batch", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    await handleMemberAdd({ user: groupUser(OWNER, 9), targetUserId: APPROVER, role: "approver" }, { repo });
    const { payoutId } = await submitBatch(repo, BATCH_3, APPROVER, 5);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway: new ScriptedGateway([]) },
    );
    assert.equal(result.answer, "A different treasury approver must approve this request.");
  });

  it("callbacks from the wrong chat are rejected", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: "-999999999" },
      { repo, gateway: new ScriptedGateway([]) },
    );
    assert.equal(result.answer, "This request does not belong to this chat.");
  });

  it("duplicate batch approvals produce exactly one execution", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.executeCalls, 3);
    const second = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(second.answer, "This request has already been handled.");
    assert.equal(gateway.executeCalls, 3);
  });

  it("concurrent batch approvals produce exactly one execution", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const results = await Promise.all([
      handleApprovalCallback(
        { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
        { repo, gateway },
      ),
      handleApprovalCallback(
        { action: "approve", payoutId, actorUserId: OWNER, chatId: CHAT },
        { repo, gateway },
      ),
    ]);
    const winners = results.filter((result) => /approved/i.test(result.answer)).length;
    const losers = results.filter((result) => /already been handled/i.test(result.answer)).length;
    assert.equal(winners, 1);
    assert.equal(losers, 1);
    assert.equal(gateway.executeCalls, 3);
  });

  it("a rejected batch never executes and all items cancel", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId, items } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const result = await handleApprovalCallback(
      { action: "reject", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /rejected/i);
    assert.equal(gateway.executeCalls, 0);
    assert.equal((await repo.getPayoutById(payoutId))?.status, "cancelled");
    for (const item of items) {
      assert.equal((await repo.getPayoutItemById(item.id))?.status, "cancelled");
    }
  });
});

describe("batch execution", () => {
  it("executes a successful 3-item batch sequentially with a full receipt", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId, items } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.simulateCalls, 3);
    assert.equal(gateway.executeCalls, 3);
    assert.equal((await repo.getPayoutById(payoutId))?.status, "completed");
    assert.match(result.edited ?? "", /BATCH COMPLETE/);
    assert.match(result.edited ?? "", /3\/3 completed/);
    assert.match(result.edited ?? "", /0\.04 USDC successfully transferred/);
    for (const item of items) {
      const loaded = await repo.getPayoutItemById(item.id);
      assert.equal(loaded?.status, "completed");
      assert.ok(loaded?.transaction_hash);
    }
  });

  it("records partial failure truthfully: first succeeds, second fails, third succeeds", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId, items } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_FAIL, SIM_OK]);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.simulateCalls, 3);
    assert.equal(gateway.executeCalls, 2, "the failed item never executed");
    assert.equal((await repo.getPayoutById(payoutId))?.status, "partially_completed");
    assert.match(result.edited ?? "", /BATCH PARTIALLY COMPLETED/);
    assert.match(result.edited ?? "", /2\/3 completed/);
    assert.match(result.edited ?? "", /0\.02 USDC successfully transferred/);
    assert.equal((await repo.getPayoutItemById(items[0].id))?.status, "completed");
    assert.equal((await repo.getPayoutItemById(items[1].id))?.status, "simulation_failed");
    assert.equal((await repo.getPayoutItemById(items[2].id))?.status, "completed");
  });

  it("completed items are never retried by a later execution pass", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_FAIL, SIM_OK]);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    const completedIds = new Set(
      (await repo.getPayoutItemsByPayoutId(payoutId))
        .filter((item) => item.status === "completed")
        .map((item) => item.id),
    );
    assert.equal(completedIds.size, 2);

    const { ExecutionService } = await import("../../src/server/execution/execution-service.ts");
    const executions = new ExecutionService(repo, gateway, {
      chainId: "8453",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    const callsBefore = gateway.simulateCalls + gateway.executeCalls;
    for (const id of completedIds) {
      const outcome = await executions.executePayoutItem(id);
      assert.equal(outcome.kind, "completed");
    }
    assert.equal(gateway.simulateCalls + gateway.executeCalls, callsBefore, "completed items never touch KeeperHub again");
    for (const id of completedIds) {
      assert.equal((await repo.getPayoutItemById(id))?.status, "completed");
    }
  });

  it("handles execution_unknown without fabricating an outcome", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId, items } = await submitBatch(repo);
    const gateway = new ScriptedGateway(
      [SIM_OK, SIM_OK, SIM_OK],
      [completedStatus("exec_ok"), { throw: new Error("fetch failed: aborted") }],
    );
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal((await repo.getPayoutById(payoutId))?.status, "partially_completed");
    assert.match(result.edited ?? "", /execution_unknown/i);
    assert.equal((await repo.getPayoutItemById(items[1].id))?.status, "execution_unknown");
  });

  it("an all-simulation-failed batch settles as simulation_failed without executions", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_FAIL, SIM_FAIL, SIM_FAIL]);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.executeCalls, 0);
    assert.equal((await repo.getPayoutById(payoutId))?.status, "simulation_failed");
    assert.match(result.edited ?? "", /0\/3 completed/);
  });
});

describe("batch policy limits", () => {
  it("enforces the aggregate daily limit at request time", async () => {
    const repo = new MemoryRepository();
    const { workspaceId } = await seedWorkspace(repo);
    const completed = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "telegram_command",
      status: "completed",
      totalAmountBaseUnits: "990000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    await repo.createPayoutItem({
      payoutId: completed.id,
      recipientAddress: ADDRESS_A.toLowerCase(),
      amountBaseUnits: "990000",
      memo: null,
      status: "completed",
      idempotencyKey: `spend-${Math.random().toString(36).slice(2)}`,
    });
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: "alice 0.01 USDC\nbob 0.02 USDC" }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /daily execution limit/);
  });

  it("re-checks the daily limit atomically at approval time", async () => {
    const repo = new MemoryRepository();
    const { workspaceId } = await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const completed = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "telegram_command",
      status: "completed",
      totalAmountBaseUnits: "990000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    await repo.createPayoutItem({
      payoutId: completed.id,
      recipientAddress: ADDRESS_A.toLowerCase(),
      amountBaseUnits: "990000",
      memo: null,
      status: "completed",
      idempotencyKey: `spend-${Math.random().toString(36).slice(2)}`,
    });
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /daily execution limit/);
    assert.equal(gateway.executeCalls, 0);
    assert.equal((await repo.getPayoutById(payoutId))?.status, "pending_approval");
  });

  it("a batch cannot bypass the daily limit with many small items", async () => {
    const repo = new MemoryRepository();
    const { workspaceId } = await seedWorkspace(repo);
    const completed = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "telegram_command",
      status: "completed",
      totalAmountBaseUnits: "500000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    });
    await repo.createPayoutItem({
      payoutId: completed.id,
      recipientAddress: ADDRESS_A.toLowerCase(),
      amountBaseUnits: "500000",
      memo: null,
      status: "completed",
      idempotencyKey: `spend-${Math.random().toString(36).slice(2)}`,
    });
    const lines = Array.from({ length: 20 }, (_, i) => `0x${String(i + 1).padStart(40, "0")} 0.08 USDC`).join("\n");
    const reply = await handleCommunityBatchInstruction(
      { instruction: { kind: "batch", body: lines }, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /daily execution limit/);
  });
});

describe("batch status aggregation", () => {
  it("aggregates per-item states truthfully for partial batches", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_FAIL, SIM_OK]);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    const status = await handleStatusInstruction(payoutId, repo, { userId: MEMBER, chatId: CHAT });
    assert.equal(status.found, true);
    assert.match(status.text, /STATE\s+PARTIALLY_COMPLETED/);
    assert.match(status.text, /COMPLETED\s+2/);
    assert.match(status.text, /NOT DONE\s+1/);
    assert.match(status.text, /TRANSFERRED\s+0\.02 USDC/);
    assert.match(status.text, /alice/);
    assert.match(status.text, /simulation_failed/i);
  });
});

describe("batch audit lifecycle", () => {
  it("records request → approval → per-item simulation/execution → aggregate", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    const events = repo.auditEvents.filter((event) => event.payout_id === payoutId);
    const types = events.map((event) => event.event_type);
    assert.ok(types.includes("request_created"));
    assert.ok(types.includes("approval_required"));
    const approval = events.find((event) => event.event_type === "approval_granted");
    assert.equal(approval?.actor_id, APPROVER);
    assert.equal(approval?.actor_type, "approver");
    const itemEvents = events.filter((event) => event.payout_item_id !== null);
    assert.equal(itemEvents.filter((event) => event.event_type === "simulation_started").length, 3);
    assert.equal(itemEvents.filter((event) => event.event_type === "simulation_passed").length, 3);
    assert.equal(itemEvents.filter((event) => event.event_type === "execution_completed").length, 3);
    const aggregate = events.find((event) => event.metadata?.aggregate === true);
    assert.ok(aggregate);
    assert.equal(aggregate?.event_type, "execution_completed");
  });

  it("records a partially completed aggregate event", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_FAIL, SIM_OK]);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    const aggregate = repo.auditEvents.find((event) => event.metadata?.aggregate === true);
    assert.ok(aggregate);
    assert.equal(aggregate?.event_type, "batch_partially_completed");
    assert.equal(aggregate?.metadata?.completed, 2);
    assert.equal(aggregate?.metadata?.total, 3);
  });
});

describe("batch callback orchestration", () => {
  it("acknowledges the callback before any batch execution resolves", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const records: Array<{ kind: string }> = [];
    const messenger = {
      answer: async (text: string) => {
        assert.match(text, /Processing payment/);
        assert.equal(
          gateway.simulateCalls + gateway.executeCalls,
          0,
          "the callback was acknowledged before any KeeperHub call",
        );
        records.push({ kind: "answer" });
      },
      edit: async () => {
        records.push({ kind: "edit" });
      },
      reply: async () => {
        records.push({ kind: "reply" });
      },
    };
    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
    );
    const answer = records.findIndex((record) => record.kind === "answer");
    const edit = records.findIndex((record) => record.kind === "edit");
    assert.ok(answer >= 0, "callback was acknowledged");
    assert.ok(edit > answer, "final message edit came after the acknowledgement");
    assert.equal(gateway.executeCalls, 3);
  });

  it("Telegram edit failure falls back to a reply without corrupting state", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const replies: string[] = [];
    const messenger = {
      answer: async () => {},
      edit: async () => {
        throw new Error("message is not modified");
      },
      reply: async (text: string) => {
        replies.push(text);
      },
    };
    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
    );
    assert.ok(replies.some((text) => text.includes("BATCH COMPLETE")));
    assert.equal((await repo.getPayoutById(payoutId))?.status, "completed");
    assert.equal(gateway.executeCalls, 3);
  });

  it("callback acknowledgement failure does not corrupt execution state", async () => {
    const repo = new MemoryRepository();
    await seedWorkspace(repo);
    const { payoutId } = await submitBatch(repo);
    const gateway = new ScriptedGateway([SIM_OK, SIM_OK, SIM_OK]);
    const messenger = {
      answer: async () => {
        throw new Error("query is too old and response timeout expired or query ID is invalid");
      },
      edit: async () => {},
      reply: async () => {},
    };
    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
    );
    assert.equal(gateway.executeCalls, 3);
    assert.equal((await repo.getPayoutById(payoutId))?.status, "completed");
  });
});


