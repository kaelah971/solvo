import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { extractCandidates } from "../../src/server/agent/extraction.ts";
import { runAgentOrchestration, type AgentServiceDeps } from "../../src/server/agent/service.ts";
import { StaticIntentInterpreter } from "../../src/server/agent/static-interpreter.ts";
import { isAgentRunStatus, AGENT_RUN_STATUSES } from "../../src/server/agent/types.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function agentInput(text: string): AgentInput {
  return {
    surface: "telegram",
    chatId: "-100777",
    userId: "123456",
    messageId: 1,
    rawText: text,
    timestampIso: "2026-08-12T13:00:00.000Z",
    workspace: {
      id: "ws-1",
      mode: "community",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
      aliases: ["daniel"],
      perTransactionLimitUsdc: "1.00",
      dailyLimitUsdc: "10.00",
      workspaceActive: true,
    },
    flags: { workspaceMode: "community", isMember: true },
    candidates: extractCandidates(text, ["daniel"]).candidates,
  };
}

async function makeFixture() {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: "Test WS",
    telegramChatId: "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e", createdBy: "1" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  const member = (await repo.getWorkspaceMember(workspace.id, "123456"));
  return { repo, workspace, member };
}

function depsFor(repo: MemoryRepository): AgentServiceDeps {
  return {
    repo,
    interpreter: new StaticIntentInterpreter(),
    config: getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    }),
    appUrl: "https://solvo.example",
    now: () => new Date("2026-08-12T13:00:00.000Z"),
  };
}

async function run(text: string, deps: AgentServiceDeps) {
  const input = agentInput(text);
  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.chatId);
  const member = workspace ? await deps.repo.getWorkspaceMember(workspace.id, input.userId) : null;
  return runAgentOrchestration({ agentInput: input, workspace, member }, deps);
}

describe("agent runs are not payment truth", () => {
  it("a prepared agent run does not imply a completed payout", async () => {
    const { repo } = await makeFixture();
    const result = await run("send 0.01 USDC to daniel", depsFor(repo));
    assert.equal(result.outcome, "prepared_payment");
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    assert.equal(record.status, "prepared");
    assert.ok(record.payout_id);
    const payout = await repo.getPayoutById(record.payout_id);
    assert.equal(payout?.status, "pending_approval");
    assert.notEqual(record.status, payout?.status);
  });

  it("payout truth advances independently of the agent run", async () => {
    const { repo } = await makeFixture();
    await run("send 0.01 USDC to daniel", depsFor(repo));
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record?.payout_id);
    const items = await repo.getPayoutItemsByPayoutId(record.payout_id);
    assert.equal(items.length, 1);
    const item = items[0];

    // Money truth moves through the existing payout pipeline only.
    await repo.transitionPayoutItemState(item.id, ["pending_approval"], "approved");
    await repo.completePayoutItem(item.id, "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", "https://basescan.org/tx/x");

    const refreshed = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.equal(refreshed?.status, "prepared");
    assert.equal("transaction_hash" in refreshed, false);
    const completed = await repo.getPayoutItemForExecution(item.id);
    assert.equal(completed?.item.transaction_hash, "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });

  it("agent_run statuses never include payout or claim machine states", () => {
    const moneyStates = [
      "approved",
      "pending_approval",
      "simulating",
      "submitted",
      "confirming",
      "completed",
      "execution_failed",
      "execution_unknown",
      "claimed",
      "executed",
      "cancelled",
    ];
    for (const state of moneyStates) {
      assert.equal(isAgentRunStatus(state), false, state);
    }
    for (const state of AGENT_RUN_STATUSES) {
      assert.equal(moneyStates.includes(state), false, state);
    }
  });

  it("agent runs cannot be moved into fabricated completion states", async () => {
    const { repo } = await makeFixture();
    await run("send 0.01 USDC to daniel", depsFor(repo));
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    for (const state of ["completed", "executed", "approved"]) {
      await assert.rejects(
        () => repo.updateAgentRun(record.id, { status: state as never }),
        /invalid agent run status/,
        state,
      );
    }
  });

  it("the agent_runs schema stores no transaction hash or execution id", () => {
    const migration = readFileSync("migrations/0012_agent_runs.sql", "utf8");
    assert.equal(migration.includes("keeperhub_execution_id"), false);
    assert.equal(migration.includes("transaction_hash"), false);
    assert.equal(migration.includes("execution_id"), false);
  });

  it("the agent layer never reads completion truth from agent runs", async () => {
    const { repo } = await makeFixture();
    await run("send 0.01 USDC to daniel", depsFor(repo));
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record?.payout_id);
    // The status path reads the payout row, not the run row.
    const payout = await repo.getPayoutById(record.payout_id);
    assert.ok(payout);
    assert.equal(payout.status, "pending_approval");
    // A maliciously crafted run field cannot affect payout rows.
    await repo.updateAgentRun(record.id, { decisionJson: { status: "completed", transactionHash: "0xfake" } });
    const after = await repo.getPayoutById(record.payout_id);
    assert.equal(after?.status, "pending_approval");
  });
});
