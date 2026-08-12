import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { formatAgentServiceResult } from "../../src/server/agent/messages.ts";
import { createIntentInterpreter } from "../../src/server/agent/providers/factory.ts";
import {
  defaultAgentDeps,
  runAgentOrchestration,
  type AgentServiceDeps,
  type AgentServiceResult,
} from "../../src/server/agent/service.ts";
import { StaticIntentInterpreter } from "../../src/server/agent/static-interpreter.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const API_KEY = "sk-solvo-test-0123456789abcdef";
const BASE_URL = "https://api.openai.com/v1";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT_ADDRESS = "0x742d35cc6634c0532925a3b844bc454e4438f44e";

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

function makeOpenAiDeps(
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

// ── Contract assertions ─────────────────────────────────────────────────────

async function assertNoMoneyMoved(repo: MemoryRepository): Promise<void> {
  assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
  assert.equal(await repo.getClaimLinkByIdempotencyKey("ag:tg:-100777:m1:agent:claim"), null);
  const types = repo.auditEvents.map((event) => event.event_type);
  assert.equal(types.includes("approval_granted"), false);
  assert.equal(types.some((type) => type.startsWith("simulation_")), false);
  assert.equal(types.some((type) => type.startsWith("execution_")), false);
  assert.equal(repo.executionAttempts.size, 0);
}

async function assertRunRowFailed(repo: MemoryRepository): Promise<void> {
  const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
  assert.ok(record, "agent run row must be persisted");
  assert.equal(record.status, "failed");
  assert.equal(record.error_code, "interpreter_error");
  assert.ok(record.error_message_redacted, "error message must be redacted");
  assert.equal("transaction_hash" in record, false);
  assert.equal("keeperhub_execution_id" in record, false);
  assert.equal(record.payout_id, null);
  assert.equal(record.claim_id, null);
  assert.equal(record.interpretation_json, null);
  assert.equal(record.decision_json, null);
}

/**
 * User-facing failure contract: apology + "nothing moved" + deterministic
 * slash-command fallbacks; never judgepay, raw provider output, secrets,
 * stack traces, quotes or JSON escapes.
 */
function assertFailureReply(
  result: AgentServiceResult,
  rawSnippet: string | null,
  secrets: readonly string[] = [],
): void {
  const formatted = formatAgentServiceResult(result);
  const text = formatted.text;
  assert.match(text, /sorry/i);
  assert.match(text, /nothing moved/i);
  assert.ok(text.includes("/pay"), "reply must suggest /pay");
  assert.ok(text.includes("/claimpay"), "reply must suggest /claimpay");
  assert.ok(text.includes("/status"), "reply must suggest /status");
  assert.equal(/judge/i.test(text), false, "reply must never mention judge mode");
  assert.equal(text.includes("judgepay"), false);
  if (rawSnippet !== null) {
    assert.equal(text.includes(rawSnippet), false, "reply must not include raw provider output");
  }
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, `reply must not include ${secret}`);
  }
  assert.equal(text.includes('"'), false, "reply must not include quotes");
  assert.equal(/stack|trace|TypeError|at .+\.ts:/i.test(text), false, "reply must not include a stack trace");
}

/**
 * Runs one provider failure scenario and asserts the full failure contract:
 * safe outcome, no money moved, redacted failed run row, and a reply with
 * deterministic fallback commands.
 */
async function assertProviderFailure(
  text: string,
  handler: (request: CapturedRequest) => Response | Promise<Response>,
  rawSnippet: string | null,
  secrets: readonly string[] = [],
  envOverrides: Record<string, string> = {},
): Promise<void> {
  const { repo, workspace, member } = await makeFixture();
  const { deps } = makeOpenAiDeps(repo, handler, envOverrides);
  const input = agentInput(text);
  const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
  assert.equal(result.outcome, "failed");
  await assertNoMoneyMoved(repo);
  await assertRunRowFailed(repo);
  assertFailureReply(result, rawSnippet, secrets);
}

// ── Failure contract cases ──────────────────────────────────────────────────

describe("provider failure contract — transport and authorization", () => {
  it("1. network error: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => {
        throw new TypeError("fetch failed");
      },
      "fetch failed",
    );
  });

  it("2. timeout: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => new Promise<Response>(() => {}),
      "timeout",
      [],
      { SOLVO_AGENT_TIMEOUT_MS: "500" },
    );
  });

  it("3. provider 401: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: { message: "invalid api key" } }, 401),
      "invalid api key",
    );
  });

  it("4. provider 403: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: { message: "forbidden" } }, 403),
      "forbidden",
    );
  });

  it("5. provider 429 rate limit: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: { message: "rate limit exceeded" } }, 429),
      "rate limit exceeded",
    );
  });

  it("6. provider 500: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse({ error: { message: "internal server error" } }, 500),
      "internal server error",
    );
  });
});

describe("provider failure contract — malformed and hostile output", () => {
  it("7. malformed JSON body: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => new Response("<html>not json</html>", { status: 200 }),
      "not json",
    );
  });

  it("8. empty output: typed failure, no money moved, safe fallback reply", async () => {
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody("", { output: [] })),
      "output",
    );
  });

  it("9. provider refusal: typed failure, no money moved, safe fallback reply", async () => {
    const body = {
      object: "response",
      output: [{ type: "message", id: "m", role: "assistant", content: [{ type: "refusal", refusal: "I cannot help with that." }] }],
    };
    await assertProviderFailure("send 0.01 USDC to daniel", () => jsonResponse(body), "refusal");
  });

  it("10. secret-shaped output: no secret in reply or persisted run records", async () => {
    const secret = "sk-evilsecretvalue123456";
    const payload = modelOutput({ summary: `Done. ${secret}` });
    const { repo, workspace, member } = await makeFixture();
    const { deps } = makeOpenAiDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(payload))));
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "failed");
    await assertNoMoneyMoved(repo);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    assert.equal(record.error_message_redacted?.includes(secret), false);
    assert.equal(record.raw_text_redacted?.includes(secret), false);
    assertFailureReply(result, JSON.stringify(payload), [secret]);
  });

  it("11. valid JSON with invalid schema: typed failure, no money moved, safe fallback reply", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, action: "refund" } });
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      JSON.stringify(payload).slice(0, 30),
    );
  });

  it("12. hostile execution action: typed failure, no money moved, safe fallback reply", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, action: "execute_transfer" } });
    await assertProviderFailure(
      "send 0.01 USDC to daniel",
      () => jsonResponse(responsesBody(JSON.stringify(payload))),
      JSON.stringify(payload).slice(0, 30),
    );
  });

  it("every failure case persists a redacted error with no raw provider response", async () => {
    const secret = "sk-evilsecretvalue123456";
    const payload = modelOutput({ summary: `Done. ${secret}` });
    const { repo, workspace, member } = await makeFixture();
    const { deps } = makeOpenAiDeps(repo, () => jsonResponse(responsesBody(JSON.stringify(payload))));
    const input = agentInput("send 0.01 USDC to daniel");
    await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    const record = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(record);
    assert.ok(record.error_message_redacted);
    assert.equal(record.error_message_redacted.includes(API_KEY), false);
    assert.equal(record.error_message_redacted.includes("Bearer"), false);
    assert.equal(record.error_message_redacted.includes(BASE_URL), false);
    assert.equal(record.error_message_redacted.includes(secret), false);
    assert.equal(record.error_message_redacted.includes("responses"), false);
  });
});

describe("provider failure contract — S1 static fallback sanity", () => {
  it("static provider still produces prepared_payment pending approval", async () => {
    const { repo, workspace, member } = await makeFixture();
    const config = getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_PROVIDER: "static",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
    });
    const deps: AgentServiceDeps = {
      ...defaultAgentDeps(repo, config, "https://solvo.example"),
      now: () => new Date("2026-08-12T13:00:00.000Z"),
    };
    assert.ok(deps.interpreter instanceof StaticIntentInterpreter);
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "prepared_payment");
    if (result.outcome === "prepared_payment") {
      const payout = await repo.getPayoutById(result.prepared.payoutId);
      assert.equal(payout?.status, "pending_approval");
      assert.equal(payout?.approved_at, null);
    }
    assert.equal(repo.executionAttempts.size, 0);
    const types = repo.auditEvents.map((event) => event.event_type);
    assert.equal(types.includes("approval_granted"), false);
    assert.equal(types.some((type) => type.startsWith("execution_")), false);
  });
});
