import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProofRequest, DEFAULT_TASK_ID, proofWarningBlock } from "../../src/server/keeperhub/proof-command.ts";

const RECIPIENT = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

describe("buildProofRequest", () => {
  it("builds a valid bounded request without confirmation", () => {
    const result = buildProofRequest({
      to: RECIPIENT,
      amount: "0.01",
      confirmed: false,
      usdcTokenAddress: USDC,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.request.chainId, "8453");
      assert.equal(result.request.recipientAddress, RECIPIENT.toLowerCase());
      assert.equal(result.request.amount, "0.01");
      assert.equal(result.request.tokenAddress, USDC.toLowerCase());
      assert.equal(result.taskId, DEFAULT_TASK_ID);
      assert.match(result.request.idempotencyKey, /^[0-9a-f]{64}$/);
    }
  });

  it("enforces the 0.10 USDC hard cap", () => {
    const result = buildProofRequest({
      to: RECIPIENT,
      amount: "0.11",
      confirmed: true,
      usdcTokenAddress: USDC,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /cap/i);
  });

  it("rejects invalid recipients", () => {
    const result = buildProofRequest({
      to: "0x123",
      amount: "0.01",
      confirmed: true,
      usdcTokenAddress: USDC,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /recipient/i);
  });

  it("rejects zero addresses before anything can move", () => {
    const result = buildProofRequest({
      to: "0x0000000000000000000000000000000000000000",
      amount: "0.01",
      confirmed: true,
      usdcTokenAddress: USDC,
    });
    assert.equal(result.ok, false);
  });

  it("rejects invalid amounts", () => {
    for (const amount of ["0", "-1", "0.0000001", "abc"]) {
      const result = buildProofRequest({ to: RECIPIENT, amount, confirmed: true, usdcTokenAddress: USDC });
      assert.equal(result.ok, false, `expected rejection for ${amount}`);
    }
  });

  it("produces a stable idempotency key for identical invocations", () => {
    const a = buildProofRequest({ to: RECIPIENT, amount: "0.01", confirmed: true, usdcTokenAddress: USDC });
    const b = buildProofRequest({ to: RECIPIENT, amount: "0.01", confirmed: true, usdcTokenAddress: USDC });
    assert.ok(a.ok && b.ok);
    assert.equal(a.request.idempotencyKey, b.request.idempotencyKey);
  });

  it("uses a supplied task id", () => {
    const result = buildProofRequest({
      to: RECIPIENT,
      amount: "0.01",
      confirmed: true,
      taskId: "proof-2026-08-11",
      usdcTokenAddress: USDC,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.taskId, "proof-2026-08-11");
  });
});

describe("proofWarningBlock", () => {
  it("describes the target, asset, recipient and amount", () => {
    const result = buildProofRequest({ to: RECIPIENT, amount: "0.01", confirmed: true, usdcTokenAddress: USDC });
    assert.ok(result.ok);
    const block = proofWarningBlock(result.request, result.taskId);
    assert.match(block, /Base \/ 8453/);
    assert.match(block, /USDC/);
    assert.match(block, /0\.01 USDC/);
    assert.match(block, /REAL FUNDS/);
    assert.match(block, /confirm-real-transfer/);
  });
});
