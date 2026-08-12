import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig, type AgentConfig } from "../../src/server/agent/config.ts";
import { extractCandidates } from "../../src/server/agent/extraction.ts";
import {
  AgentProviderError,
  OpenAICompatibleIntentInterpreter,
} from "../../src/server/agent/openai-compatible-interpreter.ts";
import { createIntentInterpreter } from "../../src/server/agent/providers/factory.ts";
import {
  defaultAgentDeps,
  runAgentOrchestration,
  type AgentServiceDeps,
} from "../../src/server/agent/service.ts";
import { StaticIntentInterpreter } from "../../src/server/agent/static-interpreter.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const API_KEY = "sk-solvo-test-0123456789abcdef";
const BASE_URL = "https://api.openai.com/v1";
const MODEL = "gpt-4o-mini";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECIPIENT_ADDRESS = "0x742d35cc6634c0532925a3b844bc454e4438f44e";

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

function openAIConfig(overrides: Record<string, string> = {}): AgentConfig {
  return getAgentConfig({
    SOLVO_AGENT_PROVIDER: "openai_compatible",
    SOLVO_AGENT_API_KEY: API_KEY,
    SOLVO_AGENT_MODEL: MODEL,
    SOLVO_AGENT_API_BASE_URL: BASE_URL,
    SOLVO_AGENT_MAX_TOKENS: "450",
    ...overrides,
  });
}

function agentInput(text = "send 1.5 USDC to daniel", messageId = 1): AgentInput {
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
    candidates: extractCandidates(text, ["daniel"]).candidates,
  };
}

function modelOutput(): Record<string, unknown> {
  return {
    intent: {
      action: "pay",
      amount: "1.5",
      currency: "USDC",
      recipient: { raw: "daniel", kind: "alias", address: null, alias: "daniel" },
      memo: null,
      missingFields: [],
    },
    intentKind: "prepare_payment",
    summary: "Send 1.5 USDC to daniel.",
  };
}

function validResponsesBody(): Record<string, unknown> {
  return {
    id: "resp_test",
    object: "response",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(modelOutput()) }],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type CapturedRequest = { url: string; init: RequestInit };

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
  const member = await repo.getWorkspaceMember(workspace.id, "123456");
  return { repo, workspace, member };
}

describe("intent provider factory — selection", () => {
  it("returns a StaticIntentInterpreter for the static provider", () => {
    const config = getAgentConfig({ SOLVO_AGENT_PROVIDER: "static" });
    const interpreter = createIntentInterpreter(config);
    assert.ok(interpreter instanceof StaticIntentInterpreter);
    assert.ok(!(interpreter instanceof OpenAICompatibleIntentInterpreter));
  });

  it("selects static even when the agent is enabled, with no API key required", () => {
    const config = getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_PROVIDER: "static",
    });
    assert.equal(config.apiKey, null);
    const interpreter = createIntentInterpreter(config);
    assert.ok(interpreter instanceof StaticIntentInterpreter);
  });

  it("returns an OpenAICompatibleIntentInterpreter when a key exists", () => {
    const interpreter = createIntentInterpreter(openAIConfig());
    assert.ok(interpreter instanceof OpenAICompatibleIntentInterpreter);
  });

  it("fails closed when provider is openai_compatible without an API key", () => {
    const noKey = getAgentConfig({ SOLVO_AGENT_PROVIDER: "openai_compatible" });
    assert.equal(noKey.apiKey, null);
    assert.throws(
      () => createIntentInterpreter(noKey),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });

  it("fails closed when the API key is empty or whitespace-only", () => {
    for (const key of ["", "   "]) {
      const config = getAgentConfig({ SOLVO_AGENT_PROVIDER: "openai_compatible", SOLVO_AGENT_API_KEY: key });
      assert.equal(config.apiKey, null);
      assert.throws(
        () => createIntentInterpreter(config),
        (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
        `key "${key}" must be rejected`,
      );
    }
  });

  it("fails closed on an unknown provider even when config type safety is bypassed", () => {
    for (const provider of ["bogus", "anthropic", "gpt-4", "magic", null, 42]) {
      assert.throws(
        () => createIntentInterpreter({ provider } as unknown as AgentConfig),
        (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
        `provider ${String(provider)} must be rejected`,
      );
    }
  });

  it("never includes the API key in factory error messages", () => {
    const noKey = getAgentConfig({ SOLVO_AGENT_PROVIDER: "openai_compatible" });
    try {
      createIntentInterpreter(noKey);
      assert.fail("expected an AgentProviderError");
    } catch (error) {
      assert.ok(error instanceof AgentProviderError);
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes("sk-"), false);
      assert.equal(error.message.includes("Bearer"), false);
    }
    try {
      createIntentInterpreter({ provider: "bogus", apiKey: API_KEY } as unknown as AgentConfig);
      assert.fail("expected an AgentProviderError");
    } catch (error) {
      assert.ok(error instanceof AgentProviderError);
      assert.equal(error.message.includes(API_KEY), false);
    }
  });

  it("fails closed when the base URL is not a parseable URL", () => {
    // Passes the config-level http(s) prefix check but fails the adapter's
    // stricter URL parse: the factory must fail closed, never attempt a call.
    const config = openAIConfig({ SOLVO_AGENT_API_BASE_URL: "https://exa mple.com" });
    assert.throws(
      () => createIntentInterpreter(config),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });
});

describe("intent provider factory — config passthrough", () => {
  it("passes model, baseUrl, timeout and max tokens from config into the adapter", async () => {
    const captured: CapturedRequest[] = [];
    const config = openAIConfig({ SOLVO_AGENT_TIMEOUT_MS: "500", SOLVO_AGENT_MAX_TOKENS: "450" });
    const interpreter = createIntentInterpreter(config, {
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        captured.push({ url: String(url), init: init ?? {} });
        return jsonResponse(validResponsesBody());
      },
    });
    assert.ok(interpreter instanceof OpenAICompatibleIntentInterpreter);
    const input = agentInput();
    const result = await interpreter.interpret(input, extractCandidates(input.rawText, ["daniel"]));
    assert.equal(result.intentKind, "prepare_payment");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, `${BASE_URL}/responses`);
    const body = JSON.parse(captured[0].init.body as string) as Record<string, unknown>;
    assert.equal(body.model, MODEL);
    assert.equal(body.max_output_tokens, 450);
    assert.ok(captured[0].init.signal instanceof AbortSignal, "timeout budget must be attached");
  });

  it("honors the config timeout when the transport never responds", async () => {
    const config = openAIConfig({ SOLVO_AGENT_TIMEOUT_MS: "500" });
    const interpreter = createIntentInterpreter(config, {
      fetch: () => new Promise<Response>(() => {}),
    });
    const input = agentInput();
    try {
      await interpreter.interpret(input, extractCandidates(input.rawText, ["daniel"]));
      assert.fail("expected a timeout AgentProviderError");
    } catch (error) {
      assert.ok(error instanceof AgentProviderError);
      assert.equal(error.code, "timeout");
    }
  });

  it("applies config defaults when model and base URL are not configured", () => {
    const config = getAgentConfig({
      SOLVO_AGENT_PROVIDER: "openai_compatible",
      SOLVO_AGENT_API_KEY: API_KEY,
    });
    assert.equal(config.model, null);
    assert.equal(config.apiBaseUrl, null);
    const interpreter = createIntentInterpreter(config);
    assert.ok(interpreter instanceof OpenAICompatibleIntentInterpreter);
  });
});

describe("intent provider factory — defaultAgentDeps integration", () => {
  it("uses the static interpreter by default", () => {
    const repo = new MemoryRepository();
    const config = getAgentConfig();
    const deps = defaultAgentDeps(repo, config, "https://solvo.example");
    assert.ok(deps.interpreter instanceof StaticIntentInterpreter);
    assert.equal(deps.repo, repo);
    assert.equal(deps.config, config);
    assert.equal(deps.appUrl, "https://solvo.example");
  });

  it("uses the openai-compatible adapter when configured with a key", () => {
    const deps = defaultAgentDeps(new MemoryRepository(), openAIConfig(), "https://solvo.example");
    assert.ok(deps.interpreter instanceof OpenAICompatibleIntentInterpreter);
  });

  it("fails closed at defaultAgentDeps construction when a key is missing", () => {
    const noKey = getAgentConfig({ SOLVO_AGENT_PROVIDER: "openai_compatible" });
    assert.throws(
      () => defaultAgentDeps(new MemoryRepository(), noKey, "https://solvo.example"),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });

  it("runs the full service with a factory-created static interpreter", async () => {
    const { repo, workspace, member } = await makeFixture();
    const config = getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
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
    }
  });

  it("keeps the service disabled for a disabled config with an adapter selected", async () => {
    const { repo, workspace, member } = await makeFixture();
    const config = getAgentConfig({
      SOLVO_AGENT_ENABLED: "false",
      SOLVO_AGENT_PROVIDER: "openai_compatible",
      SOLVO_AGENT_API_KEY: API_KEY,
    });
    const interpreter = createIntentInterpreter(config);
    assert.ok(interpreter instanceof OpenAICompatibleIntentInterpreter);
    const deps: AgentServiceDeps = {
      ...defaultAgentDeps(repo, config, "https://solvo.example"),
      now: () => new Date("2026-08-12T13:00:00.000Z"),
    };
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "disabled");
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"), null);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
  });
});

describe("intent provider factory — safety boundaries", () => {
  it("makes no live fetch during factory creation", async () => {
    let calls = 0;
    const spyFetch = async (): Promise<Response> => {
      calls += 1;
      return jsonResponse(validResponsesBody());
    };
    const interpreter = createIntentInterpreter(openAIConfig(), { fetch: spyFetch });
    assert.equal(calls, 0);
    assert.ok(interpreter instanceof OpenAICompatibleIntentInterpreter);
    const input = agentInput();
    const result = await interpreter.interpret(input, extractCandidates(input.rawText, ["daniel"]));
    assert.equal(result.intentKind, "prepare_payment");
    assert.equal(calls, 1, "fetch must only run when interpret is invoked");
  });

  it("imports nothing from KeeperHub, execution, Telegram, webhook, judge, or SQL modules", () => {
    const source = readFileSync("src/server/agent/providers/factory.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of [
      "keeperhub",
      "execution-service",
      "mcp-client",
      "telegram",
      "webhook",
      "judge",
      "sql",
      "postgres",
      "tools.ts",
    ]) {
      assert.equal(imports.includes(banned), false, `imports ${banned}`);
    }
    assert.equal(/fetch\(/.test(source), false, "factory must not call fetch itself");
  });

  it("exposes no AGENT_TOOLS or dangerous tool names to the provider", () => {
    const source = readFileSync("src/server/agent/providers/factory.ts", "utf8");
    assert.equal(source.includes("AGENT_TOOL_NAMES"), false);
    assert.equal(source.includes("getAgentTool"), false);
    for (const tool of FORBIDDEN_TOOLS) {
      assert.equal(source.includes(tool), false, `factory mentions ${tool}`);
    }
  });

  it("does not reference any NEXT_PUBLIC_ env identifier", () => {
    const source = readFileSync("src/server/agent/providers/factory.ts", "utf8");
    assert.equal(/NEXT_PUBLIC_[A-Z_]+/.test(source), false);
  });
});
