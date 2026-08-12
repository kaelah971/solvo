import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateJudgeRequest } from "../../src/server/judge/policy.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const JUDGE = "123456789";
const JUDGE_IDS = new Set([JUDGE]);

function base(caps: Partial<Parameters<typeof evaluateJudgeRequest>[0]> = {}) {
  return {
    modeEnabled: true,
    judgeUserIds: JUDGE_IDS,
    userId: JUDGE,
    amountBaseUnits: "10000",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    workspaceActive: true,
    perTxLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    currentDailySpendBaseUnits: "0",
    ...caps,
  };
}

describe("judge policy", () => {
  it("auto-approves an allowlisted judge under the caps", () => {
    const decision = evaluateJudgeRequest(base());
    assert.equal(decision.decision, "auto_approve");
  });

  it("blocks when judge mode is disabled", () => {
    const decision = evaluateJudgeRequest(base({ modeEnabled: false }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /not enabled/i);
  });

  it("blocks non-allowlisted users", () => {
    const decision = evaluateJudgeRequest(base({ userId: "999999999" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /not an authorized judge/i);
  });

  it("blocks zero and negative amounts", () => {
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "0" })).decision, "blocked");
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "-1" })).decision, "blocked");
  });

  it("blocks amounts above the per-transaction cap", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "100001" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /per-transaction cap/i);
  });

  it("allows exactly the per-transaction cap", () => {
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "100000" })).decision, "auto_approve");
  });

  it("blocks when the daily cap would be exceeded", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "60000", currentDailySpendBaseUnits: "950000" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /daily cap/i);
  });

  it("allows exactly up to the daily cap", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "50000", currentDailySpendBaseUnits: "950000" }));
    assert.equal(decision.decision, "auto_approve");
  });

  it("blocks wrong chain or token", () => {
    assert.equal(evaluateJudgeRequest(base({ chainId: "1" })).decision, "blocked");
    assert.equal(
      evaluateJudgeRequest(base({ tokenAddress: "0x1111111111111111111111111111111111111111" })).decision,
      "blocked",
    );
  });

  it("blocks when the judge workspace is not active", () => {
    const decision = evaluateJudgeRequest(base({ workspaceActive: false }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /workspace/i);
  });
});
