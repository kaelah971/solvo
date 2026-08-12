import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { hashAgentInput } from "../../src/server/agent/redact.ts";
import {
  PreparePaymentBridgeError,
  bridgePreparedPayment,
  type PreparePaymentBridgeInput,
} from "../../src/server/agent/bridges/prepare-payment.ts";
import { AGENT_TOOL_NAMES } from "../../src/server/agent/tools.ts";
import type { AgentPlannerDecision, PreparedPaymentData } from "../../src/server/agent/planner.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";
import { parseCallbackData } from "../../src/server/telegram/community-messages.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const ADDRESS_LOWER = ADDRESS.toLowerCase();
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function preparedData(overrides: Partial<PreparedPaymentData> = {}): PreparedPaymentData {
  return {
    recipientAddress: ADDRESS_LOWER,
    recipientAlias: "daniel",
    amountBaseUnits: "10000",
    currency: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS.toLowerCase(),
    memo: "for design work",
    approvalRequired: true,
    policyReason: "Community payouts require approval by an owner or approver.",
    perTxLimitUsdc: "1",
    remainingPerTxUsdc: "0.99",
    ...overrides,
  };
}

function preparedDecision(overrides: Partial<PreparedPaymentData> = {}): AgentPlannerDecision {
  return { decision: "prepared_payment", planAction: "prepare_payment", prepared: preparedData(overrides) };
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
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: ADDRESS, createdBy: "1" });
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
    inputHash: hashAgentInput("pay daniel 0.01 USDC"),
    rawTextRedacted: "pay daniel 0.01 USDC",
  });
  return { repo, workspace, member, run };
}

function inputFor(fixture: Awaited<ReturnType<typeof makeFixture>>, decision: AgentPlannerDecision): PreparePaymentBridgeInput {
  return {
    decision,
    run: fixture.run,
    workspace: fixture.workspace,
    member: fixture.member as WorkspaceMemberRow,
    userId: "123456",
  };
}

describe("prepare-payment bridge", () => {
  it("creates exactly one payout and one payout_item in pending_approval", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    assert.equal(result.outcome, "created");
    assert.equal(result.state, "pending_approval");
    const payout = await fixture.repo.getPayoutById(result.payoutId);
    assert.ok(payout);
    assert.equal(payout.status, "pending_approval");
    assert.equal(payout.requester_id, "123456");
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "pending_approval");
    assert.equal(items[0].recipient_address, ADDRESS_LOWER);
    assert.equal(items[0].amount_base_units, "10000");
    assert.equal(items[0].memo, "for design work");
    assert.equal(result.itemId, items[0].id);
    assert.equal(result.memo, "for design work");
  });

  it("persists memo null on the payout item when no memo is provided", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision({ memo: null })), { repo: fixture.repo });
    const items = await fixture.repo.getPayoutItemsByPayoutId(result.payoutId);
    assert.equal(items[0].memo, null);
    assert.equal(result.memo, null);
  });

  it("marks the payout as approval-required without approving", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    assert.equal(result.approvalRequired, true);
    const payout = await fixture.repo.getPayoutById(result.payoutId);
    assert.equal(payout?.status, "pending_approval");
    const audit = fixture.repo.auditEvents.filter((event) => event.payout_id === result.payoutId);
    const eventTypes = audit.map((event) => event.event_type);
    assert.equal(eventTypes.includes("request_created"), true);
    assert.equal(eventTypes.includes("approval_required"), true);
    assert.equal(eventTypes.includes("approval_granted"), false);
  });

  it("never stores a transaction hash or execution id", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    const keys = Object.keys(result);
    assert.equal(keys.includes("transactionHash"), false);
    assert.equal(keys.includes("keeperhubExecutionId"), false);
    assert.equal(keys.includes("executionId"), false);
    const run = await fixture.repo.getAgentRunById(fixture.run.id);
    assert.equal(run?.payout_id, result.payoutId);
    assert.equal("transaction_hash" in run, false);
  });

  it("applies existing community policy: blocks over-limit amounts", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedPayment(
          inputFor(fixture, preparedDecision({ amountBaseUnits: "2000000", policyReason: "above limit" })),
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "policy_blocked",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey(`ag:${fixture.run.idempotency_key}:prepare`), null);
  });

  it("does not self-approve the requester", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    const payout = await fixture.repo.getPayoutById(result.payoutId);
    assert.equal(payout?.requester_id, "123456");
    assert.equal(payout?.status, "pending_approval");
  });

  it("blocks a judge-mode workspace", async () => {
    const fixture = await makeFixture({ mode: "judge" });
    await assert.rejects(
      () => bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "judge_blocked",
    );
  });

  it("blocks a sandbox-mode workspace", async () => {
    const fixture = await makeFixture({ mode: "sandbox" });
    await assert.rejects(
      () => bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "community_only",
    );
  });

  it("blocks missing workspace context", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedPayment(
          { ...inputFor(fixture, preparedDecision()), workspace: null as never },
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "workspace_required",
    );
  });

  it("blocks missing membership and never creates a public payout", async () => {
    const fixture = await makeFixture({ member: false });
    await assert.rejects(
      () => bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "member_required",
    );
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey(`ag:${fixture.run.idempotency_key}:prepare`), null);
  });

  it("blocks an unsupported chain or token in the decision payload", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedPayment(inputFor(fixture, preparedDecision({ chainId: "42220" })), { repo: fixture.repo }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () =>
        bridgePreparedPayment(
          inputFor(fixture, preparedDecision({ tokenAddress: "0x0000000000000000000000000000000000000001" })),
          { repo: fixture.repo },
        ),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () => bridgePreparedPayment(inputFor(fixture, preparedDecision({ amountBaseUnits: "abc" })), { repo: fixture.repo }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "invalid_payload",
    );
    await assert.rejects(
      () =>
        bridgePreparedPayment(inputFor(fixture, preparedDecision({ recipientAddress: "0x1234" })), {
          repo: fixture.repo,
        }),
      (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "invalid_payload",
    );
  });

  it("returns the existing payout on duplicate idempotency without duplicating items", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, preparedDecision());
    const first = await bridgePreparedPayment(input, { repo: fixture.repo });
    const second = await bridgePreparedPayment(input, { repo: fixture.repo });
    assert.equal(second.outcome, "existing");
    assert.equal(second.payoutId, first.payoutId);
    assert.equal(second.itemId, first.itemId);
    assert.equal((await fixture.repo.getPayoutItemsByPayoutId(first.payoutId)).length, 1);
  });

  it("does not duplicate audit events on duplicate idempotency", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, preparedDecision());
    const first = await bridgePreparedPayment(input, { repo: fixture.repo });
    await bridgePreparedPayment(input, { repo: fixture.repo });
    const requestAudits = fixture.repo.auditEvents.filter(
      (event) => event.payout_id === first.payoutId && event.event_type === "request_created",
    );
    assert.equal(requestAudits.length, 1);
  });

  it("links the agent run to the payout with an agent-specific status", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    const run = await fixture.repo.getAgentRunById(fixture.run.id);
    assert.ok(run);
    assert.equal(run.payout_id, result.payoutId);
    assert.equal(run.status, "prepared");
    assert.notEqual(run.completed_at, null);
    const payoutStates = ["approved", "pending_approval", "simulating", "submitted", "confirming", "completed", "execution_unknown"];
    assert.equal(payoutStates.includes(run.status), false);
  });

  it("returns approval callback metadata from the existing safe builder", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    assert.equal(result.buttons.length, 2);
    assert.equal(result.buttons[0].text, "APPROVE");
    assert.equal(result.buttons[1].text, "REJECT");
    const parsed = parseCallbackData(result.buttons[0].callbackData);
    assert.ok(parsed);
    assert.equal("payoutId" in parsed && parsed.payoutId, result.payoutId);
  });

  it("rejects non-prepared_payment planner decisions", async () => {
    const fixture = await makeFixture();
    for (const decision of [
      { decision: "blocked", planAction: "decline_unsupported", reason: "no" },
      { decision: "ask_clarifying_question", planAction: "ask_clarifying_question", missingFields: ["amount"], question: "?" },
      { decision: "prepared_claim_link", planAction: "create_claim_link", prepared: { source: "claim_request", amountBaseUnits: "50000", currency: "USDC", chainId: "8453", tokenAddress: TOKEN_ADDRESS, expiryHours: 168 } },
      { decision: "unsupported", planAction: "decline_unsupported", reason: "no" },
    ] as AgentPlannerDecision[]) {
      await assert.rejects(
        () => bridgePreparedPayment(inputFor(fixture, decision), { repo: fixture.repo }),
        (error: unknown) => error instanceof PreparePaymentBridgeError && error.code === "invalid_decision",
      );
    }
  });

  it("creates a fresh payout per distinct agent run", async () => {
    const fixture = await makeFixture();
    const first = await bridgePreparedPayment(inputFor(fixture, preparedDecision()), { repo: fixture.repo });
    const otherRun = await fixture.repo.createAgentRun({
      workspaceId: fixture.workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "43",
      idempotencyKey: "tg:-100777:m43:agent",
      provider: "static",
      inputHash: hashAgentInput("pay daniel 0.01 USDC"),
    });
    const second = await bridgePreparedPayment({ ...inputFor(fixture, preparedDecision()), run: otherRun }, { repo: fixture.repo });
    assert.notEqual(second.payoutId, first.payoutId);
  });

  it("bridge file imports no execution or KeeperHub modules", () => {
    const source = readFileSync("src/server/agent/bridges/prepare-payment.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "node:http"]) {
      assert.equal(imports.includes(forbidden), false, forbidden);
    }
    assert.equal(/fetch\(/.test(source), false);
  });

  it("is not registered as a model-facing agent tool", () => {
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("prepare_payment"), false);
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("request_approval"), false);
  });
});
