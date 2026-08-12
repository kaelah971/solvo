import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { AGENT_BATCH_PHRASES } from "../fixtures/agent-batch-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const BANNED_INTERNAL = [
  "tool",
  "planner",
  "candidate",
  "schema",
  "llm",
  "model",
  "interpreter",
  "extraction",
  "agent_run",
  "json",
  "raw",
  "provider",
  "stack",
  "trace",
  "typeerror",
  "sql",
  "execution service",
  "resolve_recipient",
  "prepare_batch_payment",
  "intentKind",
  "decisionJson",
  "keeperhub_execution_id",
  "transactionHash",
];

function assertSafeReply(reply: { text: string } | null, label: string): void {
  assert.ok(reply, `${label}: expected a reply`);
  for (const banned of BANNED_INTERNAL) {
    assert.equal(reply.text.toLowerCase().includes(banned.toLowerCase()), false, `${label}: contains ${banned}`);
  }
  assert.equal(reply.text.includes("{"), false, `${label}: looks like raw JSON`);
  assert.equal(/(0x[0-9a-fA-F]{64})/.test(reply.text), false, `${label}: contains a tx-hash-shaped string`);
}

function user(messageId = 1): TelegramUser {
  return { userId: "123456", chatId: "-100777", chatType: "supergroup", messageId, updateId: 1 };
}

async function makeFixture(overrides: { mode?: "community" | "judge"; chatId?: string } = {}) {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
    mode: overrides.mode ?? "community",
    name: "Test WS",
    telegramChatId: overrides.chatId ?? "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e", createdBy: "1" });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "blossom", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", createdBy: "1" });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "endurance", walletAddress: "0x234567890abcdef1234567890abcdef123456789", createdBy: "1" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  return { repo, workspace };
}

function depsFor(repo: MemoryRepository, overrides: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    repo,
    config: getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    }),
    appUrl: "https://solvo.example",
    now: () => new Date("2026-08-12T13:00:00.000Z"),
    ...overrides,
  };
}

async function assertNoExecution(repo: MemoryRepository): Promise<void> {
  assert.equal(repo.executionAttempts.size, 0);
  const types = repo.auditEvents.map((event) => event.event_type);
  assert.equal(types.includes("approval_granted"), false);
  assert.equal(types.some((type) => type.startsWith("simulation_")), false);
  assert.equal(types.some((type) => type.startsWith("execution_")), false);
  const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
  if (run) {
    assert.equal("transaction_hash" in run, false);
    assert.equal("keeperhub_execution_id" in run, false);
  }
}

describe("M10.5 batch grammar — Telegram routing", () => {
  it("valid batch phrases persist one pending_approval payout + N items; everything else stays artifact-free", async () => {
    let checked = 0;
    let prepared = 0;
    for (const phrase of AGENT_BATCH_PHRASES) {
      const { repo, workspace } = await makeFixture();
      const reply = await handleAgentGroupText({ user: user(), text: phrase.phrase }, depsFor(repo));
      assert.ok(reply, `${phrase.id}: expected a reply`);
      if (phrase.expectation === "prepared_batch") {
        assert.match(reply.text, /BATCH PAYMENT REQUEST PREPARED/i, phrase.id);
        assert.match(reply.text, /PAYOUT ID/i, phrase.id);
        assert.match(reply.text, /approval required/i, phrase.id);
        assert.match(reply.text, /no funds have moved/i, phrase.id);
        assert.match(reply.text, /RECIPIENTS/i, phrase.id);
        assert.match(reply.text, /TOTAL/i, phrase.id);
        assert.equal(reply.buttons?.length, 2, phrase.id);
        assert.equal(reply.buttons?.[0].text, "APPROVE BATCH", phrase.id);
        assert.equal(reply.buttons?.[1].text, "REJECT", phrase.id);
        const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
        assert.ok(run?.payout_id, `${phrase.id}: run must link a payout`);
        assert.ok(reply.text.includes(run.payout_id), `${phrase.id}: reply shows the payout id`);
        const payout = await repo.getPayoutById(run.payout_id);
        assert.equal(payout?.status, "pending_approval", phrase.id);
        assert.equal(payout?.approved_at, null, phrase.id);
        assert.equal(payout?.completed_at, null, phrase.id);
        const items = await repo.getPayoutItemsByPayoutId(run.payout_id);
        assert.equal(items.length >= 2, true, `${phrase.id}: at least two items`);
        assert.equal(items.every((item) => item.status === "pending_approval"), true, phrase.id);
        for (const item of items) {
          assert.match(reply.text, new RegExp(item.memo ?? item.recipient_address.slice(0, 10), "i"), `${phrase.id}: reply lists ${item.memo}`);
        }
        prepared += 1;
      } else {
        assert.match(reply.text, /couldn't safely|blocked|one more detail/i, phrase.id);
        assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:batch:0"), null, `${phrase.id}: no batch item`);
        assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, `${phrase.id}: no single payment item`);
      }
      assertSafeReply(reply, phrase.id);
      assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, `${phrase.id}: no claim`);
      await assertNoExecution(repo);
      checked += 1;
    }
    assert.ok(checked >= 50, `expected at least 50 routing checks, got ${checked}`);
    assert.ok(prepared >= 18, `expected at least 18 persisted batch phrases, got ${prepared}`);
  });

  it("duplicate delivery returns ALREADY PREPARED with the same payout and no duplicate artifacts", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const first = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.ok(first);
    assert.match(first.text, /BATCH PAYMENT REQUEST PREPARED/i);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    const payoutId = run.payout_id;
    const itemsAfterFirst = await repo.getPayoutItemsByPayoutId(payoutId);
    const requestAuditsAfterFirst = repo.auditEvents.filter(
      (event) => event.payout_id === payoutId && event.event_type === "request_created",
    ).length;

    const second = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.ok(second);
    assert.match(second.text, /BATCH PAYMENT REQUEST ALREADY PREPARED/i);
    assert.ok(second.text.includes(payoutId), "duplicate reply shows the same payout id");
    assert.match(second.text, /PENDING_APPROVAL/i);
    assert.match(second.text, /no duplicate batch was created/i);
    assert.match(second.text, /no funds have moved/i);
    assert.equal(second.buttons, undefined, "duplicate reply carries no buttons");
    assert.equal((await repo.getPayoutItemsByPayoutId(payoutId)).length, itemsAfterFirst.length);
    const requestAuditsAfterSecond = repo.auditEvents.filter(
      (event) => event.payout_id === payoutId && event.event_type === "request_created",
    ).length;
    const approvalAuditsAfterSecond = repo.auditEvents.filter(
      (event) => event.payout_id === payoutId && event.event_type === "approval_required",
    ).length;
    assert.equal(requestAuditsAfterSecond, requestAuditsAfterFirst);
    assert.equal(approvalAuditsAfterSecond, 1);
    assert.equal((await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"))?.payout_id, payoutId);
    await assertNoExecution(repo);
  });

  it("duplicate delivery after the payout state changed reads the current state truthfully", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const first = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.ok(first);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    await repo.transitionPayoutState(run.payout_id, ["pending_approval"], "approved");

    const second = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.ok(second);
    assert.match(second.text, /BATCH PAYMENT REQUEST ALREADY PREPARED/i);
    assert.match(second.text, /APPROVED/i);
    assert.match(second.text, /currently approved/i);
    assert.equal(/no funds have moved/i.test(second.text), false, "must not claim pending facts after approval");
    assert.equal(second.buttons, undefined);
    await assertNoExecution(repo);
  });

  it("private/DM batch messages stay inert with zero artifacts", async () => {
    const { repo } = await makeFixture();
    const reply = await handleAgentGroupText(
      { user: { userId: "123456", chatId: "999999999", chatType: "supergroup", messageId: 1, updateId: 1 }, text: "pay blossom and endurance 0.01 USDC each" },
      depsFor(repo),
    );
    assert.equal(reply, null);
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:999999999:m1:agent"), null);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:batch:0"), null);
  });

  it("status of a prepared batch reads the payout row, not the agent run", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const prepared = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.ok(prepared);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    const status = await handleAgentGroupText(
      { user: user(2), text: `check status ${run.payout_id}` },
      deps,
    );
    assert.ok(status);
    assert.match(status.text, /pending_approval/i);
    assert.match(status.text, /waiting for approval/i);
    assert.equal(status.text.includes("prepared_batch_payment"), false, "status never leaks internal decision types");
    await assertNoExecution(repo);
  });

  it("disabled mode stays inert for batch phrases", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo, { config: getAgentConfig({}) });
    const reply = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      deps,
    );
    assert.equal(reply, null);
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"), null);
  });

  it("slash commands still bypass the agent flow", async () => {
    const { repo } = await makeFixture();
    for (const command of ["/pay 0x742d35cc6634c0532925a3b844bc454e4438f44e 0.01 USDC", "/batch blossom 0.01 USDC", "/claimpay 0.05 USDC", "/judgepay 0x742d35cc6634c0532925a3b844bc454e4438f44e 0.01 USDC"]) {
      const reply = await handleAgentGroupText({ user: user(), text: command }, depsFor(repo));
      assert.equal(reply, null, command);
    }
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"), null);
  });

  it("judge-like batch phrases never trigger Judge Mode", async () => {
    const { repo } = await makeFixture();
    for (const phrase of AGENT_BATCH_PHRASES) {
      if (phrase.category !== "judge_confusion") continue;
      const reply = await handleAgentGroupText({ user: user(), text: phrase.phrase }, depsFor(repo));
      assert.ok(reply, phrase.id);
      assert.equal(reply.text.includes("judgepay"), false, phrase.id);
      assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m1:judgepay"), null, phrase.id);
    }
  });

  it("judge-mode chats stay out of the agent flow entirely", async () => {
    const { repo } = await makeFixture({ mode: "judge" });
    const reply = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each" },
      depsFor(repo),
    );
    assert.equal(reply, null);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m1:judgepay"), null);
  });
});
