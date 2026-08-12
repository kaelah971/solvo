import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import { AGENT_TOOL_NAMES, validateAgentToolCall } from "../../src/server/agent/tools.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const FAKE_HASH = "0x" + "ab".repeat(32);
const FAKE_EXECUTION_ID = "keeperhub-exec-1234567890";
const BATCH_PHRASE = "pay blossom and endurance 0.01 USDC each";

const HEX_HASH_PATTERN = /0x[0-9a-fA-F]{64}/;
const BANNED_INTERNAL = [
  "tool",
  "planner",
  "candidate",
  "schema",
  "llm",
  "model",
  "provider",
  "interpreter",
  "extraction",
  "agent_run",
  "json",
  "raw",
  "stack",
  "trace",
  "typeerror",
  "sql",
  "execution service",
  "prepare_batch_payment",
  "intentKind",
  "decisionJson",
  "keeperhub_execution_id",
  "transactionHash",
  "resolve_recipient",
  "inspect_payment_policy",
  "inspect_payment_status",
  "validate_claim_request",
];
const BANNED_SECRETS = ["kh_", "sk-", "BEGIN PRIVATE KEY", "postgres://", "TELEGRAM_BOT_TOKEN", "DATABASE_URL", "apiKey"];

function assertNoTruthClaims(text: string, label: string): void {
  assert.equal(HEX_HASH_PATTERN.test(text), false, `${label}: contains a tx-hash-shaped string`);
  assert.equal(/transaction/i.test(text), false, `${label}: mentions a transaction`);
  assert.equal(text.includes(FAKE_HASH), false, `${label}: leaks a tx hash`);
  assert.equal(text.includes(FAKE_EXECUTION_ID), false, `${label}: leaks an execution id`);
  assert.equal(/proof/i.test(text), false, `${label}: claims proof`);
  assert.equal(/executed/i.test(text), false, `${label}: says executed`);
  assert.equal(/\bsent\b|\btransferred\b|\bpaid\b/i.test(text), false, `${label}: claims a completed transfer`);
  for (const banned of BANNED_INTERNAL) {
    assert.equal(text.toLowerCase().includes(banned.toLowerCase()), false, `${label}: contains ${banned}`);
  }
  for (const banned of BANNED_SECRETS) {
    assert.equal(text.toLowerCase().includes(banned.toLowerCase()), false, `${label}: contains ${banned}`);
  }
  assert.equal(text.includes("{"), false, `${label}: looks like raw JSON`);
  assert.equal(text.includes("\\n\""), false, `${label}: looks like raw JSON`);
}

function user(messageId = 1): TelegramUser {
  return { userId: "123456", chatId: "-100777", chatType: "supergroup", messageId, updateId: 1 };
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
  await repo.addRecipient({ workspaceId: workspace.id, alias: "blossom", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", createdBy: "1" });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "endurance", walletAddress: "0x234567890abcdef1234567890abcdef123456789", createdBy: "1" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  return { repo, workspace, member: await repo.getWorkspaceMember(workspace.id, "123456") };
}

function depsFor(repo: MemoryRepository): AgentFlowDeps {
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
  };
}

async function prepareBatch(repo: MemoryRepository): Promise<{ reply: { text: string; buttons?: Array<{ text: string; callbackData: string }> }; payoutId: string }> {
  const reply = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, depsFor(repo));
  assert.ok(reply);
  const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
  assert.ok(run?.payout_id);
  return { reply, payoutId: run.payout_id };
}

describe("M10.7 batch truthfulness — prepared reply", () => {
  it("1-14. a fresh prepared batch reply is fully truthful with safe copy", async () => {
    const { repo } = await makeFixture();
    const { reply, payoutId } = await prepareBatch(repo);
    assert.match(reply.text, /BATCH PAYMENT REQUEST PREPARED/i);
    assert.match(reply.text, /APPROVAL REQUIRED/i);
    assert.match(reply.text, /no funds have moved/i);
    assert.match(reply.text, /owner or approver must approve before anything executes/i);
    assert.match(reply.text, /keeperhub execution happens only after approval/i);
    assert.match(reply.text, /blossom/i);
    assert.match(reply.text, /endurance/i);
    assert.match(reply.text, /0\.01 USDC/i);
    assert.match(reply.text, /0\.02 USDC/i);
    assert.ok(reply.text.includes(payoutId));
    assert.equal(reply.buttons?.length, 2);
    assert.equal(reply.buttons?.[0].text, "APPROVE BATCH");
    assert.equal(reply.buttons?.[1].text, "REJECT");
    assertNoTruthClaims(reply.text, "prepared batch");
  });

  it("memo is echoed safely when present and omitted otherwise", async () => {
    const { repo } = await makeFixture();
    const withMemo = await handleAgentGroupText(
      { user: user(), text: "pay blossom and endurance 0.01 USDC each for the sprint" },
      depsFor(repo),
    );
    assert.ok(withMemo);
    assert.match(withMemo.text, /the sprint/i);
    assertNoTruthClaims(withMemo.text, "batch with memo");

    const { repo: repo2 } = await makeFixture();
    const withoutMemo = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, depsFor(repo2));
    assert.ok(withoutMemo);
    assert.equal(withoutMemo.text.includes("MEMO"), false);
    assertNoTruthClaims(withoutMemo.text, "batch without memo");
  });
});

describe("M10.7 batch truthfulness — duplicate delivery", () => {
  it("15-18. duplicate delivery says ALREADY PREPARED, reads the payout row, and creates nothing", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const first = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, deps);
    assert.ok(first);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    const itemCountAfterFirst = (await repo.getPayoutItemsByPayoutId(run.payout_id)).length;
    const auditsAfterFirst = repo.auditEvents.filter((event) => event.payout_id === run.payout_id).length;

    const second = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, deps);
    assert.ok(second);
    assert.match(second.text, /BATCH PAYMENT REQUEST ALREADY PREPARED/i);
    assert.match(second.text, /PENDING_APPROVAL/i);
    assert.match(second.text, /no funds have moved/i);
    assert.ok(second.text.includes(run.payout_id), "duplicate shows the payout id from the row");
    assert.equal(second.buttons, undefined);
    assert.equal((await repo.getPayoutItemsByPayoutId(run.payout_id)).length, itemCountAfterFirst);
    assert.equal(repo.auditEvents.filter((event) => event.payout_id === run.payout_id).length, auditsAfterFirst);
    assert.equal(repo.executionAttempts.size, 0);
    assertNoTruthClaims(second.text, "duplicate batch");
  });

  it("19. duplicate after approval is truthful and never says no funds moved", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const first = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, deps);
    assert.ok(first);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    await repo.transitionPayoutState(run.payout_id, ["pending_approval"], "approved");

    const second = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, deps);
    assert.ok(second);
    assert.match(second.text, /ALREADY PREPARED/i);
    assert.match(second.text, /APPROVED/i);
    assert.match(second.text, /currently approved/i);
    assert.equal(/no funds have moved/i.test(second.text), false, "must not claim pending facts after approval");
    assert.equal(repo.executionAttempts.size, 0);
    assertNoTruthClaims(second.text, "duplicate approved batch");
  });
});

describe("M10.7 batch truthfulness — status source of truth", () => {
  it("20. status of a prepared batch reads the payout row, not the agent run", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const prepared = await handleAgentGroupText({ user: user(), text: BATCH_PHRASE }, deps);
    assert.ok(prepared);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);
    const payout = await repo.getPayoutById(run.payout_id);
    assert.equal(payout?.status, "pending_approval");

    const status = await handleAgentGroupText({ user: user(2), text: `check status ${run.payout_id}` }, deps);
    assert.ok(status);
    assert.match(status.text, /pending_approval/i);
    assert.match(status.text, /waiting for approval/i);
    assertNoTruthClaims(status.text, "batch status");
  });

  it("21-22. a forged agent_run claiming completion with a fake hash cannot change the status reply", async () => {
    const { repo, workspace } = await makeFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountBaseUnits: "10000",
      memo: "blossom",
      status: "pending_approval",
      idempotencyKey: "forged:item:0",
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
        intent: { action: "batch_pay" },
        intentKind: "prepare_batch_payment",
        summary: `Batch completed with hash ${FAKE_HASH}`,
        provider: "static",
      },
      decisionJson: { decision: "prepared_batch_payment", transactionHash: FAKE_HASH, keeperhubExecutionId: FAKE_EXECUTION_ID, completed: true },
    });

    const reply = await handleAgentGroupText({ user: user(), text: `check status ${payout.id}` }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /pending_approval/i);
    assert.match(reply.text, /waiting for approval/i);
    assert.equal(reply.text.includes(FAKE_HASH), false);
    assert.equal(reply.text.includes(FAKE_EXECUTION_ID), false);
    assertNoTruthClaims(reply.text, "forged batch run status");
  });

  it("23-24. completion appears only when the payout row is completed, and hashes are never invented", async () => {
    const { repo, workspace } = await makeFixture();
    const payout = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: "123456",
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    const item = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountBaseUnits: "10000",
      memo: "blossom",
      status: "pending_approval",
      idempotencyKey: "completed:item:0",
    });
    const pendingReply = await handleAgentGroupText({ user: user(1), text: `check status ${payout.id}` }, depsFor(repo));
    assert.ok(pendingReply);
    assert.equal(/completed/i.test(pendingReply.text), false, "no completion before the payout row says so");

    await repo.transitionPayoutState(payout.id, ["pending_approval"], "approved");
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

    const completedReply = await handleAgentGroupText({ user: user(2), text: `check status ${payout.id}` }, depsFor(repo));
    assert.ok(completedReply);
    assert.match(completedReply.text, /completed/i);
    assert.equal(completedReply.text.includes(FAKE_HASH), false, "the pipeline hash is never surfaced");
    assert.equal(completedReply.text.includes(FAKE_EXECUTION_ID), false);
    assertNoTruthClaims(completedReply.text, "completed batch status");
  });
});

describe("M10.7 batch source contracts", () => {
  it("the batch bridge imports no KeeperHub client, MCP, execution, judge, webhook, or model modules and uses no fetch", () => {
    const source = readFileSync("src/server/agent/bridges/prepare-batch-payment.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of ["keeperhub", "mcp-client", "execution-service", "judge", "webhook", "openai", "anthropic", "ai-sdk", "node:http"]) {
      assert.equal(imports.includes(banned), false, `bridge imports ${banned}`);
    }
    assert.equal(/fetch\(/.test(source), false, "bridge calls fetch");
  });

  it("the batch bridge uses the repository abstraction with no raw SQL", () => {
    const source = readFileSync("src/server/agent/bridges/prepare-batch-payment.ts", "utf8");
    assert.equal(/\bsql`/.test(source), false, "bridge uses tagged SQL");
    assert.equal(/pool\.query|\.execute\(|query\(/i.test(source), false, "bridge runs raw queries");
    assert.equal(/createClient|pg\./i.test(source), false, "bridge creates DB clients");
  });

  it("the planner imports no execution service or KeeperHub modules", () => {
    const source = readFileSync("src/server/agent/planner.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of ["execution-service", "keeperhub", "mcp-client", "judge", "node:http"]) {
      assert.equal(imports.includes(banned), false, `planner imports ${banned}`);
    }
  });

  it("messages.ts cannot reach provider output, interpreter, schema, or planner internals", () => {
    const source = readFileSync("src/server/agent/messages.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of ["openai-compatible-interpreter", "providers/factory", "interpreter", "static-interpreter", "schema", "extraction", "planner", "provider"]) {
      assert.equal(imports.includes(banned), false, `messages.ts imports ${banned}`);
    }
  });

  it("provider files do not import the batch bridge, and the bridge is not a model-facing tool", () => {
    for (const file of ["src/server/agent/providers/factory.ts"]) {
      const source = readFileSync(file, "utf8");
      const imports = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import"))
        .join("\n");
      assert.equal(imports.includes("prepare-batch-payment"), false, `${file} imports the batch bridge`);
    }
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("prepare_batch_payment"), false);
    assert.equal(validateAgentToolCall("prepare_batch_payment", {}).ok, false);
    assert.equal(validateAgentToolCall("execute_batch", {}).ok, false);
  });
});

describe("M10.7 batch regressions", () => {
  it("single-recipient NL payment, claim links, and status still work", async () => {
    const { repo, workspace } = await makeFixture();
    const deps = depsFor(repo);
    const payment = await handleAgentGroupText({ user: user(), text: "pay blossom 0.01 USDC" }, deps);
    assert.ok(payment);
    assert.match(payment.text, /PAYMENT REQUEST PREPARED/i);
    assert.match(payment.text, /approval required/i);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
    assert.ok(run?.payout_id);

    const claim = await handleAgentGroupText({ user: user(2), text: "create a claim link for 0.05 USDC" }, deps);
    assert.ok(claim);
    assert.match(claim.text, /CLAIM LINK CREATED/i);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 1);

    const status = await handleAgentGroupText({ user: user(3), text: `check status ${run.payout_id}` }, deps);
    assert.ok(status);
    assert.match(status.text, /pending_approval/i);
    assertNoTruthClaims(status.text, "regression status");
  });

  it("unsupported tokens/chains, judge NL, slash commands, DM, and disabled mode stay blocked", async () => {
    const { repo, workspace } = await makeFixture();
    const deps = depsFor(repo);
    const token = await handleAgentGroupText({ user: user(), text: "pay blossom and endurance 0.01 ETH each" }, deps);
    assert.ok(token);
    assert.match(token.text, /couldn't safely|blocked/i);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:batch:0"), null);

    const judgeLike = await handleAgentGroupText({ user: user(2), text: "judgepay blossom and endurance 0.01 USDC each" }, deps);
    assert.ok(judgeLike);
    assert.equal(judgeLike.text.includes("judgepay"), false);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m2:judgepay"), null);

    for (const command of ["/batch blossom 0.01 USDC", "/pay 0x742d35cc6634c0532925a3b844bc454e4438f44e 0.01 USDC"]) {
      const slash = await handleAgentGroupText({ user: user(3), text: command }, deps);
      assert.equal(slash, null, command);
    }

    const dm = await handleAgentGroupText(
      { user: { userId: "123456", chatId: "999999999", chatType: "supergroup", messageId: 4, updateId: 1 }, text: BATCH_PHRASE },
      deps,
    );
    assert.equal(dm, null);

    const disabled = await handleAgentGroupText({ user: user(5), text: BATCH_PHRASE }, { ...deps, config: getAgentConfig({}) });
    assert.equal(disabled, null);
    assert.equal(repo.executionAttempts.size, 0);
    assert.equal(repo.auditEvents.some((event) => event.event_type === "approval_granted"), false);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0);
  });

  it("batch cap, duplicates, and policy failures still block with zero execution", async () => {
    const { repo } = await makeFixture();
    const deps = depsFor(repo);
    const addresses = Array.from({ length: 11 }, (_, i) => `0x${(i + 10).toString(16).padStart(40, "0")}`);
    const overCap = await handleAgentGroupText({ user: user(), text: `send 0.01 USDC each to ${addresses.join(", ")}` }, deps);
    assert.ok(overCap);
    assert.match(overCap.text, /one more detail|couldn't safely/i);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:batch:0"), null);

    const overLimit = await handleAgentGroupText({ user: user(2), text: "pay blossom and endurance 5 USDC each" }, deps);
    assert.ok(overLimit);
    assert.match(overLimit.text, /BLOCKED|limit/i);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m2:agent:batch:0"), null);

    const first = await handleAgentGroupText({ user: user(3), text: BATCH_PHRASE }, deps);
    assert.ok(first);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m3:agent");
    assert.ok(run?.payout_id);
    const second = await handleAgentGroupText({ user: user(3), text: BATCH_PHRASE }, deps);
    assert.ok(second);
    assert.match(second.text, /ALREADY PREPARED/i);
    assert.equal((await repo.getPayoutItemsByPayoutId(run.payout_id)).length, 2);
    assert.equal(repo.executionAttempts.size, 0);
  });
});
