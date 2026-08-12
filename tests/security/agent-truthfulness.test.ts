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
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const APP_URL = "https://solvo.example";
const PAYOUT_ID = "payout-123";
const CLAIM_ID = "claim-456";
const CLAIM_URL = "https://solvo.example/claim/abcdefghijklmnopqrstuvwxyz012345";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";
const FAKE_HASH = "0x" + "ab".repeat(32);
const FAKE_EXECUTION_ID = "keeperhub-exec-1234567890";

const HEX_HASH_PATTERN = /0x[0-9a-fA-F]{64}/;

/**
 * An agent reply must never claim execution truth it does not own: no
 * transaction hashes, no execution ids, no proof, no completion claims —
 * except where the result explicitly carries completed state.
 */
function assertNoTruthClaims(text: string, label: string): void {
  assert.equal(HEX_HASH_PATTERN.test(text), false, `${label}: contains a tx-hash-shaped string`);
  assert.equal(/transaction/i.test(text), false, `${label}: mentions a transaction`);
  assert.equal(/execution id/i.test(text), false, `${label}: mentions an execution id`);
  assert.equal(text.includes(FAKE_EXECUTION_ID), false, `${label}: leaks an execution id`);
  assert.equal(/proof/i.test(text), false, `${label}: claims proof`);
  assert.equal(/executed/i.test(text), false, `${label}: says executed`);
  assert.equal(/\bsent\b|\btransferred\b|\bpaid\b/i.test(text), false, `${label}: claims a completed transfer`);
}

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: "123456",
    chatId: "-100777",
    chatType: "supergroup",
    messageId: 42,
    updateId: 1,
    ...overrides,
  };
}

function preparedResult(overrides: Partial<Extract<AgentServiceResult, { outcome: "prepared_payment" }>["prepared"]> = {}): AgentServiceResult {
  return {
    outcome: "prepared_payment",
    prepared: {
      outcome: "created",
      payoutId: PAYOUT_ID,
      itemId: "item-1",
      amountBaseUnits: "10000",
      recipientAddress: ADDRESS.toLowerCase(),
      recipientAlias: "daniel",
      state: "pending_approval",
      approvalRequired: true,
      memo: null,
      buttons: [],
      ...overrides,
    },
  };
}

function claimResult(): AgentServiceResult {
  return {
    outcome: "claim_link_created",
    claim: {
      outcome: "created",
      claimId: CLAIM_ID,
      claimUrl: CLAIM_URL,
      tokenPrefix: "abcdefgh",
      amountBaseUnits: "50000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS.toLowerCase(),
      expiresAt: "2026-08-19T13:00:00.000Z",
      state: "created",
      approvalBehavior: "x",
    },
  };
}

function batchResult(overrides: Partial<Extract<AgentServiceResult, { outcome: "prepared_batch_payment" }>["prepared"]> = {}): AgentServiceResult {
  return {
    outcome: "prepared_batch_payment",
    prepared: {
      outcome: "created",
      payoutId: PAYOUT_ID,
      itemCount: 2,
      totalAmountBaseUnits: "20000",
      recipients: [
        { label: "blossom", address: "0x1234567890abcdef1234567890abcdef12345678", amountBaseUnits: "10000", memo: null },
        { label: "endurance", address: "0x234567890abcdef1234567890abcdef123456789", amountBaseUnits: "10000", memo: null },
      ],
      memo: null,
      state: "pending_approval",
      approvalRequired: true,
      buttons: [],
      ...overrides,
    },
  };
}

async function makeWorkspaceFixture() {
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
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: ADDRESS, createdBy: "1" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  return { repo, workspace, member: await repo.getWorkspaceMember(workspace.id, "123456") };
}

function routingDeps(repo: MemoryRepository): AgentFlowDeps {
  return {
    repo,
    config: getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "50",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    }),
    appUrl: APP_URL,
    now: () => new Date("2026-08-12T13:00:00.000Z"),
  };
}

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

async function makeProviderDeps(repo: MemoryRepository, handler: typeof fetch): Promise<AgentServiceDeps> {
  const config = getAgentConfig({
    SOLVO_AGENT_ENABLED: "true",
    SOLVO_AGENT_PROVIDER: "openai_compatible",
    SOLVO_AGENT_API_KEY: "sk-solvo-test-0123456789abcdef",
    SOLVO_AGENT_MODEL: "gpt-4o-mini",
    SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
    SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
  });
  const interpreter = createIntentInterpreter(config, { fetch: handler });
  return {
    repo,
    interpreter,
    config,
    appUrl: APP_URL,
    now: () => new Date("2026-08-12T13:00:00.000Z"),
  };
}

describe("agent truthfulness — reply contract", () => {
  it("1-4. prepared payment reply never carries hashes, execution ids, completion, or executed facts", () => {
    const reply = formatAgentServiceResult(preparedResult());
    assertNoTruthClaims(reply.text, "prepared payment");
    assert.match(reply.text, /no funds have moved/i);
    assert.match(reply.text, /approval/i);
    assert.equal(reply.text.includes(FAKE_HASH), false);
  });

  it("5. prepared payment reply never says transferred, sent, or paid", () => {
    const reply = formatAgentServiceResult(preparedResult());
    assert.equal(/\btransferred\b|\bsent\b|\bpaid\b/i.test(reply.text), false, reply.text);
  });

  it("6. claim-link reply never says paid, completed, or executed", () => {
    const reply = formatAgentServiceResult(claimResult());
    assert.equal(/\bpaid\b|completed|executed/i.test(reply.text), false, reply.text);
    assertNoTruthClaims(reply.text, "claim link");
  });

  it("7. failed reply never mentions hashes, proof, or completion", () => {
    const reply = formatAgentServiceResult({ outcome: "failed", reason: "x" });
    assert.equal(/hash|proof|completed|executed/i.test(reply.text), false, reply.text);
    assertNoTruthClaims(reply.text, "failed");
  });

  it("24. prepared batch reply claims no execution, proof, hashes, or completion", () => {
    const reply = formatAgentServiceResult(batchResult());
    assert.match(reply.text, /approval required/i);
    assert.match(reply.text, /no funds have moved/i);
    assert.match(reply.text, /RECIPIENTS/i);
    assert.match(reply.text, /blossom/i);
    assert.match(reply.text, /endurance/i);
    assert.match(reply.text, /0\.02 USDC/i);
    assertNoTruthClaims(reply.text, "prepared batch");
  });

  it("8. hostile provider output claiming completion with a fake hash still fails closed", async () => {
    const { repo, workspace, member } = await makeWorkspaceFixture();
    const hostile = {
      intent: {
        action: "pay",
        amount: "0.01",
        currency: "USDC",
        recipient: { raw: "daniel", kind: "alias", address: null, alias: "daniel" },
        memo: null,
        missingFields: [],
      },
      intentKind: "prepare_payment",
      summary: "Payment completed",
      transactionHash: FAKE_HASH,
      completed: true,
    };
    const deps = await makeProviderDeps(
      repo,
      async () =>
        new Response(
          JSON.stringify({
            object: "response",
            output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(hostile) }] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const input = agentInput("send 0.01 USDC to daniel");
    const result = await runAgentOrchestration({ agentInput: input, workspace, member }, deps);
    assert.equal(result.outcome, "failed");
    const reply = formatAgentServiceResult(result);
    assert.match(reply.text, /nothing moved/i);
    assertNoTruthClaims(reply.text, "hostile provider");
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);
  });
});

describe("agent truthfulness — status source of truth", () => {
  it("9-10. status for pending_approval says waiting for approval and never mentions proof or hashes", () => {
    const reply = formatAgentServiceResult({
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null },
    });
    assert.match(reply.text, /waiting for approval/i);
    assert.equal(/completed|executed|proof|transaction|0x[0-9a-fA-F]{40}/i.test(reply.text), false, reply.text);
  });

  it("11. status mentions completed only when the payout state is completed", () => {
    const completed: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "completed", itemCount: 1, completedAt: "2026-08-12T13:00:00.000Z" },
    };
    const pending: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null },
    };
    assert.match(formatAgentServiceResult(completed).text, /completed/i);
    assert.equal(/completed/i.test(formatAgentServiceResult(pending).text), false);
  });

  it("12-13. status never invents a transaction hash, even when the execution pipeline holds one", () => {
    const completed: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "completed", itemCount: 1, completedAt: "2026-08-12T13:00:00.000Z" },
    };
    const reply = formatAgentServiceResult(completed);
    assert.match(reply.text, /completed/i);
    assertNoTruthClaims(reply.text, "status completed");
  });

  it("14. status replies read from the payout pipeline, not from agent_runs", async () => {
    const { repo, workspace } = await makeWorkspaceFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_natural_language",
      status: "pending_approval",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: ADDRESS.toLowerCase(),
      amountBaseUnits: "10000",
      memo: null,
      status: "pending_approval",
      idempotencyKey: "truth:item:1",
    });
    const reply = await handleAgentGroupText(
      { user: user(), text: `check status ${payout.id}` },
      routingDeps(repo),
    );
    assert.ok(reply);
    assert.match(reply.text, /waiting for approval/i);
    const statusRun = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.ok(statusRun);
    assert.equal(statusRun.decision_type, "status_visible");
    assert.equal(statusRun.payout_id, null, "the status run links nothing");
  });

  it("15. a forged completed-looking agent_run does not affect the status reply", async () => {
    const { repo, workspace } = await makeWorkspaceFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_natural_language",
      status: "pending_approval",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    const forged = await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
    });
    await repo.updateAgentRun(forged.id, {
      status: "prepared",
      interpretationJson: {
        intent: { action: "pay", amount: "0.01" },
        intentKind: "prepare_payment",
        summary: `Payment completed with hash ${FAKE_HASH}`,
        provider: "static",
      },
      decisionJson: { decision: "prepared_payment", transactionHash: FAKE_HASH, completed: true },
    });
    const reply = await handleAgentGroupText(
      { user: user(), text: `check status ${payout.id}` },
      routingDeps(repo),
    );
    assert.ok(reply);
    assert.match(reply.text, /pending_approval/i);
    assert.match(reply.text, /waiting for approval/i);
    assert.equal(reply.text.includes(FAKE_HASH), false);
    assertNoTruthClaims(reply.text, "forged run status");
  });

  it("16. a forged run with fake hash text in redacted fields does not affect the status reply", async () => {
    const { repo, workspace } = await makeWorkspaceFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_natural_language",
      status: "pending_approval",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
      rawTextRedacted: `transaction_hash ${FAKE_HASH} keeperhub_execution_id ${FAKE_EXECUTION_ID}`,
      errorMessageRedacted: `completed with ${FAKE_HASH}`,
    });
    const reply = await handleAgentGroupText(
      { user: user(), text: `check status ${payout.id}` },
      routingDeps(repo),
    );
    assert.ok(reply);
    assert.match(reply.text, /waiting for approval/i);
    assertNoTruthClaims(reply.text, "forged redacted run");
  });

  it("20. the Telegram NL status route follows the same truth contract end to end", async () => {
    const { repo, workspace } = await makeWorkspaceFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_natural_language",
      status: "approved",
      totalAmountBaseUnits: "10000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    const item = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: ADDRESS.toLowerCase(),
      amountBaseUnits: "10000",
      memo: null,
      status: "completed",
      idempotencyKey: "truth:item:2",
    });
    await repo.transitionPayoutState(payout.id, ["approved"], "simulating");
    await repo.transitionPayoutState(payout.id, ["simulating"], "submitted");
    await repo.transitionPayoutState(payout.id, ["submitted"], "completed");
    const attempt = await repo.createExecutionAttempt({
      payoutItemId: item.item.id,
      attemptNumber: 1,
      phase: "execution",
      status: "succeeded",
    });
    await repo.updateExecutionAttempt(attempt.id, {
      status: "succeeded",
      transactionHash: FAKE_HASH,
      keeperhubExecutionId: FAKE_EXECUTION_ID,
      completedAt: "2026-08-12T13:00:00.000Z",
    });
    const reply = await handleAgentGroupText(
      { user: user(), text: `check status ${payout.id}` },
      routingDeps(repo),
    );
    assert.ok(reply);
    assert.match(reply.text, /completed/i);
    assert.equal(reply.text.includes(FAKE_HASH), false, "agent status must never surface the pipeline hash");
    assert.equal(reply.text.includes(FAKE_EXECUTION_ID), false);
    assertNoTruthClaims(reply.text, "routing completed status");
  });
  it("30. a prepared batch's status reads pending_approval from the payout row, not the run", async () => {
    const { repo } = await makeWorkspaceFixture();
    const batchReply = await handleAgentGroupText(
      { user: user(), text: "pay daniel and 0x1234567890abcdef1234567890abcdef12345678 0.01 USDC each" },
      routingDeps(repo),
    );
    assert.ok(batchReply);
    assert.match(batchReply.text, /approval required/i);
    const batchRun = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.ok(batchRun?.payout_id);
    const payout = await repo.getPayoutById(batchRun.payout_id);
    assert.equal(payout?.status, "pending_approval");
    const statusReply = await handleAgentGroupText(
      { user: user({ messageId: 43 }), text: `check status ${batchRun.payout_id}` },
      routingDeps(repo),
    );
    assert.ok(statusReply);
    assert.match(statusReply.text, /pending_approval/i);
    assert.match(statusReply.text, /waiting for approval/i);
    assertNoTruthClaims(statusReply.text, "batch status");
    assert.equal(repo.executionAttempts.size, 0);
  });
});

describe("agent truthfulness — run row and source contracts", () => {
  it("17. agent run rows never carry transaction_hash or keeperhub_execution_id fields", async () => {
    const { repo, workspace } = await makeWorkspaceFixture();
    const run = await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
    });
    assert.equal("transaction_hash" in run, false);
    assert.equal("keeperhub_execution_id" in run, false);
  });

  it("18. agent bridges import no execution service, KeeperHub, judge, or webhook modules", () => {
    for (const file of [
      "src/server/agent/bridges/prepare-payment.ts",
      "src/server/agent/bridges/create-claim-link.ts",
      "src/server/agent/bridges/status-result.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      const imports = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import"))
        .join("\n");
      for (const banned of ["execution-service", "keeperhub", "mcp-client", "judge", "webhook", "openai", "anthropic", "ai-sdk", "node:http"]) {
        assert.equal(imports.includes(banned), false, `${file} imports ${banned}`);
      }
    }
  });

  it("19. messages.ts cannot reach provider output or raw interpretations", () => {
    const source = readFileSync("src/server/agent/messages.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    // messages.ts only formats already-produced AgentServiceResult values; it
    // must never import the provider, interpreter, schema, extraction, or
    // planner modules (its only legitimate seam is the service result type).
    for (const banned of [
      "openai-compatible-interpreter",
      "providers/factory",
      "interpreter",
      "static-interpreter",
      "schema",
      "extraction",
      "planner",
      "provider",
    ]) {
      assert.equal(imports.includes(banned), false, `messages.ts imports ${banned}`);
    }
  });
});
