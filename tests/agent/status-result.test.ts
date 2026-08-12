import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { agentStatusResult } from "../../src/server/agent/bridges/status-result.ts";
import type { AgentPlannerDecision } from "../../src/server/agent/planner.ts";

const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("status result plumbing", () => {
  it("converts a status_visible decision into a safe visible result", () => {
    const decision: AgentPlannerDecision = {
      decision: "status_visible",
      planAction: "inspect_payment_status",
      status: { payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null },
    };
    const result = agentStatusResult(decision);
    assert.deepEqual(result, {
      outcome: "visible",
      payoutId: STATUS_UUID,
      state: "pending_approval",
      itemCount: 1,
      completedAt: null,
    });
  });

  it("converts a status_not_found decision without leaking details", () => {
    const decision: AgentPlannerDecision = {
      decision: "status_not_found",
      planAction: "inspect_payment_status",
      payoutId: STATUS_UUID,
    };
    const result = agentStatusResult(decision);
    assert.deepEqual(result, { outcome: "not_found", payoutId: STATUS_UUID });
    assert.equal("state" in result, false);
  });

  it("converts a blocked decision into a blocked result", () => {
    const decision: AgentPlannerDecision = {
      decision: "blocked",
      planAction: "decline_unsupported",
      reason: "Payout details are not available to this caller.",
    };
    assert.deepEqual(agentStatusResult(decision), { outcome: "blocked", reason: "Payout details are not available to this caller." });
  });

  it("returns null for non-status decisions", () => {
    const decisions: AgentPlannerDecision[] = [
      { decision: "prepared_payment", planAction: "prepare_payment", prepared: { recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e", recipientAlias: null, amountBaseUnits: "10000", currency: "USDC", chainId: "8453", tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", memo: null, approvalRequired: true, policyReason: "x", perTxLimitUsdc: null, remainingPerTxUsdc: null } },
      { decision: "unsupported", planAction: "decline_unsupported", reason: "no" },
      { decision: "ask_clarifying_question", planAction: "ask_clarifying_question", missingFields: ["payout_id"], question: "?" },
    ];
    for (const decision of decisions) {
      assert.equal(agentStatusResult(decision), null);
    }
  });

  it("is non-mutating and never touches the repository", async () => {
    const repo = new MemoryRepository();
    const workspace = await repo.createWorkspace({
      mode: "community",
      name: "WS",
      telegramChatId: "-100777",
      chainId: "8453",
      tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "approval_required",
      status: "active",
    });
    const decision: AgentPlannerDecision = {
      decision: "status_visible",
      planAction: "inspect_payment_status",
      status: { payoutId: STATUS_UUID, state: "pending_approval", itemCount: 0, completedAt: null },
    };
    const result = agentStatusResult(decision);
    assert.ok(result);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0);
    assert.equal(await repo.getAgentRunByIdempotencyKey("anything"), null);
  });
});
