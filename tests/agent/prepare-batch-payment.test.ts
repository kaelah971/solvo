import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { hashAgentInput } from "../../src/server/agent/redact.ts";
import {
  PrepareBatchPaymentBridgeError,
  bridgePreparedBatchPayment,
  type PrepareBatchPaymentBridgeInput,
} from "../../src/server/agent/bridges/prepare-batch-payment.ts";
import { AGENT_TOOL_NAMES } from "../../src/server/agent/tools.ts";
import type { AgentPlannerDecision, PreparedBatchData } from "../../src/server/agent/planner.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";
import { parseCallbackData } from "../../src/server/telegram/community-messages.ts";

const BLOSSOM_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const ENDURANCE_ADDRESS = "0x234567890abcdef1234567890abcdef123456789";
const DANIEL_ADDRESS = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function batchData(overrides: Partial<PreparedBatchData> = {}): PreparedBatchData {
  return {
    recipients: [
      { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
      { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
    ],
    totalAmountBaseUnits: "20000",
    totalAmountDisplay: "0.02",
    currency: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS.toLowerCase(),
    approvalRequired: true,
    policyReason: "Community batch payouts require approval by an owner or approver.",
    perTxLimitUsdc: "1",
    remainingPerTxUsdc: "0.99",
    memo: null,
    mode: "uniform_each",
    source: "natural_language",
    warnings: [],
    ...overrides,
  };
}

function batchDecision(overrides: Partial<PreparedBatchData> = {}): AgentPlannerDecision {
  return { decision: "prepared_batch_payment", planAction: "prepare_batch_payment", batch: batchData(overrides) };
}

async function makeFixture(overrides: { member?: boolean; mode?: "community" | "judge" | "sandbox" } = {}) {
  const repo = new MemoryRepository();
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode: overrides.mode ?? "community",
    name: "Test WS",
    telegramChatId: "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  let member: WorkspaceMemberRow | null = null;
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
    member = (await repo.getWorkspaceMember(workspace.id, "123456")) as WorkspaceMemberRow;
  }
  const run: AgentRunRow = await repo.createAgentRun({
    workspaceId: workspace.id,
    surface: "telegram",
    telegramChatId: "-100777",
    telegramUserId: "123456",
    telegramMessageId: "42",
    idempotencyKey: "tg:-100777:m42:agent",
    provider: "static",
    inputHash: hashAgentInput("pay blossom and endurance 0.01 USDC each"),
    rawTextRedacted: "pay blossom and endurance 0.01 USDC each",
  });
  return { repo, workspace, member, run };
}

function inputFor(fixture: Awaited<ReturnType<typeof makeFixture>>, decision: AgentPlannerDecision): PrepareBatchPaymentBridgeInput {
  return {
    decision,
    run: fixture.run,
    workspace: fixture.workspace,
    member: fixture.member as WorkspaceMemberRow,
    userId: "123456",
  };
}

describe("prepare-batch-payment bridge", () => {
  it("1. creates one pending_approval payout with two pending_approval items (label memo)", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    assert.equal(result.outcome, "created");
    assert.equal(result.state, "pending_approval");
    assert.equal(result.itemCount, 2);
    assert.equal(result.totalAmountBaseUnits, "20000");
    const payout = await fixture.repo.getPayoutById(result.payoutId);
    assert.ok(payout);
    assert.equal(payout.status, "pending_approval");
    assert.equal(payout.requester_id, "123456");
    assert.equal(payout.total_amount_base_units, "20000");
    assert.equal(payout.currency_symbol, "USDC");
    assert.equal(payout.chain_id, "8453");
    assert.equal(payout.token_address, TOKEN_ADDRESS);
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.equal(items.length, 2);
    for (const item of items) {
      assert.equal(item.status, "pending_approval");
      assert.equal(item.transaction_hash, null);
      assert.equal(item.keeperhub_execution_id, null);
    }
    assert.deepEqual(items.map((item) => item.recipient_address).sort(), [BLOSSOM_ADDRESS, ENDURANCE_ADDRESS].sort());
    assert.deepEqual(items.map((item) => item.amount_base_units).sort(), ["10000", "10000"]);
    assert.deepEqual(items.map((item) => item.memo).sort(), ["blossom", "endurance"]);
  });

  it("2. persists normalized recipient addresses", async () => {
    const fixture = await makeFixture();
    const decision = batchDecision({
      recipients: [
        { label: "0x12345678…", address: "0x1234567890ABCDEF1234567890ABCDEF12345678", amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
        { label: "0x23456789…", address: "0x234567890ABCDEF1234567890ABCDEF123456789", amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
      ],
    });
    const result = await bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo });
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.deepEqual(items.map((item) => item.recipient_address).sort(), [BLOSSOM_ADDRESS, ENDURANCE_ADDRESS].sort());
  });

  it("3. three-recipient batch creates three items with total equal to the sum", async () => {
    const fixture = await makeFixture();
    const decision = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
        { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
        { label: "daniel", address: DANIEL_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
      ],
      totalAmountBaseUnits: "30000",
      totalAmountDisplay: "0.03",
    });
    const result = await bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo });
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.equal(items.length, 3);
    assert.equal(result.totalAmountBaseUnits, "30000");
    assert.equal(items.reduce((sum, item) => sum + BigInt(item.amount_base_units), 0n).toString(), "30000");
  });

  it("4. G2 split persists equal item amounts and preserves the total", async () => {
    const fixture = await makeFixture();
    const decision = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "25000", amountDisplay: "0.025", memo: null },
        { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "25000", amountDisplay: "0.025", memo: null },
      ],
      totalAmountBaseUnits: "50000",
      totalAmountDisplay: "0.05",
      mode: "split_equal",
    });
    const result = await bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo });
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.deepEqual(items.map((item) => item.amount_base_units), ["25000", "25000"]);
    assert.equal(result.totalAmountBaseUnits, "50000");
  });

  it("5. G3 explicit amounts persist differing per-item amounts", async () => {
    const fixture = await makeFixture();
    const decision = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
        { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "20000", amountDisplay: "0.02", memo: null },
      ],
      totalAmountBaseUnits: "30000",
      totalAmountDisplay: "0.03",
      mode: "explicit_amounts",
    });
    const result = await bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo });
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.deepEqual(items.map((item) => item.amount_base_units).sort(), ["10000", "20000"]);
    assert.equal(result.totalAmountBaseUnits, "30000");
  });

  it("6. stores the batch memo safely on the run record", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision({ memo: "the sprint" })), { repo: fixture.repo });
    assert.equal(result.memo, "the sprint");
    const run = await fixture.repo.getAgentRunById(fixture.run.id);
    assert.ok(run?.decision_json);
    assert.equal((run.decision_json as Record<string, unknown>).memo, "the sprint");
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.ok(items.every((item) => item.memo !== "the sprint"), "item memos stay recipient labels");
  });

  it("7. marks the payout source as the canonical telegram_batch type with NL source metadata", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    const payout = await fixture.repo.getPayoutById(result.payoutId);
    assert.equal(payout?.source_type, "telegram_batch");
    const requestAudits = fixture.repo.auditEvents.filter(
      (event) => event.payout_id === result.payoutId && event.event_type === "request_created",
    );
    assert.equal(requestAudits.length, 2);
    assert.ok(requestAudits.every((event) => (event.metadata as Record<string, unknown>).source === "telegram_natural_language_batch"));
  });

  it("8. writes per-item request_created audits and one approval_required audit", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    const events = fixture.repo.auditEvents.filter((event) => event.payout_id === result.payoutId);
    const requestCreated = events.filter((event) => event.event_type === "request_created");
    const approvalRequired = events.filter((event) => event.event_type === "approval_required");
    assert.equal(requestCreated.length, 2);
    assert.equal(approvalRequired.length, 1);
    const metadata = approvalRequired[0].metadata as Record<string, unknown>;
    assert.equal(metadata.itemCount, 2);
    assert.equal(metadata.totalBaseUnits, "20000");
    assert.equal(metadata.source, "telegram_natural_language_batch");
    assert.ok(requestCreated.every((event) => event.actor_type === "member" && event.actor_id === "123456"));
  });

  it("9-10. never emits approval/simulation/execution audits and never executes", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    const types = fixture.repo.auditEvents.map((event) => event.event_type);
    assert.equal(types.includes("approval_granted"), false);
    assert.equal(types.some((type) => type.startsWith("simulation_")), false);
    assert.equal(types.some((type) => type.startsWith("execution_")), false);
    assert.equal(fixture.repo.executionAttempts.size, 0);
    assert.equal((await fixture.repo.getPayoutById(result.payoutId))?.approved_at, null);
    assert.equal((await fixture.repo.getPayoutById(result.payoutId))?.completed_at, null);
  });

  it("11. links the agent run to the payout with claim_id null and status prepared", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    const run = await fixture.repo.getAgentRunById(fixture.run.id);
    assert.ok(run);
    assert.equal(run.payout_id, result.payoutId);
    assert.equal(run.claim_id, null);
    assert.equal(run.status, "prepared");
    assert.equal(run.decision_type, "prepared_batch_payment");
    assert.equal("transaction_hash" in run, false);
    assert.equal("keeperhub_execution_id" in run, false);
  });

  it("12. duplicate delivery returns the same payout with no duplicate items or audits", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, batchDecision());
    const first = await bridgePreparedBatchPayment(input, { repo: fixture.repo });
    const second = await bridgePreparedBatchPayment(input, { repo: fixture.repo });
    assert.equal(second.outcome, "existing");
    assert.equal(second.payoutId, first.payoutId);
    assert.equal((await fixture.repo.getPayoutItemsByPayoutId(first.payoutId)).length, 2);
    const requestAudits = fixture.repo.auditEvents.filter(
      (event) => event.payout_id === first.payoutId && event.event_type === "request_created",
    );
    assert.equal(requestAudits.length, 2);
  });

  it("13. concurrent duplicates resolve to exactly one payout", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, batchDecision());
    const results = await Promise.all([
      bridgePreparedBatchPayment(input, { repo: fixture.repo }),
      bridgePreparedBatchPayment(input, { repo: fixture.repo }),
    ]);
    const created = results.filter((result) => result.outcome === "created");
    const existing = results.filter((result) => result.outcome === "existing");
    assert.equal(created.length, 1);
    assert.equal(existing.length, 1);
    assert.equal(created[0].payoutId, existing[0].payoutId);
    assert.equal((await fixture.repo.getPayoutItemsByPayoutId(created[0].payoutId)).length, 2);
  });

  it("13b. duplicate delivery after the payout state changed reads the current state truthfully", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, batchDecision());
    const first = await bridgePreparedBatchPayment(input, { repo: fixture.repo });
    await fixture.repo.transitionPayoutState(first.payoutId, ["pending_approval"], "approved");
    const second = await bridgePreparedBatchPayment(input, { repo: fixture.repo });
    assert.equal(second.outcome, "existing");
    assert.equal(second.payoutId, first.payoutId);
    assert.equal(second.state, "approved");
    assert.equal(second.approvalRequired, false);
    assert.equal((await fixture.repo.getPayoutItemsByPayoutId(first.payoutId)).length, 2);
  });

  it("14. rejects non-prepared_batch_payment decisions with no artifact", async () => {
    const fixture = await makeFixture();
    for (const decision of [
      { decision: "blocked", planAction: "decline_unsupported", reason: "no" },
      { decision: "ask_clarifying_question", planAction: "ask_clarifying_question", missingFields: ["amount"], question: "?" },
      { decision: "prepared_payment", planAction: "prepare_payment", prepared: { recipientAddress: DANIEL_ADDRESS, recipientAlias: null, amountBaseUnits: "10000", currency: "USDC", chainId: "8453", tokenAddress: TOKEN_ADDRESS, memo: null, approvalRequired: true, policyReason: "x", perTxLimitUsdc: null, remainingPerTxUsdc: null } },
      { decision: "unsupported", planAction: "decline_unsupported", reason: "no" },
    ] as AgentPlannerDecision[]) {
      await assert.rejects(
        () => bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo }),
        (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_decision",
      );
    }
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
  });

  it("15. policy-denied batches create no artifact", async () => {
    const fixture = await makeFixture();
    const overLimit = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "5000000", amountDisplay: "5", memo: null },
        { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "5000000", amountDisplay: "5", memo: null },
      ],
      totalAmountBaseUnits: "10000000",
      totalAmountDisplay: "10",
    });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, overLimit), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "policy_blocked",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);

    // Daily limit: pre-seeded completed spend pushes the batch over the cap.
    const seeded = await makeFixture();
    const payout = await seeded.repo.createPayout({
      workspaceId: seeded.workspace.id,
      requesterId: "123456",
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: "9500000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
    });
    await seeded.repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: DANIEL_ADDRESS,
      amountBaseUnits: "9500000",
      memo: null,
      status: "completed",
      idempotencyKey: "daily:seed",
    });
    const dailyBatch = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "500000", amountDisplay: "0.5", memo: null },
        { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "500000", amountDisplay: "0.5", memo: null },
      ],
      totalAmountBaseUnits: "1000000",
      totalAmountDisplay: "1",
    });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(seeded, dailyBatch), { repo: seeded.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "policy_blocked",
    );
    assert.equal(await seeded.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
  });

  it("16. duplicate recipient addresses in the payload create no artifact", async () => {
    const fixture = await makeFixture();
    const decision = batchDecision({
      recipients: [
        { label: "blossom", address: BLOSSOM_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
        { label: "blossom2", address: BLOSSOM_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null },
      ],
      totalAmountBaseUnits: "20000",
      totalAmountDisplay: "0.02",
    });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, decision), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
  });

  it("17. more than ten recipients or malformed items create no artifact", async () => {
    const fixture = await makeFixture();
    const tooMany = batchDecision({
      recipients: Array.from({ length: 11 }, (_, i) => ({
        label: `r${i}`,
        address: `0x${(i + 10).toString(16).padStart(40, "0")}`,
        amountBaseUnits: "10000",
        amountDisplay: "0.01",
        memo: null,
      })),
      totalAmountBaseUnits: "110000",
      totalAmountDisplay: "0.11",
    });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, tooMany), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () =>
        bridgePreparedBatchPayment(
          inputFor(fixture, batchDecision({ recipients: [{ label: "bad", address: "0x1234", amountBaseUnits: "10000", amountDisplay: "0.01", memo: null }, { label: "endurance", address: ENDURANCE_ADDRESS, amountBaseUnits: "10000", amountDisplay: "0.01", memo: null }] })),
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () =>
        bridgePreparedBatchPayment(
          inputFor(fixture, batchDecision({ totalAmountBaseUnits: "30000" })),
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
  });

  it("blocks a judge-mode workspace", async () => {
    const fixture = await makeFixture({ mode: "judge" });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "judge_blocked",
    );
  });

  it("blocks a sandbox-mode workspace", async () => {
    const fixture = await makeFixture({ mode: "sandbox" });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "community_only",
    );
  });

  it("blocks missing workspace context", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedBatchPayment(
          { ...inputFor(fixture, batchDecision()), workspace: null as never },
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "workspace_required",
    );
  });

  it("blocks missing membership and never creates a payout", async () => {
    const fixture = await makeFixture({ member: false });
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "member_required",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:batch:0"), null);
  });

  it("blocks a chain or token mismatch in the decision payload", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () => bridgePreparedBatchPayment(inputFor(fixture, batchDecision({ chainId: "42220" })), { repo: fixture.repo }),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () =>
        bridgePreparedBatchPayment(
          inputFor(fixture, batchDecision({ tokenAddress: "0x0000000000000000000000000000000000000001" })),
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PrepareBatchPaymentBridgeError && error.code === "invalid_payload",
    );
  });

  it("returns approval callback metadata from the existing safe builder", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    assert.equal(result.buttons.length, 2);
    assert.equal(result.buttons[0].text, "APPROVE BATCH");
    assert.equal(result.buttons[1].text, "REJECT");
    const parsed = parseCallbackData(result.buttons[0].callbackData);
    assert.ok(parsed);
    assert.equal("payoutId" in parsed && parsed.payoutId, result.payoutId);
  });

  it("creates a fresh payout per distinct agent run", async () => {
    const fixture = await makeFixture();
    const first = await bridgePreparedBatchPayment(inputFor(fixture, batchDecision()), { repo: fixture.repo });
    const otherRun = await fixture.repo.createAgentRun({
      workspaceId: fixture.workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "43",
      idempotencyKey: "tg:-100777:m43:agent",
      provider: "static",
      inputHash: hashAgentInput("pay blossom and endurance 0.01 USDC each"),
    });
    const second = await bridgePreparedBatchPayment({ ...inputFor(fixture, batchDecision()), run: otherRun }, { repo: fixture.repo });
    assert.notEqual(second.payoutId, first.payoutId);
  });

  it("28. bridge file imports no execution or KeeperHub modules", () => {
    const source = readFileSync("src/server/agent/bridges/prepare-batch-payment.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "webhook", "node:http", "openai", "anthropic", "ai-sdk"]) {
      assert.equal(imports.includes(forbidden), false, forbidden);
    }
    assert.equal(/fetch\(/.test(source), false);
  });

  it("is not registered as a model-facing agent tool", () => {
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("prepare_batch_payment"), false);
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("execute_batch"), false);
  });
});
