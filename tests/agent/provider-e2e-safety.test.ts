import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { formatAgentServiceResult } from "../../src/server/agent/messages.ts";
import { createIntentInterpreter } from "../../src/server/agent/providers/factory.ts";
import {
  runAgentOrchestration,
  type AgentServiceDeps,
  type AgentServiceResult,
} from "../../src/server/agent/service.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const API_KEY = "sk-solvo-test-0123456789abcdef";
const BASE_URL = "https://api.openai.com/v1";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT_ADDRESS = "0x742d35cc6634c0532925a3b844bc454e4438f44e";

const DANGEROUS_TOOL_NAMES = [
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

const AGENT_TOOL_NAMES_LIST = [
  "resolve_recipient",
  "inspect_payment_policy",
  "inspect_payment_status",
  "validate_claim_request",
  "prepare_payment",
];

type CapturedRequest = { url: string; init: RequestInit };

// ── Fixtures ────────────────────────────────────────────────────────────────

function agentInput(text: string, messageId = 1): AgentInput {
  return {
    surface: "telegram",
    chatId: "-100777",
    userId: "123456",
    messageId,
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
    candidates: {
      amounts: [],
      tokens: [],
      chains: [],
      addresses: [],
      aliases: [],
      payoutIds: [],
      claimAmounts: [],
    },
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
  await repo.addRecipient({
    workspaceId: workspace.id,
    alias: "daniel",
    walletAddress: RECIPIENT_ADDRESS,
    createdBy: "1",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  return { repo, workspace, member: await repo.getWorkspaceMember(workspace.id, "123456") };
}

function makeDeps(
  repo: MemoryRepository,
  handler: (request: CapturedRequest) => Response | Promise<Response>,
  envOverrides: Record<string, string> = {},
): { deps: AgentServiceDeps; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const config = getAgentConfig({
    SOLVO_AGENT_ENABLED: "true",
    SOLVO_AGENT_PROVIDER: "openai_compatible",
    SOLVO_AGENT_API_KEY: API_KEY,
    SOLVO_AGENT_MODEL: "gpt-4o-mini",
    SOLVO_AGENT_API_BASE_URL: BASE_URL,
    SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
    SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
    ...envOverrides,
  });
  const interpreter = createIntentInterpreter(config, {
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      const entry = { url: String(url), init: init ?? {} };
      captured.push(entry);
      return handler(entry);
    },
  });
  const deps: AgentServiceDeps = {
    repo,
    interpreter,
    config,
    appUrl: "https://solvo.example",
    now: () => new Date("2026-08-12T13:00:00.000Z"),
  };
  return { deps, captured };
}

// ── Provider mocks ─────────────────────────────────────────────────────────

function modelOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { intent: Record<string, unknown> } {
  return {
    intent: {
      action: "pay",
      amount: "0.01",
      currency: "USDC",
      recipient: { raw: "daniel", kind: "alias", address: null, alias: "daniel" },
      memo: null,
      missingFields: [],
    },
    intentKind: "prepare_payment",
    summary: "Send 0.01 USDC to daniel.",
    ...overrides,
  } as Record<string, unknown> & { intent: Record<string, unknown> };
}

function responsesBody(outputText: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    object: "response",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        content: [{ type: "output_text", text: outputText }],
      },
    ],
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// ── Safety assertions ──────────────────────────────────────────────────────

async function assertNoMoneyArtifacts(repo: MemoryRepository, messageId = 1): Promise<void> {
  assert.equal(await repo.getPayoutItemByIdempotencyKey(`ag:tg:-100777:m${messageId}:agent:prepare`), null);
  assert.equal(await repo.getClaimLinkByIdempotencyKey(`ag:tg:-100777:m${messageId}:agent:claim`), null);
  const types = repo.auditEvents.map((event) => event.event_type);
  assert.equal(types.includes("approval_granted"), false);
  assert.equal(types.some((type) => type.startsWith("simulation_")), false);
  assert.equal(types.some((type) => type.startsWith("execution_")), false);
  assert.equal(repo.executionAttempts.size, 0);
}

async function assertRunRowSafe(repo: MemoryRepository, messageId = 1): Promise<void> {
  const record = await repo.getAgentRunByIdempotencyKey(`tg:-100777:m${messageId}:agent`);
  assert.ok(record, "agent run row must exist");
  assert.equal("transaction_hash" in record, false);
  assert.equal("keeperhub_execution_id" in record, false);
  assert.equal(record.payout_id, null);
  assert.equal(record.claim_id, null);
}

function assertSafeReply(result: AgentServiceResult, hostilePayload: unknown): void {
  const formatted = formatAgentServiceResult(result);
  const text = formatted.text;
  assert.equal(text.includes(JSON.stringify(hostilePayload)), false, "reply must not contain raw model output");
  assert.equal(text.includes("output_text"), false);
  assert.equal(text.includes("responsesBody"), false);
}

/**
 * Runs one hostile provider scenario end-to-end and asserts the service
 * fails closed: safe outcome only, no money artifacts, no execution/approval
 * audits, no hash/execution id, and a reply free of raw model output.
 */
async function assertHostileScenario(
  text: string,
  handler: (request: CapturedRequest) => Response | Promise<Response>,
  expectedOutcomes: readonly string[],
  hostilePayload: unknown,
  envOverrides: Record<string, string> = {},
): Promise<void> {
  const { repo, workspace, member } = await makeFixture();
  const { deps } = makeDeps(repo, handler, envOverrides);
  const input = agentInput(text);
  const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
  assert.ok(expectedOutcomes.includes(result.outcome), `outcome ${result.outcome} not in ${expectedOutcomes.join(", ")}`);
  await assertNoMoneyArtifacts(repo);
  await assertRunRowSafe(repo);
  assertSafeReply(result, hostilePayload);
}

// ── Hostile cases ──────────────────────────────────────────────────────────

describe("provider E2E — hostile/malformed output fails closed", () => {
  it("1. invalid JSON fails closed", async () => {
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => new Response("not-json", { status: 200 }),
      ["failed"],
      "not-json",
    );
  });

  it("2. empty output fails closed", async () => {
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody("", { output: [] })),
      ["failed"],
      { output: [] },
    );
  });

  it("3. refusal fails closed", async () => {
    const body = {
      object: "response",
      output: [{ type: "message", id: "m", role: "assistant", content: [{ type: "refusal", refusal: "I cannot help with that." }] }],
    };
    await assertHostileScenario("send 0.01 USDC to daniel", () => jsonResponse(body), ["failed"], body);
  });

  it("4. unknown intent kind fails closed", async () => {
    const payload = modelOutput({ intentKind: "execute_payment" });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
  });

  it("5. execute_transfer action fails closed", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, action: "execute_transfer" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
  });

  it("6. call_keeperhub / direct_keeperhub_call fails closed", async () => {
    const payloadAction = modelOutput({ intent: { ...modelOutput().intent, action: "call_keeperhub" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadAction))),
      ["failed"],
      payloadAction,
    );
    const payloadPlan = modelOutput({ plan: { action: "direct_keeperhub_call" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadPlan))),
      ["failed"],
      payloadPlan,
    );
  });

  it("7. raw_sql / arbitrary_http_request fails closed", async () => {
    const payloadSql = modelOutput({ plan: { action: "raw_sql", query: "SELECT * FROM payouts" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadSql))),
      ["failed"],
      payloadSql,
    );
    const payloadHttp = modelOutput({ plan: { action: "arbitrary_http_request", url: "https://evil.example/drain" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadHttp))),
      ["failed"],
      payloadHttp,
    );
  });

  it("8. approve_payment / bypass_approval fails closed", async () => {
    const payloadApprove = modelOutput({ intent: { ...modelOutput().intent, action: "approve_payment" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadApprove))),
      ["failed"],
      payloadApprove,
    );
    const payloadBypass = modelOutput({ plan: { action: "prepare_payment", skipApproval: true } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadBypass))),
      ["failed"],
      payloadBypass,
    );
  });

  it("9. fake transaction hash fails closed", async () => {
    const hash = "0x" + "ab".repeat(32);
    const payload = modelOutput({ transactionHash: hash, completed: true });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
    const payloadIntent = modelOutput({ intent: { ...modelOutput().intent, transactionHash: hash } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadIntent))),
      ["failed"],
      payloadIntent,
    );
  });

  it("10. payment completed / funds moved claims fail closed", async () => {
    const payload = modelOutput({ completed: true, fundsMoved: true, status: "completed" });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
  });

  it("11. invented recipient not in extraction fails closed", async () => {
    const fabricatedAddress = "0x" + "deadbeef".repeat(5);
    const payload = modelOutput({
      intent: {
        ...modelOutput().intent,
        recipient: { raw: fabricatedAddress, kind: "address", address: fabricatedAddress, alias: null },
      },
    });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
    const payloadAlias = modelOutput({
      intent: { ...modelOutput().intent, recipient: { raw: "mallory", kind: "alias", address: null, alias: "mallory" } },
    });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadAlias))),
      ["failed"],
      payloadAlias,
    );
  });

  it("12. invented amount not in extraction fails closed", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, amount: "999" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
  });

  it("13. smuggled extra fields fail closed", async () => {
    const payload = modelOutput({ authority: "bypass", webhookUrl: "https://evil.example/hook", extra: { rawSql: true } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["failed"],
      payload,
    );
  });

  it("14. model cannot select AGENT_TOOLS by name", async () => {
    const payloadTools = modelOutput({ tools: [...AGENT_TOOL_NAMES_LIST, ...DANGEROUS_TOOL_NAMES] });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadTools))),
      ["failed"],
      payloadTools,
    );
    const payloadCall = modelOutput({ tool_call: { name: "execute_approved_payment", arguments: "{}" } });
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadCall))),
      ["failed"],
      payloadCall,
    );
  });

  it("15. valid-looking intent with an unsupported token is blocked", async () => {
    // The intent itself passes the local schema (currency null), but the
    // deterministic planner blocks on the invalid token candidate.
    const payload = modelOutput({ intent: { ...modelOutput().intent, currency: null } });
    await assertHostileScenario(
      "pay 0.01 ETH to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["blocked", "unsupported"],
      payload,
    );
    const payloadCurrency = modelOutput({ intent: { ...modelOutput().intent, currency: "ETH" } });
    await assertHostileScenario(
      "pay 0.01 ETH to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payloadCurrency))),
      ["failed"],
      payloadCurrency,
    );
  });

  it("16. valid-looking intent with an unsupported chain is blocked", async () => {
    const payload = modelOutput();
    await assertHostileScenario(
      "send 0.01 USDC to daniel on Celo",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      ["blocked", "unsupported"],
      payload,
    );
  });

  it("17. provider timeout fails closed", async () => {
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => new Promise<Response>(() => {}),
      ["failed"],
      "timeout",
      { SOLVO_AGENT_TIMEOUT_MS: "500" },
    );
  });

  it("18. provider 500 fails closed", async () => {
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: "boom" }, 500),
      ["failed"],
      { error: "boom" },
    );
  });

  it("19. provider 401 fails closed", async () => {
    await assertHostileScenario(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: "unauthorized" }, 401),
      ["failed"],
      { error: "unauthorized" },
    );
  });

  it("20. secret-shaped model output fails closed and leaves no secret in records", async () => {
    const secret = "sk-evilsecretvalue123456";
    const payload = modelOutput({ summary: `Done. ${secret}` });
    const { repo, workspace, member } = await makeFixture();
    const { deps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(payload))));
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "failed");
    await assertNoMoneyArtifacts(repo);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    assert.equal(record.status, "failed");
    assert.equal(record.error_code, "interpreter_error");
    assert.equal(record.raw_text_redacted?.includes(secret), false);
    assert.equal(record.error_message_redacted?.includes(secret), false);
    assert.equal(record.interpretation_json, null, "hostile interpretation must never be persisted");
    assertSafeReply(result, payload);
  });

  it("all hostile cases leave interpretation_json null (nothing persisted)", async () => {
    const { repo, workspace, member } = await makeFixture();
    const payload = modelOutput({ intent: { ...modelOutput().intent, action: "execute_transfer" } });
    const { deps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(payload))));
    const input = agentInput("send 0.01 USDC to daniel");
    await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    assert.equal(record.interpretation_json, null);
    assert.equal(record.decision_json, null);
  });
});

describe("provider E2E — positive controls", () => {
  it("1. valid openai-compatible payment interpretation creates a pending-approval payout", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { deps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "prepared_payment");
    if (result.outcome === "prepared_payment") {
      const payout = await repo.getPayoutById(result.prepared.payoutId);
      assert.equal(payout?.status, "pending_approval");
      assert.equal(payout?.approved_at, null);
      assert.equal(payout?.completed_at, null);
    }
    const types = repo.auditEvents.map((event) => event.event_type);
    assert.equal(types.includes("approval_required"), true);
    assert.equal(types.includes("approval_granted"), false);
    assert.equal(types.some((type) => type.startsWith("simulation_")), false);
    assert.equal(types.some((type) => type.startsWith("execution_")), false);
    assert.equal(repo.executionAttempts.size, 0);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record?.payout_id);
    assert.equal("transaction_hash" in record, false);
  });

  it("2. valid claim-link interpretation creates a claim link and nothing else", async () => {
    const { repo, workspace, member } = await makeFixture();
    const payload = modelOutput({
      intent: { action: "claim_pay", amount: "0.05", currency: "USDC", recipient: null, memo: null, missingFields: [] },
      intentKind: "create_claim_link",
      summary: "Create a claim link for 0.05 USDC.",
    });
    const { deps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(payload))));
    const input = agentInput("create a claim link for 0.05 USDC");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "claim_link_created");
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
    assert.equal(repo.executionAttempts.size, 0);
    const claim = await repo.getClaimLinkByIdempotencyKey("ag:tg:-100777:m1:agent:claim");
    assert.ok(claim);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.equal(record?.claim_id, claim.id);
    assert.equal("transaction_hash" in (record as Record<string, unknown>), false);
  });

  it("3. valid status interpretation reads truth from the payout row", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { deps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const prepared = await runAgentOrchestration(
      { agentInput: agentInput("send 0.01 USDC to daniel", 1), workspace, member },
      deps,
    );
    assert.equal(prepared.outcome, "prepared_payment");
    const payoutId = prepared.outcome === "prepared_payment" ? prepared.prepared.payoutId : "";
    const statusPayload = modelOutput({
      intent: { action: "status", amount: null, currency: null, recipient: null, memo: null, missingFields: [] },
      intentKind: "inspect_payment_status",
      summary: "Check payment status.",
    });
    const { deps: statusDeps } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(statusPayload))));
    const status = await runAgentOrchestration(
      { agentInput: agentInput(`check status ${payoutId}`, 2), workspace, member },
      statusDeps,
    );
    assert.equal(status.outcome, "status_visible");
    if (status.outcome === "status_visible") {
      assert.equal(status.status.payoutId, payoutId);
      assert.equal(status.status.state, "pending_approval");
      assert.equal(status.status.completedAt, null);
    }
    assert.equal(repo.executionAttempts.size, 0);
  });
});

describe("provider E2E — request and source boundaries", () => {
  it("sends no AGENT_TOOLS or dangerous tool names in the provider request body", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { deps, captured } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput("send 0.01 USDC to daniel");
    await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(captured.length, 1);
    const body = captured[0].init.body as string;
    assert.equal(body.includes("resolve_recipient"), false);
    assert.equal(body.includes("validate_claim_request"), false);
    assert.equal(body.includes("inspect_payment_policy"), false);
    assert.equal(body.includes("execute_approved_payment"), false);
    for (const name of DANGEROUS_TOOL_NAMES) {
      assert.equal(body.includes(name), false, `request body mentions ${name}`);
    }
  });

  it("puts the API key only in the Authorization header and nothing secret in the body", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { deps, captured } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput("send 0.01 USDC to daniel");
    await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    const entry = captured[0];
    const headers = entry.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(headers["Content-Type"], "application/json");
    const body = entry.init.body as string;
    for (const secret of [
      API_KEY,
      "postgres://",
      "DATABASE_URL",
      "KEEPERHUB",
      "kh_",
      "TELEGRAM_BOT_TOKEN",
      "SOLVO_AGENT_API_KEY",
      "process.env",
    ]) {
      assert.equal(body.includes(secret), false, `request body leaks ${secret}`);
    }
    assert.equal(JSON.stringify(headers).includes("Bearer") && headers.Authorization === `Bearer ${API_KEY}`, true);
  });

  it("the provider E2E path imports no execution/KeeperHub/Telegram/webhook/judge/SQL/AI-SDK modules", () => {
    for (const file of [
      "src/server/agent/openai-compatible-interpreter.ts",
      "src/server/agent/providers/factory.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      const imports = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import"))
        .join("\n");
      for (const banned of [
        "execution-service",
        "keeperhub",
        "mcp-client",
        "telegram",
        "webhook",
        "judge",
        "sql",
        "postgres",
        "openai",
        "anthropic",
        "ai-sdk",
        "node:http",
      ]) {
        assert.equal(imports.includes(banned), false, `${file} imports ${banned}`);
      }
    }
  });

  it("the provider never receives an env dump or raw conversation storage in the prompt", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { deps, captured } = makeDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput("send 0.01 USDC to daniel");
    await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    const body = captured[0].init.body as string;
    const messages = JSON.parse(body).input as Array<{ role: string; content: string }>;
    const prompt = messages.map((message) => message.content).join("\n");
    assert.equal(prompt.includes("SOLVO_AGENT_API_KEY"), false);
    assert.equal(prompt.includes("process.env"), false);
    assert.equal(prompt.includes("apiKey"), false);
    assert.equal(prompt.includes("DATABASE_URL"), false);
    assert.equal(prompt.includes("bearer"), false);
  });
});
