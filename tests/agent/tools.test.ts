import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import {
  AGENT_TOOL_NAMES,
  executeAgentTool,
  getAgentTool,
  inspectPaymentPolicyTool,
  inspectPaymentStatusTool,
  listAgentToolSpecs,
  resolveRecipientTool,
  validateAgentToolCall,
  validateClaimRequestTool,
  type AgentToolContext,
} from "../../src/server/agent/tools.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const ADDRESS_LOWER = ADDRESS.toLowerCase();
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

async function makeContext(overrides: { member?: boolean; workspace?: boolean } = {}): Promise<{
  repo: MemoryRepository;
  context: AgentToolContext;
}> {
  const repo = new MemoryRepository();
  const workspace = overrides.workspace === false
    ? null
    : await repo.createWorkspace({
        mode: "community",
        name: "Test WS",
        telegramChatId: "-100777",
        chainId: "8453",
        tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        perTransactionLimitBaseUnits: "1000000",
        dailyLimitBaseUnits: "10000000",
        approvalPolicy: "approval_required",
        status: "active",
      });
  if (workspace) {
    await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: ADDRESS, createdBy: "1" });
    if (overrides.member !== false) {
      await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
    }
  }
  const member = workspace && overrides.member !== false
    ? await repo.getWorkspaceMember(workspace.id, "123456")
    : null;
  return { repo, context: { repo, workspace, member, userId: "123456" } };
}

describe("agent tool registry", () => {
  it("lists exactly the four allowed tools", () => {
    assert.deepEqual([...AGENT_TOOL_NAMES].sort(), [
      "inspect_payment_policy",
      "inspect_payment_status",
      "resolve_recipient",
      "validate_claim_request",
    ]);
    assert.equal(listAgentToolSpecs().length, 4);
  });

  it("rejects unknown tool names", () => {
    assert.equal(getAgentTool("execute_transfer"), null);
    assert.equal(getAgentTool("nope"), null);
    assert.equal(getAgentTool(""), null);
  });

  it("accepts a resolve_recipient call with an alias", () => {
    const result = validateAgentToolCall("resolve_recipient", { candidate: "daniel" });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.name, "resolve_recipient");
      assert.equal(result.args.candidate, "daniel");
    }
  });

  it("accepts a resolve_recipient call with an address", () => {
    const result = validateAgentToolCall("resolve_recipient", { candidate: ADDRESS });
    assert.equal(result.ok, true);
  });

  it("rejects a malformed resolve_recipient call", () => {
    assert.equal(validateAgentToolCall("resolve_recipient", { candidate: "" }).ok, false);
    assert.equal(validateAgentToolCall("resolve_recipient", {}).ok, false);
    assert.equal(validateAgentToolCall("resolve_recipient", { candidate: 42 }).ok, false);
    assert.equal(validateAgentToolCall("resolve_recipient", { candidate: "daniel", extra: 1 }).ok, false);
  });

  it("rejects execution-like tool names", () => {
    for (const name of ["execute_transfer", "execute_approved_payment", "execute"]) {
      assert.equal(getAgentTool(name), null, name);
      assert.equal(validateAgentToolCall(name, {}).ok, false, name);
    }
  });

  it("rejects KeeperHub-like tool names", () => {
    for (const name of ["call_keeperhub", "direct_keeperhub_call", "keeperhub_execute"]) {
      assert.equal(getAgentTool(name), null, name);
    }
  });

  it("rejects SQL/HTTP/tool-abuse names", () => {
    for (const name of ["raw_sql", "arbitrary_http_request", "fetch", "shell", "set_webhook", "run_migration"]) {
      assert.equal(getAgentTool(name), null, name);
    }
  });

  it("rejects approval-bypass names", () => {
    for (const name of ["approve_payment", "bypass_approval", "mark_successful", "fake_transaction_hash"]) {
      assert.equal(getAgentTool(name), null, name);
    }
  });
});

describe("resolve_recipient tool", () => {
  it("resolves a known alias from the recipient directory", async () => {
    const { context } = await makeContext();
    const result = await resolveRecipientTool(context, { candidate: "daniel" });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.address, ADDRESS_LOWER);
      assert.equal(result.alias, "daniel");
    }
  });

  it("resolves an explicit valid address", async () => {
    const { context } = await makeContext();
    const result = await resolveRecipientTool(context, { candidate: ADDRESS });
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.address, ADDRESS_LOWER);
      assert.equal(result.alias, null);
    }
  });

  it("marks an invalid address invalid", async () => {
    const { context } = await makeContext();
    for (const candidate of ["0x1234", "0xzzz", "0x0000000000000000000000000000000000000000"]) {
      const result = await resolveRecipientTool(context, { candidate });
      assert.equal(result.status, "invalid", candidate);
    }
  });

  it("returns unresolved for an unknown name", async () => {
    const { context } = await makeContext();
    const result = await resolveRecipientTool(context, { candidate: "eve" });
    assert.equal(result.status, "unresolved");
  });

  it("returns needs_resolution without workspace context", async () => {
    const { context } = await makeContext({ workspace: false });
    const result = await resolveRecipientTool(context, { candidate: "daniel" });
    assert.equal(result.status, "needs_resolution");
  });

  it("never invents a destination", async () => {
    const { context } = await makeContext();
    const result = await resolveRecipientTool(context, { candidate: "@daniel" });
    assert.notEqual(result.status, "resolved");
  });
});

describe("inspect_payment_policy tool", () => {
  it("returns a conservative result when workspace context is missing", async () => {
    const { context } = await makeContext({ workspace: false });
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    assert.equal(result.allowed, false);
    assert.equal(result.approvalRequired, false);
    assert.equal(result.denied, false);
    assert.equal(result.missingContext, true);
  });

  it("returns a conservative result when the amount is missing", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: null, token: null, chainId: null });
    assert.equal(result.allowed, false);
    assert.equal(result.missingContext, true);
  });

  it("reports approval_required for a valid community amount", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    assert.equal(result.allowed, true);
    assert.equal(result.approvalRequired, true);
    assert.equal(result.denied, false);
    assert.equal(result.perTxLimitUsdc, "1");
    assert.equal(result.remainingPerTxUsdc, "0.98");
  });

  it("reports denied above the per-transaction limit", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "2000000", token: null, chainId: null });
    assert.equal(result.allowed, false);
    assert.equal(result.denied, true);
  });

  it("reports denied for an unsupported token", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: "ETH", chainId: null });
    assert.equal(result.allowed, false);
    assert.equal(result.denied, true);
  });

  it("reports denied for a non-member", async () => {
    const { context } = await makeContext({ member: false });
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    assert.equal(result.allowed, false);
    assert.equal(result.denied, true);
  });

  it("never approves or executes: returns facts only", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    assert.equal("decision" in result, false);
    assert.equal("executionId" in result, false);
    assert.equal("transactionHash" in result, false);
  });
});

describe("inspect_payment_status tool", () => {
  it("handles a malformed payout id", async () => {
    const { context } = await makeContext();
    for (const payoutId of [null, "abc", "123", "0x1234"]) {
      const result = await inspectPaymentStatusTool(context, { payoutId });
      assert.equal(result.status, "malformed", String(payoutId));
    }
  });

  it("returns not_found for an unknown payout id", async () => {
    const { context } = await makeContext();
    const result = await inspectPaymentStatusTool(context, { payoutId: STATUS_UUID });
    assert.equal(result.status, "not_found");
  });

  it("returns forbidden without details across workspaces", async () => {
    const { repo, context } = await makeContext();
    const other = await repo.createWorkspace({
      mode: "community",
      name: "Other",
      telegramChatId: "-100888",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "approval_required",
      status: "active",
    });
    const payout = await repo.createPayout({
      workspaceId: other.id,
      requesterId: "999",
      sourceType: "telegram_command",
      status: "pending_approval",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    const result = await inspectPaymentStatusTool(context, { payoutId: payout.id });
    assert.equal(result.status, "forbidden");
    if (result.status === "forbidden") {
      assert.equal("state" in result, false);
      assert.match(result.reason, /not available/i);
    }
  });

  it("returns visible state for an accessible payout", async () => {
    const { repo, context } = await makeContext();
    const payout = await repo.createPayout({
      workspaceId: (context.workspace as { id: string }).id,
      requesterId: "123456",
      sourceType: "telegram_command",
      status: "pending_approval",
      totalAmountBaseUnits: "20000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: ADDRESS_LOWER,
      amountBaseUnits: "20000",
      memo: null,
      status: "pending_approval",
      idempotencyKey: "it:p1",
    });
    const result = await inspectPaymentStatusTool(context, { payoutId: payout.id });
    assert.equal(result.status, "visible");
    if (result.status === "visible") {
      assert.equal(result.state, "pending_approval");
      assert.equal(result.itemCount, 1);
    }
  });
});

describe("validate_claim_request tool", () => {
  it("accepts a safe USDC claim amount", async () => {
    const { context } = await makeContext();
    const result = await validateClaimRequestTool(context, { amount: "0.05", token: null, chainId: null });
    assert.equal(result.status, "valid");
    if (result.status === "valid") {
      assert.equal(result.claim.amountBaseUnits, "50000");
      assert.equal(result.claim.currencySymbol, "USDC");
      assert.equal(result.claim.chainId, "8453");
      assert.equal(result.claim.tokenAddress, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    }
  });

  it("rejects an unsupported token", async () => {
    const { context } = await makeContext();
    const result = await validateClaimRequestTool(context, { amount: "0.05", token: "ETH", chainId: null });
    assert.equal(result.status, "invalid");
  });

  it("rejects a missing amount", async () => {
    const { context } = await makeContext();
    const result = await validateClaimRequestTool(context, { amount: null, token: null, chainId: null });
    assert.equal(result.status, "invalid");
  });

  it("rejects a malformed amount", async () => {
    const { context } = await makeContext();
    const result = await validateClaimRequestTool(context, { amount: "0", token: null, chainId: null });
    assert.equal(result.status, "invalid");
  });

  it("returns needs_context without a workspace", async () => {
    const { context } = await makeContext({ workspace: false });
    const result = await validateClaimRequestTool(context, { amount: "0.05", token: null, chainId: null });
    assert.equal(result.status, "needs_context");
  });

  it("never persists anything", async () => {
    const { repo, context } = await makeContext();
    const before = repo.listClaimsByWorkspace ? await repo.listClaimsByWorkspace((context.workspace as { id: string }).id) : null;
    await validateClaimRequestTool(context, { amount: "0.05", token: null, chainId: null });
    const after = repo.listClaimsByWorkspace ? await repo.listClaimsByWorkspace((context.workspace as { id: string }).id) : null;
    assert.deepEqual(after, before);
  });
});

describe("tool safety and determinism", () => {
  it("dispatch rejects unknown tool names", async () => {
    const { context } = await makeContext();
    await assert.rejects(
      () => executeAgentTool("execute_transfer" as never, context, {}),
      /unknown agent tool/,
    );
  });

  it("dispatch validates args before execution", async () => {
    const { context } = await makeContext();
    await assert.rejects(
      () => executeAgentTool("resolve_recipient", context, { candidate: "" }),
      /invalid args/,
    );
  });

  it("dispatch runs the requested safe tool", async () => {
    const { context } = await makeContext();
    const result = await executeAgentTool("resolve_recipient", context, { candidate: "daniel" });
    assert.ok("status" in result);
    assert.equal(result.status, "resolved");
  });

  it("tool results are deterministic", async () => {
    const { context } = await makeContext();
    const first = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    const second = await inspectPaymentPolicyTool(context, { amountBaseUnits: "20000", token: null, chainId: null });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("tool descriptions contain no secrets or API keys", () => {
    for (const spec of listAgentToolSpecs()) {
      assert.match(spec.description, /[A-Za-z]/);
      assert.equal(/api[_-]?key|secret|password|bearer|private key/i.test(spec.description), false, spec.name);
    }
  });

  it("no registry entry exposes execute_approved_payment or mutating execution", () => {
    for (const name of AGENT_TOOL_NAMES) {
      assert.notEqual(name, "execute_approved_payment");
      assert.equal(/^(execute|approve|transfer|withdraw|persist)/.test(name), false, name);
    }
  });

  it("tools.ts imports no live network or execution modules", () => {
    const source = readFileSync("src/server/agent/tools.ts", "utf8");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "node:http", "fetch("]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
