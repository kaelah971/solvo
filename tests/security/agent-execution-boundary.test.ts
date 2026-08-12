import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { extractCandidates } from "../../src/server/agent/extraction.ts";
import { runAgentOrchestration, type AgentServiceDeps } from "../../src/server/agent/service.ts";
import { StaticIntentInterpreter } from "../../src/server/agent/static-interpreter.ts";
import { AGENT_TOOL_NAMES, getAgentTool, validateAgentToolCall } from "../../src/server/agent/tools.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const FORBIDDEN_TOOLS = [
  "execute_transfer",
  "execute_approved_payment",
  "call_keeperhub",
  "direct_keeperhub_call",
  "raw_sql",
  "arbitrary_http_request",
  "set_webhook",
  "approve_payment",
  "bypass_approval",
  "mark_successful",
  "fake_transaction_hash",
];

const AGENT_SOURCE_FILES = [
  "src/server/agent/schema.ts",
  "src/server/agent/extraction.ts",
  "src/server/agent/interpreter.ts",
  "src/server/agent/static-interpreter.ts",
  "src/server/agent/config.ts",
  "src/server/agent/tools.ts",
  "src/server/agent/planner.ts",
  "src/server/agent/service.ts",
  "src/server/agent/redact.ts",
  "src/server/agent/messages.ts",
  "src/server/agent/bridges/prepare-payment.ts",
  "src/server/agent/bridges/create-claim-link.ts",
  "src/server/agent/bridges/status-result.ts",
  "src/server/telegram/flows/agent-flow.ts",
];

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

async function makeFixture(mode: "community" | "sandbox" | "judge" = "community") {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
    mode,
    name: "Test WS",
    telegramChatId: mode === "community" ? "-100777" : null,
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: mode === "judge" ? "auto_approve_within_judge_policy" : "approval_required",
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

describe("agent execution authority boundary", () => {
  it("no agent source file imports execution, KeeperHub, judge, webhook, model, or HTTP modules", () => {
    const forbidden = [
      "execution-service",
      "keeperhub",
      "mcp-client",
      "judge",
      "webhook-admin",
      "openai",
      "anthropic",
      "ai-sdk",
      "node:http",
    ];
    for (const file of AGENT_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      const imports = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import"))
        .join("\n");
      for (const banned of forbidden) {
        assert.equal(imports.includes(banned), false, `${file} imports ${banned}`);
      }
      assert.equal(/fetch\(/.test(source), false, `${file} calls fetch`);
    }
  });

  it("the tool registry rejects every forbidden tool name", () => {
    for (const tool of FORBIDDEN_TOOLS) {
      assert.equal(getAgentTool(tool), null, tool);
      assert.equal(validateAgentToolCall(tool, {}).ok, false, tool);
    }
  });

  it("the registry contains only the four safe, non-mutating tools", () => {
    assert.deepEqual([...AGENT_TOOL_NAMES].sort(), [
      "inspect_payment_policy",
      "inspect_payment_status",
      "resolve_recipient",
      "validate_claim_request",
    ]);
  });

  it("the agent payment path never grants approval or starts simulation/execution", async () => {
    const { repo } = await makeFixture();
    const result = await run("send 0.01 USDC to daniel", depsFor(repo));
    assert.equal(result.outcome, "prepared_payment");
    const types = repo.auditEvents.map((event) => event.event_type);
    assert.equal(types.includes("approval_granted"), false);
    assert.equal(types.includes("approval_required"), true);
    assert.equal(types.some((type) => type.startsWith("simulation_")), false);
    assert.equal(types.some((type) => type.startsWith("execution_")), false);
  });

  it("the agent path creates no execution attempts and leaves the payout pending approval", async () => {
    const { repo } = await makeFixture();
    const result = await run("send 0.01 USDC to daniel", depsFor(repo));
    assert.equal(result.outcome, "prepared_payment");
    assert.equal(repo.executionAttempts.size, 0);
    if (result.outcome === "prepared_payment") {
      const payout = await repo.getPayoutById(result.prepared.payoutId);
      assert.equal(payout?.status, "pending_approval");
      assert.equal(payout?.approved_at, null);
    }
  });

  it("sandbox contexts create no real payout", async () => {
    const { repo } = await makeFixture("sandbox");
    const result = await run("send 0.01 USDC to daniel", depsFor(repo));
    assert.equal(result.outcome, "blocked");
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
  });

  it("judge contexts create no payout and no judge execution artifacts", async () => {
    const { repo } = await makeFixture("judge");
    const result = await run("send 0.01 USDC to daniel", depsFor(repo));
    assert.equal(result.outcome, "blocked");
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
    assert.equal(repo.executionAttempts.size, 0);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m1:judgepay"), null);
  });

  it("approval callbacks remain the only approval authority", async () => {
    const { repo } = await makeFixture();
    await run("send 0.01 USDC to daniel", depsFor(repo));
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record?.payout_id);
    const payout = await repo.getPayoutById(record.payout_id);
    assert.equal(payout?.status, "pending_approval");
    // The only actor that may approve is the existing callback path; the
    // agent layer contains no approve capability (asserted by registry and
    // import contracts above).
    assert.equal(repo.auditEvents.some((e) => e.event_type === "approval_granted"), false);
  });
});
