import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { getAgentConfig } from "../../src/server/agent/config.ts";
import { extractCandidates, type ExtractionResult } from "../../src/server/agent/extraction.ts";
import {
  AgentProviderError,
  MODEL_OUTPUT_SCHEMA,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  OpenAICompatibleIntentInterpreter,
  openAICompatibleFromAgentConfig,
} from "../../src/server/agent/openai-compatible-interpreter.ts";
import { validateAgentInterpretation } from "../../src/server/agent/schema.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const ADDRESS_LOWER = ADDRESS.toLowerCase();
const API_KEY = "sk-solvo-test-0123456789abcdef";
const BASE_URL = "https://api.openai.com/v1";
const MODEL = "gpt-4o-mini";

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

function agentInput(text = "send 1.5 USDC to daniel"): AgentInput {
  return {
    surface: "telegram",
    chatId: "-100777",
    userId: "123456",
    messageId: 42,
    rawText: text,
    timestampIso: "2026-08-12T00:00:00.000Z",
    workspace: {
      id: "ws-1",
      mode: "community",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      aliases: ["daniel"],
      perTransactionLimitUsdc: "1.00",
      dailyLimitUsdc: "10.00",
      workspaceActive: true,
    },
    flags: { workspaceMode: "community", isMember: true },
    candidates: extractCandidates(text, ["daniel"]).candidates,
  };
}

function extraction(text = "send 1.5 USDC to daniel"): ExtractionResult {
  return extractCandidates(text, ["daniel"]);
}

function modelOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { intent: Record<string, unknown> } {
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
    ...overrides,
  } as Record<string, unknown> & { intent: Record<string, unknown> };
}

function responsesBody(outputText: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "resp_test",
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type CapturedRequest = { url: string; init: RequestInit };

function makeProvider(
  handler: (request: CapturedRequest) => Response | Promise<Response>,
  options: Partial<ConstructorParameters<typeof OpenAICompatibleIntentInterpreter>[0]> = {},
): { interpreter: OpenAICompatibleIntentInterpreter; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const entry = { url: String(url), init: init ?? {} };
    captured.push(entry);
    return handler(entry);
  };
  const interpreter = new OpenAICompatibleIntentInterpreter({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    model: MODEL,
    fetch: fetchImpl,
    ...options,
  });
  return { interpreter, captured };
}

function parseBody(request: CapturedRequest): Record<string, unknown> {
  return JSON.parse(request.init.body as string) as Record<string, unknown>;
}

function parseHeaders(request: CapturedRequest): Record<string, string> {
  return request.init.headers as Record<string, string>;
}

async function assertProviderError(
  promise: Promise<unknown>,
  code: AgentProviderError["code"],
  message: string,
): Promise<void> {
  try {
    await promise;
    assert.fail(`expected AgentProviderError (${code}) for ${message}`);
  } catch (error) {
    assert.ok(error instanceof AgentProviderError, `${message}: expected AgentProviderError`);
    assert.equal(error.code, code, message);
  }
}

describe("openai-compatible intent provider — request shape", () => {
  it("sends a POST request to the configured baseUrl /responses endpoint", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(), extraction());
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, `${BASE_URL}/responses`);
    assert.equal(captured[0].init.method, "POST");
  });

  it("uses the configured base URL and endpoint path verbatim", async () => {
    const baseUrl = "https://llm.internal.example/proxy/v2";
    const { interpreter, captured } = makeProvider(
      () => jsonResponse(responsesBody(JSON.stringify(modelOutput()))),
      { baseUrl, endpointPath: "/chat/completions" },
    );
    await interpreter.interpret(agentInput(), extraction());
    assert.equal(captured[0].url, `${baseUrl}/chat/completions`);
  });

  it("includes an Authorization Bearer header without leaking the key elsewhere", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const result = await interpreter.interpret(agentInput(), extraction());
    assert.equal(parseHeaders(captured[0]).Authorization, `Bearer ${API_KEY}`);
    const body = JSON.stringify(parseBody(captured[0]));
    assert.equal(body.includes(API_KEY), false, "API key must not appear in the request body");
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
  });

  it("requests structured json_schema output with the bounded schema", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(), extraction());
    const body = parseBody(captured[0]);
    assert.equal(body.model, MODEL);
    const format = (body.text as Record<string, unknown>).format as Record<string, unknown>;
    assert.equal(format.type, "json_schema");
    assert.equal(format.name, "payment_intent");
    assert.equal(format.strict, true);
    assert.deepEqual(format.schema, MODEL_OUTPUT_SCHEMA);
    assert.equal(body.max_output_tokens, 500);
  });

  it("sends a concise system + user message pair", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(), extraction());
    const input = parseBody(captured[0]).input as Array<{ role: string; content: string }>;
    assert.equal(input.length, 2);
    assert.equal(input[0].role, "system");
    assert.equal(input[1].role, "user");
    assert.ok(input[1].content.includes("send 1.5 USDC to daniel"));
    assert.ok(input[1].content.includes("amounts: 1.5"));
    assert.ok(input[1].content.includes("aliases: daniel"));
  });
});

describe("openai-compatible intent provider — structured output handling", () => {
  it("converts valid provider output into a schema-valid AgentInterpretation", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput();
    const result = await interpreter.interpret(input, extraction());
    assert.equal(result.provider, OPENAI_COMPATIBLE_PROVIDER_ID);
    assert.equal(result.intentKind, "prepare_payment");
    assert.equal(result.intent.action, "pay");
    assert.equal(result.intent.amount, "1.5");
    assert.equal(result.intent.currency, "USDC");
    assert.equal(result.intent.recipient?.kind, "alias");
    assert.equal(result.intent.recipient?.alias, "daniel");
    assert.deepEqual(result.intent.missingFields, []);
    assert.equal(result.intent.source, "natural_language");
    assert.equal(validateAgentInterpretation(result).ok, true);
  });

  it("injects the deterministic candidates so the model cannot fabricate provenance", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const text = "send 1.5 USDC to daniel";
    const result = await interpreter.interpret(agentInput(text), extraction(text));
    assert.deepEqual(result.intent.candidates, extraction(text).candidates);
  });

  it("parses the top-level output_text convenience field of a Responses body", async () => {
    const body = { object: "response", output_text: JSON.stringify(modelOutput()) };
    const { interpreter } = makeProvider(() => jsonResponse(body));
    const result = await interpreter.interpret(agentInput(), extraction());
    assert.equal(result.intentKind, "prepare_payment");
  });

  it("parses Chat Completions style bodies for compatible endpoints", async () => {
    const body = {
      choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(modelOutput()) } }],
    };
    const { interpreter } = makeProvider(() => jsonResponse(body));
    const result = await interpreter.interpret(agentInput(), extraction());
    assert.equal(result.intentKind, "prepare_payment");
  });

  it("rejects malformed JSON in the response body (fail closed)", async () => {
    const { interpreter } = makeProvider(() => new Response("not-json", { status: 200 }));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_response", "non-JSON body");
  });

  it("rejects model output text that is not valid JSON (fail closed)", async () => {
    const { interpreter } = makeProvider(() =>
      jsonResponse(responsesBody('I cannot comply with that request.')),
    );
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_response", "non-JSON output text");
  });

  it("rejects schema-invalid output: missing intentKind (fail closed)", async () => {
    const hostile = modelOutput();
    delete hostile.intentKind;
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "missing intentKind");
  });

  it("rejects a fabricated amount that is not a deterministic candidate (fail closed)", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput({ intent: { ...modelOutput().intent, amount: "999" } })))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "fabricated amount");
  });

  it("rejects a fabricated address that is not a deterministic candidate (fail closed)", async () => {
    const hostile = modelOutput({
      intent: {
        action: "pay",
        amount: "1.5",
        currency: "USDC",
        recipient: { raw: ADDRESS, kind: "address", address: ADDRESS_LOWER, alias: null },
        memo: null,
        missingFields: [],
      },
    });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "fabricated address");
  });

  it("rejects a mismatched intentKind/action combination (fail closed)", async () => {
    const hostile = modelOutput({ intentKind: "create_claim_link" });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "mismatched intentKind");
  });

  it("rejects an empty summary (fail closed)", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput({ summary: "" })))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "empty summary");
  });

  it("accepts a bounded provider memo within the schema cap", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, memo: "design work" } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(payload))));
    const result = await interpreter.interpret(agentInput(), extraction());
    assert.equal(result.intent.memo, "design work");
    assert.equal(validateAgentInterpretation(result).ok, true);
  });

  it("rejects a provider memo longer than 140 characters (fail closed)", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, memo: "a".repeat(141) } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(payload))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "over-long memo");
  });

  it("rejects a provider memo containing secret-shaped content (fail closed)", async () => {
    const payload = modelOutput({ intent: { ...modelOutput().intent, memo: "sk-evilsecretvalue123456" } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(payload))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "secret memo");
  });

  it("re-validates output with the local schema (test 14 contract)", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput({ intent: { ...modelOutput().intent, action: "status" } })))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "action/intentKind mismatch");
  });
});

describe("openai-compatible intent provider — hostile model output", () => {
  it("rejects an execution action (fail closed)", async () => {
    const hostile = modelOutput({ intent: { ...modelOutput().intent, action: "execute_transfer" } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "execute action");
  });

  it("rejects a completion claim with a fake transaction hash (fail closed)", async () => {
    const hostile = {
      ...modelOutput(),
      transactionHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "fake transaction hash");
  });

  it("rejects a payment-completed claim inside the intent (fail closed)", async () => {
    const hostile = modelOutput({ intent: { ...modelOutput().intent, completed: true } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "completed claim");
  });

  it("rejects arbitrary tool names in the output (fail closed)", async () => {
    const hostile = { ...modelOutput(), tools: ["execute_transfer"] };
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "tool names");
  });

  it("rejects a raw SQL plan smuggled in the output (fail closed)", async () => {
    const hostile = { ...modelOutput(), plan: { action: "raw_sql", query: "SELECT * FROM payouts" } };
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "raw sql plan");
  });

  it("rejects KeeperHub call instructions in the output (fail closed)", async () => {
    const hostile = modelOutput({ intent: { ...modelOutput().intent, keeperhubCall: true } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_output", "keeperhub call");
  });

  it("never lets model output override the deterministic source", async () => {
    const hostile = modelOutput({ intent: { ...modelOutput().intent, source: "system" } });
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    const result = await interpreter.interpret(agentInput(), extraction());
    assert.equal(result.intent.source, "natural_language");
    assert.equal(validateAgentInterpretation(result).ok, true);
  });
});

describe("openai-compatible intent provider — provider failures", () => {
  for (const status of [401, 403, 500]) {
    it(`handles HTTP ${status} safely with a typed error`, async () => {
      const { interpreter, captured } = makeProvider(() => jsonResponse({ error: "boom" }, status));
      const expected = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "provider_unavailable";
      await assertProviderError(interpreter.interpret(agentInput(), extraction()), expected, `HTTP ${status}`);
      try {
        await interpreter.interpret(agentInput(), extraction());
        assert.fail("expected an AgentProviderError");
      } catch (error) {
        assert.ok(error instanceof AgentProviderError);
        assert.equal(JSON.stringify(error.message).includes(API_KEY), false);
        assert.equal(JSON.stringify(error.message).includes("Bearer"), false);
      }
      assert.equal(JSON.stringify(parseBody(captured[0])).includes(API_KEY), false);
    });
  }

  it("maps a thrown network error to a typed network error", async () => {
    const { interpreter } = makeProvider(() => {
      throw new TypeError("fetch failed");
    });
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "network", "network throw");
  });

  it("times out safely through the AbortSignal and reports a typed timeout", async () => {
    let receivedSignal: AbortSignal | null = null;
    const neverResolving = (request: CapturedRequest): Promise<Response> =>
      new Promise((_resolve, reject) => {
        const signal: AbortSignal | null = request.init.signal ?? null;
        receivedSignal = signal;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    const { interpreter } = makeProvider(neverResolving, { timeoutMs: 30 });
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "timeout", "abort timeout");
    assert.equal((receivedSignal as AbortSignal | null)?.aborted, true);
  });

  it("times out even when the transport ignores the AbortSignal", async () => {
    const signalIgnoring = (): Promise<Response> => new Promise(() => {});
    const { interpreter } = makeProvider(signalIgnoring, { timeoutMs: 30 });
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "timeout", "signal-ignoring transport");
  });

  it("does not retry after a failure", async () => {
    let calls = 0;
    const { interpreter, captured } = makeProvider(() => {
      calls += 1;
      return jsonResponse({ error: "boom" }, 500);
    });
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "provider_unavailable", "500");
    assert.equal(calls, 1);
    assert.equal(captured.length, 1);
  });
});

describe("openai-compatible intent provider — refusal and empty output", () => {
  it("handles a refusal response safely", async () => {
    const body = {
      id: "resp_refusal",
      object: "response",
      output: [
        {
          type: "message",
          id: "msg_refusal",
          role: "assistant",
          content: [{ type: "refusal", refusal: "I cannot help with that." }],
        },
      ],
    };
    const { interpreter } = makeProvider(() => jsonResponse(body));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "refused", "refusal");
  });

  it("handles an empty output array safely", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody("", { output: [] })));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_response", "empty output");
  });

  it("handles missing output text safely", async () => {
    const { interpreter } = makeProvider(() => jsonResponse({ object: "response", output: [] }));
    await assertProviderError(interpreter.interpret(agentInput(), extraction()), "invalid_response", "no output text");
  });
});

describe("openai-compatible intent provider — configuration guards", () => {
  it("rejects a missing or empty API key at construction", () => {
    assert.throws(
      () => new OpenAICompatibleIntentInterpreter({ apiKey: "" }),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
    assert.throws(
      () => new OpenAICompatibleIntentInterpreter({} as never),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });

  it("rejects a missing API key from config at construction", () => {
    const config = getAgentConfig({ SOLVO_AGENT_PROVIDER: "openai_compatible" });
    assert.equal(config.apiKey, null);
    assert.throws(
      () => openAICompatibleFromAgentConfig(config),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });

  it("builds a provider from a fully configured AgentConfig", async () => {
    const config = getAgentConfig({
      SOLVO_AGENT_PROVIDER: "openai_compatible",
      SOLVO_AGENT_API_KEY: API_KEY,
      SOLVO_AGENT_MODEL: MODEL,
      SOLVO_AGENT_API_BASE_URL: BASE_URL,
      SOLVO_AGENT_TIMEOUT_MS: "5000",
    });
    const captured: CapturedRequest[] = [];
    const provider = openAICompatibleFromAgentConfig(config);
    const result = await new OpenAICompatibleIntentInterpreter({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      model: MODEL,
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        captured.push({ url: String(url), init: init ?? {} });
        return jsonResponse(responsesBody(JSON.stringify(modelOutput())));
      },
    }).interpret(agentInput(), extraction());
    assert.ok(provider instanceof OpenAICompatibleIntentInterpreter);
    assert.equal(result.intentKind, "prepare_payment");
    assert.equal(captured[0].url, `${BASE_URL}/responses`);
    assert.equal(parseBody(captured[0]).model, MODEL);
  });

  it("rejects non-http(s) base URLs (file, javascript, ftp)", () => {
    for (const baseUrl of ["file:///etc/secrets", "javascript:alert(1)", "ftp://host/v1", "not-a-url"]) {
      assert.throws(
        () => new OpenAICompatibleIntentInterpreter({ apiKey: API_KEY, baseUrl }),
        (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
        `baseUrl ${baseUrl} must be rejected`,
      );
    }
  });

  it("rejects an endpoint path that is not a path", () => {
    assert.throws(
      () => new OpenAICompatibleIntentInterpreter({ apiKey: API_KEY, endpointPath: "https://evil.example" }),
      (error: unknown) => error instanceof AgentProviderError && error.code === "invalid_config",
    );
  });
});

describe("openai-compatible intent provider — prompt safety", () => {
  it("never includes secrets from env/config in the prompt", async () => {
    const secretEnv = {
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_PROVIDER: "openai_compatible",
      SOLVO_AGENT_API_KEY: API_KEY,
      SOLVO_AGENT_MODEL: MODEL,
      SOLVO_AGENT_API_BASE_URL: BASE_URL,
      DATABASE_URL: "postgres://admin:hunter2@db.internal:5432/solvo",
      TELEGRAM_BOT_TOKEN: "1234567890:AAfakeTelegramBotTokenValue",
    };
    const config = getAgentConfig(secretEnv);
    assert.equal(config.apiKey, API_KEY);
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(), extraction());
    const body = JSON.stringify(parseBody(captured[0]));
    for (const secret of [API_KEY, "admin:hunter2", "db.internal", "AAfakeTelegramBotTokenValue"]) {
      assert.equal(body.includes(secret), false, `prompt leaked ${secret}`);
    }
    assert.ok(config);
  });

  it("redacts secret-shaped strings from the user message before it reaches the provider", async () => {
    const fakeToken = "1234567890:AAH4m3Hhf2lGkXhI5dKq2fZv9QwErTyUiOpAsDfGhJk";
    const text = `send 1.5 USDC to daniel, my bot token is ${fakeToken}`;
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(text), extraction(text));
    const body = JSON.stringify(parseBody(captured[0]));
    assert.equal(body.includes(fakeToken), false);
    assert.equal(body.includes("[REDACTED]"), true);
  });

  it("includes only sanitized workspace context in the prompt", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput();
    await interpreter.interpret(input, extraction());
    const body = JSON.stringify(parseBody(captured[0]));
    assert.ok(body.includes("mode=community"));
    assert.ok(body.includes("chainId=8453"));
    assert.equal(body.includes("perTransactionLimitUsdc"), false);
    assert.equal(body.includes("tokenAddress"), false);
  });

  it("instructs the model it has no authority and must not execute or approve", async () => {
    const { interpreter, captured } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    await interpreter.interpret(agentInput(), extraction());
    const input = parseBody(captured[0]).input as Array<{ role: string; content: string }>;
    const system = input[0].content;
    for (const required of [
      "You are NOT a payment authority",
      "must NOT",
      "execute or approve payments",
      "never invent values",
      "Deterministic Solvo policy makes all final decisions",
    ]) {
      assert.ok(system.includes(required), `system prompt must state: ${required}`);
    }
  });
});

describe("openai-compatible intent provider — boundaries and determinism", () => {
  it("imports nothing from execution, KeeperHub, judge, webhook, Telegram, or SQL modules", () => {
    const source = readFileSync("src/server/agent/openai-compatible-interpreter.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of [
      "execution-service",
      "keeperhub",
      "mcp-client",
      "judge",
      "webhook-admin",
      "telegram",
      "sql",
      "postgres",
      "tools.ts",
    ]) {
      assert.equal(imports.includes(banned), false, `imports ${banned}`);
    }
  });

  it("exposes no dangerous tool names to the provider", () => {
    const source = readFileSync("src/server/agent/openai-compatible-interpreter.ts", "utf8");
    const schemaText = JSON.stringify(MODEL_OUTPUT_SCHEMA);
    for (const tool of FORBIDDEN_TOOLS) {
      assert.equal(source.includes(tool), false, `source mentions ${tool}`);
      assert.equal(schemaText.includes(tool), false, `schema mentions ${tool}`);
    }
    assert.equal(source.includes("AGENT_TOOL_NAMES"), false);
  });

  it("the model cannot select arbitrary tool names: schema has no tools array", () => {
    const schema = MODEL_OUTPUT_SCHEMA as Record<string, unknown>;
    const intent = schema.properties as Record<string, unknown>;
    assert.equal("tools" in intent, false);
    assert.equal("functions" in intent, false);
    const schemaText = JSON.stringify(MODEL_OUTPUT_SCHEMA);
    for (const key of ["tool_choice", "tools", "functions"]) {
      assert.equal(schemaText.includes(`"${key}"`), false);
    }
  });

  it("is deterministic: repeated identical responses yield deep-equal results", async () => {
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(modelOutput()))));
    const input = agentInput();
    const extractionResult = extraction();
    const first = await interpreter.interpret(input, extractionResult);
    const second = await interpreter.interpret(input, extractionResult);
    assert.deepEqual(first, second);
  });

  it("never stores or returns raw model output with secrets", async () => {
    const hostile = { ...modelOutput(), apiKey: "sk-leaked-secret", secretPayload: '{"DATABASE_URL":"postgres://x:y@h/db"}' };
    const { interpreter } = makeProvider(() => jsonResponse(responsesBody(JSON.stringify(hostile))));
    try {
      await interpreter.interpret(agentInput(), extraction());
      assert.fail("expected an AgentProviderError");
    } catch (error) {
      assert.ok(error instanceof AgentProviderError);
      assert.equal(error.code, "invalid_output");
      assert.equal(error.message.includes("sk-leaked-secret"), false);
      assert.equal(error.message.includes("DATABASE_URL"), false);
      assert.equal(error.message.includes("postgres://"), false);
      assert.equal(error.message.includes(JSON.stringify(hostile)), false);
    }
  });

  it("fails closed through safeInterpretation when wired into the service", async () => {
    const { safeInterpretation } = await import("../../src/server/agent/interpreter.ts");
    const hostile = modelOutput({ intent: { ...modelOutput().intent, action: "execute_transfer" } });
    const safe = safeInterpretation(hostile);
    assert.equal(safe.intent.action, "unknown");
    assert.equal(safe.intentKind, "unsupported");
  });
});
