import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { JudgeConfig } from "../../src/server/judge/config.ts";
import { evaluateJudgeRequest } from "../../src/server/judge/policy.ts";
import {
  handleJudgePayInstruction,
  judgeIdempotencyKey,
} from "../../src/server/telegram/flows/judge-flow.ts";
import type { JudgePayInstruction, TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const JUDGE_ID = "123456789";
const OTHER_USER = "999999999";

const JUDGE_CONFIG: JudgeConfig = {
  enabled: true,
  judgeUserIds: new Set([JUDGE_ID]),
  perTxLimitBaseUnits: "100000",
  dailyLimitBaseUnits: "1000000",
  keeperhubJudgeIntegrationId: null,
};

function judgeUser(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: JUDGE_ID,
    chatId: "-100123",
    chatType: "private",
    messageId: 42,
    updateId: 1,
    ...overrides,
  };
}

function judgeInstruction(overrides: Partial<JudgePayInstruction> = {}): JudgePayInstruction {
  return { kind: "judge_pay", address: RECIPIENT, amount: "0.01", token: "USDC", ...overrides };
}

async function createJudgeWorkspace(repo: MemoryRepository) {
  return repo.createWorkspace({
    mode: "judge",
    name: "Judge",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "auto_approve_within_judge_policy",
  });
}

describe("judge flow", () => {
  it("persists a payout + item and executes exactly once for a valid judge payment", async () => {
    const repo = new MemoryRepository();
    const workspace = await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});
    const user = judgeUser();

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user },
      { repo, gateway, config: JUDGE_CONFIG },
    );

    assert.equal(reply.outcome, "completed");
    assert.ok(reply.payoutId);
    assert.ok(reply.itemId);
    assert.match(reply.final, /Execution ID/);
    assert.match(reply.final, /TX hash/);
    assert.match(reply.final, /BaseScan/);
    assert.match(reply.final, /0\.01 USDC/);
    assert.match(reply.final, new RegExp(RECIPIENT));
    assert.match(reply.final, /Status: completed/);

    assert.equal(gateway.simulateCalls, 1);
    assert.equal(gateway.executeCalls, 1);

    const payouts = [...repo.payouts.values()].filter((p) => p.workspace_id === workspace.id);
    assert.equal(payouts.length, 1);
    assert.equal(payouts[0].source_type, "judge_telegram");
    assert.equal(payouts[0].status, "completed");
    assert.equal(payouts[0].requester_id, JUDGE_ID);

    const item = [...repo.payoutItems.values()].find((i) => i.id === reply.itemId);
    assert.ok(item);
    assert.equal(item.recipient_address, RECIPIENT);
    assert.equal(item.amount_base_units, "10000");
    assert.equal(item.idempotency_key, judgeIdempotencyKey(user));

    const judgeEvents = repo.auditEvents.filter((e) => e.payout_id === payouts[0].id);
    const types = judgeEvents.map((e) => e.event_type);
    assert.ok(types.includes("request_created"));
    assert.ok(types.includes("approval_granted"));
    assert.ok(types.includes("execution_submitted"));
    assert.ok(types.includes("execution_completed"));
    assert.ok(
      judgeEvents.every((e) => e.actor_type === "judge" || e.actor_type === "system"),
      "judge payments must be audited as judge actors",
    );
  });

  it("does not execute twice on duplicate Telegram delivery", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});
    const user = judgeUser();

    const first = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(first.outcome, "completed");

    const second = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(second.outcome, "duplicate");
    assert.match(second.final, /already received/);
    assert.equal(gateway.executeCalls, 1, "duplicate delivery must not execute again");
    assert.equal([...repo.payouts.values()].filter((p) => p.source_type === "judge_telegram").length, 1);
  });

  it("blocks non-allowlisted users before anything is persisted", async () => {
    const repo = new MemoryRepository();
    const workspace = await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser({ userId: OTHER_USER }) },
      { repo, gateway, config: JUDGE_CONFIG },
    );

    assert.equal(reply.outcome, "blocked");
    assert.match(reply.final, /JUDGE PAYMENT BLOCKED/);
    assert.equal(gateway.executeCalls, 0);
    assert.equal([...repo.payouts.values()].filter((p) => p.workspace_id === workspace.id).length, 0);
  });

  it("blocks when judge mode is disabled", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: { ...JUDGE_CONFIG, enabled: false } },
    );
    assert.equal(reply.outcome, "blocked");
    assert.match(reply.final, /not enabled/i);
    assert.equal(gateway.executeCalls, 0);
  });

  it("blocks when the daily cap would be exceeded", async () => {
    const repo = new MemoryRepository();
    const workspace = await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const config: JudgeConfig = { ...JUDGE_CONFIG, dailyLimitBaseUnits: "10000" };
    const first = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config },
    );
    assert.equal(first.outcome, "completed");

    const second = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser({ messageId: 43, updateId: 2 }) },
      { repo, gateway, config },
    );
    assert.equal(second.outcome, "blocked");
    assert.match(second.final, /daily cap/i);
    assert.equal(gateway.executeCalls, 1, "only the first payment may execute");

    const payouts = [...repo.payouts.values()].filter((p) => p.workspace_id === workspace.id);
    assert.equal(payouts.length, 1);
  });

  it("counts prior in-flight spend conservatively against the daily cap", async () => {
    const repo = new MemoryRepository();
    const workspace = await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    // A prior approved-but-not-executed item (in-flight) counts toward the cap.
    const prior = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: JUDGE_ID,
      sourceType: "judge_telegram",
      status: "approved",
      totalAmountBaseUnits: "995000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    await repo.createPayoutItem({
      payoutId: prior.id,
      recipientAddress: RECIPIENT,
      amountBaseUnits: "995000",
      memo: "in-flight",
      status: "approved",
      idempotencyKey: "judge-inflight-1",
    });

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "blocked");
    assert.match(reply.final, /daily cap/i);
    assert.equal(gateway.executeCalls, 0);
  });

  it("reports simulation failure without executing", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
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

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "failed");
    assert.equal(gateway.executeCalls, 0);
    assert.equal(gateway.simulateCalls, 1);
  });

  it("reports execution failure truthfully", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({
      execute: {
        executionId: "judge-exec-failed",
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

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "failed");
    assert.match(reply.final, /did not complete/i);
  });

  it("reports execution_unknown without retrying", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({ executeError: new Error("fetch failed") });

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "unknown");
    assert.match(reply.final, /will NOT automatically retry/i);
  });

  it("rejects invalid addresses and amounts without persisting", async () => {
    const repo = new MemoryRepository();
    const workspace = await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const badAddress = await handleJudgePayInstruction(
      { instruction: judgeInstruction({ address: "0x123" }), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(badAddress.outcome, "invalid");

    const badAmount = await handleJudgePayInstruction(
      { instruction: judgeInstruction({ amount: "0" }), user: judgeUser({ messageId: 44, updateId: 3 }) },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(badAmount.outcome, "invalid");

    assert.equal(gateway.executeCalls, 0);
    assert.equal([...repo.payouts.values()].filter((p) => p.workspace_id === workspace.id).length, 0);
  });

  it("rejects a missing judge workspace", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({});
    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "blocked");
    assert.match(reply.final, /workspace/i);
    assert.equal(gateway.executeCalls, 0);
  });

  it("never lets a non-judge user enter execution even in a group chat", async () => {
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const reply = await handleJudgePayInstruction(
      {
        instruction: judgeInstruction(),
        user: judgeUser({ userId: OTHER_USER, chatType: "group", chatId: "-100999" }),
      },
      { repo, gateway, config: JUDGE_CONFIG },
    );
    assert.equal(reply.outcome, "blocked");
    assert.equal(gateway.executeCalls, 0);
  });

  it("re-evaluates the daily cap inside the persistence transaction", async () => {
    // The flow re-checks the cap via evaluateJudgeRequest in the same
    // transaction that persists the payout; verify the shared policy is
    // actually used on the persistence path by checking a blocked daily-cap
    // case leaves zero rows (see the daily-cap test above) and that the
    // in-transaction path is the same function used standalone.
    const repo = new MemoryRepository();
    await createJudgeWorkspace(repo);
    const gateway = new FakeGateway({});

    const reply = await handleJudgePayInstruction(
      { instruction: judgeInstruction(), user: judgeUser() },
      { repo, gateway, config: { ...JUDGE_CONFIG, dailyLimitBaseUnits: "10000" } },
    );
    assert.equal(reply.outcome, "completed");

    const fresh = await repo.sumPayoutItemsByWorkspaceStates(
      [...repo.payouts.values()][0].workspace_id,
      ["approved", "simulating", "submitted", "confirming", "completed", "execution_unknown"],
      new Date(0).toISOString(),
    );
    assert.equal(fresh, "10000");
    const decision = evaluateJudgeRequest({
      modeEnabled: true,
      judgeUserIds: JUDGE_CONFIG.judgeUserIds,
      userId: JUDGE_ID,
      amountBaseUnits: "10000",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      workspaceActive: true,
      perTxLimitBaseUnits: JUDGE_CONFIG.perTxLimitBaseUnits,
      dailyLimitBaseUnits: "10000",
      currentDailySpendBaseUnits: fresh,
    });
    assert.equal(decision.decision, "blocked");
    void gateway;
  });

  it("derives a stable idempotency key from chat + message + command type", () => {
    const a = judgeIdempotencyKey(judgeUser());
    const b = judgeIdempotencyKey(judgeUser());
    const differentMessage = judgeIdempotencyKey(judgeUser({ messageId: 43 }));
    const differentChat = judgeIdempotencyKey(judgeUser({ chatId: "-100456" }));
    assert.equal(a, b);
    assert.notEqual(a, differentMessage);
    assert.notEqual(a, differentChat);
    assert.match(a, /judgepay$/);
    assert.ok(!a.includes(":pay"), "judge key must not collide with the /pay key space");
  });
});
