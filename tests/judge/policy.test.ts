import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateJudgeRequest } from "../../src/server/judge/policy.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ADMIN = "123456789";
const PUBLIC_USER = "987654321";
const ADMIN_IDS = new Set([ADMIN]);

function base(caps: Partial<Parameters<typeof evaluateJudgeRequest>[0]> = {}) {
  return {
    modeEnabled: true,
    adminUserIds: new Set<string>(),
    userId: PUBLIC_USER,
    amountBaseUnits: "10000",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    workspaceActive: true,
    perTxLimitBaseUnits: "10000",
    dailyLimitBaseUnits: "250000",
    lifetimeLimitBaseUnits: "1000000",
    maxSuccessfulPaymentsPerUser: 1,
    successfulPaymentsByUser: 0,
    currentDailySpendBaseUnits: "0",
    lifetimeSpendBaseUnits: "0",
    ...caps,
  };
}

describe("judge policy (M6.1 public self-serve)", () => {
  it("auto-approves a public user with no allowlist under all caps", () => {
    const decision = evaluateJudgeRequest(base());
    assert.equal(decision.decision, "auto_approve");
  });

  it("auto-approves exactly the default 0.01 USDC per-transaction cap", () => {
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "10000" })).decision, "auto_approve");
  });

  it("blocks amounts above the default 0.01 USDC per-tx cap", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "10001" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /per-transaction cap/i);
  });

  it("blocks when judge mode is disabled", () => {
    const decision = evaluateJudgeRequest(base({ modeEnabled: false }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /not enabled/i);
  });

  it("locks public access when an admin allowlist is configured", () => {
    const decision = evaluateJudgeRequest(base({ adminUserIds: ADMIN_IDS, userId: PUBLIC_USER }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /admin allowlist/i);
  });

  it("allows listed admins when the allowlist is configured", () => {
    const decision = evaluateJudgeRequest(base({ adminUserIds: ADMIN_IDS, userId: ADMIN }));
    assert.equal(decision.decision, "auto_approve");
  });

  it("exempts admins from the per-user success cap", () => {
    const decision = evaluateJudgeRequest(
      base({ adminUserIds: ADMIN_IDS, userId: ADMIN, successfulPaymentsByUser: 5 }),
    );
    assert.equal(decision.decision, "auto_approve");
  });

  it("blocks zero and negative amounts", () => {
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "0" })).decision, "blocked");
    assert.equal(evaluateJudgeRequest(base({ amountBaseUnits: "-1" })).decision, "blocked");
  });

  it("blocks when the daily cap would be exceeded", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "10000", currentDailySpendBaseUnits: "245000" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /daily cap/i);
  });

  it("allows exactly up to the daily cap", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "5000", currentDailySpendBaseUnits: "245000" }));
    assert.equal(decision.decision, "auto_approve");
  });

  it("blocks when the lifetime cap would be exceeded", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "10000", lifetimeSpendBaseUnits: "995000" }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /lifetime cap/i);
  });

  it("allows exactly up to the lifetime cap", () => {
    const decision = evaluateJudgeRequest(base({ amountBaseUnits: "5000", lifetimeSpendBaseUnits: "995000" }));
    assert.equal(decision.decision, "auto_approve");
  });

  it("blocks a public user who already completed the max successful payments", () => {
    const decision = evaluateJudgeRequest(base({ successfulPaymentsByUser: 1 }));
    assert.equal(decision.decision, "blocked");
    assert.match(decision.reason, /already completed its one allowed judge payment/i);
  });

  it("allows a public user's first payment at the per-user cap boundary", () => {
    const decision = evaluateJudgeRequest(base({ successfulPaymentsByUser: 0 }));
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
