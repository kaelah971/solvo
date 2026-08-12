import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeExecutionStatus,
  normalizeSimulationResult,
  normalizeStatus,
  normalizeWalletIntegration,
  resolveTransferArgs,
} from "../../src/server/keeperhub/adapter.ts";

describe("normalizeStatus", () => {
  it("maps known and unknown statuses", () => {
    assert.equal(normalizeStatus("completed"), "completed");
    assert.equal(normalizeStatus("failed"), "failed");
    assert.equal(normalizeStatus("pending"), "pending");
    assert.equal(normalizeStatus("running"), "running");
    assert.equal(normalizeStatus("something-else"), "unknown");
    assert.equal(normalizeStatus(undefined), "unknown");
  });
});

describe("normalizeExecutionStatus", () => {
  it("normalizes a completed execution with verified receipts", () => {
    const raw = {
      executionId: "direct_123",
      status: "completed",
      type: "transfer",
      transactionHash: "0xabc",
      transactionLink: "https://basescan.org/tx/0xabc",
      sponsored: false,
      receipts: [
        {
          hash: "0xabc",
          chainId: 8453,
          verified: true,
          receiptStatus: "success",
          blockNumber: 123456,
          gasUsed: "68115",
        },
      ],
      gasUsedWei: "21000000000000",
      error: null,
      createdAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:15Z",
    };
    const result = normalizeExecutionStatus(raw);
    assert.equal(result.executionId, "direct_123");
    assert.equal(result.status, "completed");
    assert.equal(result.transactionHash, "0xabc");
    assert.equal(result.sponsored, false);
    assert.equal(result.receipts.length, 1);
    assert.equal(result.receipts[0].verified, true);
    assert.equal(result.receipts[0].gasUsed, "68115");
    assert.equal(result.receipts[0].blockNumber, 123456);
    assert.equal(result.gasUsedWei, "21000000000000");
  });

  it("handles empty receipts and unknown status", () => {
    const result = normalizeExecutionStatus({ executionId: "direct_9", status: "weird", receipts: [] });
    assert.equal(result.status, "unknown");
    assert.equal(result.receipts.length, 0);
    assert.equal(result.transactionHash, null);
  });
});

describe("normalizeSimulationResult", () => {
  it("normalizes a successful simulation", () => {
    const result = normalizeSimulationResult({
      success: true,
      status: "simulated",
      from: "0xwallet",
      to: "0xtarget",
      value: "10000",
      gasEstimate: "65000",
      simulatedReturnValue: true,
      wouldRevert: false,
    });
    assert.equal(result.success, true);
    assert.equal(result.wouldRevert, false);
    assert.equal(result.gasEstimate, "65000");
  });

  it("preserves would-revert details", () => {
    const result = normalizeSimulationResult({
      success: false,
      wouldRevert: true,
      revertReason: "Error(ERC20: transfer amount exceeds balance)",
      error: "Error(ERC20: transfer amount exceeds balance)",
    });
    assert.equal(result.wouldRevert, true);
    assert.match(result.revertReason ?? "", /exceeds balance/);
  });

  it("preserves insufficient-balance machine code", () => {
    const result = normalizeSimulationResult({
      success: false,
      wouldRevert: true,
      code: "insufficient_balance",
      balanceWei: "250000000000000000",
      shortfallWei: "750000000000000000",
      error: "Insufficient ETH balance",
    });
    assert.equal(result.code, "insufficient_balance");
    assert.equal(result.shortfallWei, "750000000000000000");
  });
});

describe("normalizeWalletIntegration", () => {
  it("reads configured state and address", () => {
    const result = normalizeWalletIntegration({
      configured: true,
      id: "wi_1",
      type: "web3",
      address: "0xwallet",
      chainIds: ["8453", "1"],
    });
    assert.equal(result.configured, true);
    assert.equal(result.type, "web3");
    assert.equal(result.address, "0xwallet");
    assert.deepEqual(result.chainIds, ["8453", "1"]);
  });

  it("reads the live get_wallet_integration response shape (walletAddress)", () => {
    const result = normalizeWalletIntegration({
      id: "ym7pkc73r1hhnu6fonfkp",
      name: "0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E",
      type: "web3",
      config: {},
      createdAt: "2026-08-11T01:01:52.624Z",
      walletAddress: "0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E",
    });
    assert.equal(result.configured, true);
    assert.equal(result.id, "ym7pkc73r1hhnu6fonfkp");
    assert.equal(result.type, "web3");
    assert.equal(result.address, "0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E");
    assert.deepEqual(result.chainIds, []);
  });

  it("treats an absent integration as unconfigured", () => {
    const result = normalizeWalletIntegration({});
    assert.equal(result.configured, false);
    assert.equal(result.address, null);
    assert.equal(result.type, null);
  });
});

describe("resolveTransferArgs", () => {
  it("maps our logical fields onto snake_case schema names", () => {
    const schema = {
      properties: {
        chain_id: { type: "string" },
        to_address: { type: "string" },
        amount: { type: "string" },
        token_address: { type: "string" },
        simulate: { type: "boolean" },
        idempotency_key: { type: "string" },
      },
      required: ["chain_id", "to_address", "amount"],
    };
    const args = resolveTransferArgs(schema, {
      chainId: "8453",
      toAddress: "0xabc",
      amount: "0.01",
      tokenAddress: "0xusdc",
      idempotencyKey: "key",
      simulate: true,
    });
    assert.deepEqual(args, {
      chain_id: "8453",
      to_address: "0xabc",
      amount: "0.01",
      token_address: "0xusdc",
      simulate: true,
      idempotency_key: "key",
    });
  });

  it("falls back to camelCase schema names", () => {
    const schema = { properties: { chainId: {}, recipientAddress: {}, amount: {} } };
    const args = resolveTransferArgs(schema, {
      chainId: "8453",
      toAddress: "0xabc",
      amount: "1",
      tokenAddress: "0xusdc",
      idempotencyKey: "",
    });
    assert.deepEqual(args, { chainId: "8453", recipientAddress: "0xabc", amount: "1" });
  });

  it("omits fields the schema does not advertise", () => {
    const schema = { properties: { chain_id: {}, to_address: {}, amount: {} } };
    const args = resolveTransferArgs(schema, {
      chainId: "8453",
      toAddress: "0xabc",
      amount: "1",
      tokenAddress: "0xusdc",
      idempotencyKey: "",
    });
    assert.equal("token_address" in args, false);
  });
});
