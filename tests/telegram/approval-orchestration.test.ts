import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import { handleApprovalCallbackUpdate, type ApprovalMessenger } from "../../src/server/telegram/flows/approval-orchestration.ts";
import { handleCommunityPayInstruction } from "../../src/server/telegram/flows/community-pay-flow.ts";
import { handleMemberAdd } from "../../src/server/telegram/flows/member-flow.ts";
import { handleWorkspaceInit } from "../../src/server/telegram/flows/workspace-flow.ts";
import { handleApprovalCallback } from "../../src/server/telegram/flows/approval-flow.ts";
import type { KeeperHubExecutionGateway } from "../../src/server/execution/execution-service.ts";
import type { SolvoDirectExecutionStatus, SolvoSimulationResult } from "../../src/server/keeperhub/types.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway, SIM_OK, completedStatus, TX_HASH } from "../execution/fixtures.ts";

const OWNER = "100000001";
const APPROVER = "100000002";
const MEMBER = "100000003";
const CHAT = "-1001234567890";
const ADDRESS = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const DEV_OPERATORS = new Set([OWNER]);

function groupUser(userId: string, messageId = 1): TelegramUser {
  return { userId, chatId: CHAT, chatType: "supergroup", messageId, updateId: 1000 + messageId };
}

type CallRecord = { kind: "answer" | "edit" | "reply"; text: string; at: number };

function makeMessenger(records: CallRecord[], failures: { answer?: Error; edit?: Error; reply?: Error } = {}): ApprovalMessenger {
  return {
    answer: async (text) => {
      records.push({ kind: "answer", text, at: Date.now() });
      if (failures.answer) throw failures.answer;
    },
    edit: async (text) => {
      records.push({ kind: "edit", text, at: Date.now() });
      if (failures.edit) throw failures.edit;
    },
    reply: async (text) => {
      records.push({ kind: "reply", text, at: Date.now() });
      if (failures.reply) throw failures.reply;
    },
  };
}

/** Gateway whose KeeperHub calls are delayed, simulating a slow real execution. */
class DelayedGateway implements KeeperHubExecutionGateway {
  readonly inner: FakeGateway;
  readonly delayMs: number;
  simulateCalls = 0;
  executeCalls = 0;

  constructor(inner: FakeGateway, delayMs: number) {
    this.inner = inner;
    this.delayMs = delayMs;
  }

  private async slow(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  async simulateTransfer(): Promise<SolvoSimulationResult> {
    this.simulateCalls += 1;
    await this.slow();
    return SIM_OK;
  }

  async executeTransfer(): Promise<SolvoDirectExecutionStatus> {
    this.executeCalls += 1;
    await this.slow();
    return completedStatus("delayed_execution");
  }

  async getDirectExecutionStatus(): Promise<SolvoDirectExecutionStatus> {
    await this.slow();
    return completedStatus("delayed_execution");
  }

  async pollUntilTerminal(): Promise<SolvoDirectExecutionStatus> {
    await this.slow();
    return completedStatus("delayed_execution");
  }
}

async function seedCommunity(repo: SolvoRepository): Promise<string> {
  const init = await handleWorkspaceInit(
    { user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS },
    { repo },
  );
  assert.equal(init.outcome, "created");
  await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
  await handleMemberAdd({ user: groupUser(OWNER, 3), targetUserId: MEMBER, role: "member" }, { repo });
  const request = await handleCommunityPayInstruction(
    {
      instruction: {
        kind: "pay",
        address: ADDRESS,
        amount: "0.01",
        token: "USDC",
        sourceType: "telegram_command",
      },
      user: groupUser(MEMBER, 4),
    },
    { repo },
  );
  assert.ok(request.buttons);
  const match = /^solvo:(?:approve|reject):([0-9a-f-]{36})$/.exec(request.buttons[0].callbackData);
  assert.ok(match);
  return match[1];
}

describe("approval callback orchestration ordering", () => {
  it("acknowledges the callback before a delayed KeeperHub execution resolves", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const records: CallRecord[] = [];
    const gateway = new DelayedGateway(new FakeGateway({}), 150);

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      makeMessenger(records),
    );

    const answerIndex = records.findIndex((record) => record.kind === "answer");
    const editIndex = records.findIndex((record) => record.kind === "edit");
    assert.ok(answerIndex >= 0, "callback was acknowledged");
    assert.ok(editIndex > answerIndex, "final message came after the acknowledgement");
    assert.equal(gateway.executeCalls, 1);
  });

  it("slow KeeperHub execution does not delay the callback acknowledgement", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const records: CallRecord[] = [];
    const gateway = new DelayedGateway(new FakeGateway({}), 200);

    const started = Date.now();
    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      makeMessenger(records),
    );
    const totalMs = Date.now() - started;

    const answer = records.find((record) => record.kind === "answer");
    assert.ok(answer);
    assert.ok(answer.at - started < 150, "acknowledgement happened well before the 200ms execution finished");
    assert.ok(totalMs >= 400, "execution still completed (two 200ms delays)");
    assert.equal(gateway.executeCalls, 1);
  });

  it("a failed answerCallbackQuery does not cause duplicate execution", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const records: CallRecord[] = [];
    const gateway = new FakeGateway({});
    const messenger = makeMessenger(records, { answer: new Error("query is too old and response timeout expired") });

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
    );

    assert.equal(gateway.executeCalls, 1);
    const item = (await repo.getPayoutItemsByPayoutId(payoutId))[0];
    assert.equal(item?.status, "completed");
    assert.equal(item?.transaction_hash, TX_HASH);
  });

  it("a Telegram message-edit failure falls back to a reply and never alters the completed state", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const records: CallRecord[] = [];
    const gateway = new FakeGateway({});
    const messenger = makeMessenger(records, { edit: new Error("message is not modified") });

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
    );

    const replied = records.find((record) => record.kind === "reply");
    assert.ok(replied, "fell back to sending a new message");
    assert.match(replied.text, /Payment completed/);
    const item = (await repo.getPayoutItemsByPayoutId(payoutId))[0];
    assert.equal(item?.status, "completed");
  });

  it("callback acknowledgement failure does not crash the orchestration", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const errors: unknown[] = [];
    const gateway = new FakeGateway({});
    const messenger = makeMessenger(
      [],
      { answer: new Error("query is too old and response timeout expired or query ID is invalid") },
    );

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      messenger,
      (error) => {
        errors.push(error);
      },
    );

    assert.equal(errors.length, 1, "the ack failure was reported to the sanitized logger");
    assert.equal(gateway.executeCalls, 1);
    const item = (await repo.getPayoutItemsByPayoutId(payoutId))[0];
    assert.equal(item?.status, "completed");
  });

  it("unauthorized clicks are answered with the specific message and never execute", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const records: CallRecord[] = [];
    const gateway = new FakeGateway({});

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: MEMBER, chatId: CHAT },
      { repo, gateway },
      makeMessenger(records),
    );

    const answer = records.find((record) => record.kind === "answer");
    assert.ok(answer);
    assert.equal(answer.text, "You are not authorized to approve this request.");
    assert.equal(gateway.executeCalls, 0);
  });

  it("self-approval clicks get the treasury approver message and never execute", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
    const request = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay",
          address: ADDRESS,
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_command",
        },
        user: groupUser(APPROVER, 3),
      },
      { repo },
    );
    assert.ok(request.buttons);
    const payoutId = /^solvo:(?:approve|reject):([0-9a-f-]{36})$/.exec(request.buttons[0].callbackData)?.[1] ?? "";
    const records: CallRecord[] = [];
    const gateway = new FakeGateway({});

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
      makeMessenger(records),
    );

    const answer = records.find((record) => record.kind === "answer");
    assert.equal(answer?.text, "A different treasury approver must approve this request.");
    assert.equal(gateway.executeCalls, 0);
  });

  it("duplicate approval remains one execution", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    const second = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(second.answer, "This request has already been handled.");
    assert.equal(gateway.executeCalls, 1);
  });

  it("concurrent approvals remain one execution", async () => {
    const repo = new MemoryRepository();
    const payoutId = await seedCommunity(repo);
    const gateway = new FakeGateway({});
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
    assert.equal(gateway.executeCalls, 1);
  });
});
