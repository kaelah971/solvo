import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluatePolicy, DEV_TRANSACTION_CAP_BASE_UNITS } from "../../src/server/telegram/policy.ts";
import { KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../../src/server/keeperhub/config.ts";

const TOKEN = KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase();
const ALLOWED = new Set(["111111111"]);
const OTHER = new Set(["222222222"]);

const base = {
  mode: "development" as const,
  workspaceMode: "development" as const,
  userId: "111111111",
  amountBaseUnits: "10000",
  chainId: "8453",
  tokenAddress: TOKEN,
  workspaceActive: true,
  allowedDevUserIds: ALLOWED,
};

describe("evaluatePolicy", () => {
  it("auto-approves an allowlisted dev user under the cap", () => {
    const result = evaluatePolicy(base);
    assert.equal(result.decision, "auto_approve");
  });

  it("blocks a non-allowlisted user in development mode", () => {
    const result = evaluatePolicy({ ...base, userId: "333333333" });
    assert.equal(result.decision, "blocked");
    assert.match(result.reason, /not authorized/i);
  });

  it("auto-approves sandbox mode for any user (simulation only)", () => {
    const result = evaluatePolicy({ ...base, mode: "sandbox", workspaceMode: "sandbox", userId: "333333333" });
    assert.equal(result.decision, "auto_approve");
    assert.match(result.reason, /no funds will move/i);
  });

  it("blocks unsupported chains", () => {
    const result = evaluatePolicy({ ...base, chainId: "1" });
    assert.equal(result.decision, "blocked");
  });

  it("blocks unsupported tokens", () => {
    const result = evaluatePolicy({ ...base, tokenAddress: "0x0000000000000000000000000000000000000001" });
    assert.equal(result.decision, "blocked");
  });

  it("blocks amounts above the development cap", () => {
    const over = (DEV_TRANSACTION_CAP_BASE_UNITS + 1n).toString();
    const result = evaluatePolicy({ ...base, amountBaseUnits: over });
    assert.equal(result.decision, "blocked");
    assert.match(result.reason, /0\.10 USDC/);
  });

  it("allows exactly the cap", () => {
    const result = evaluatePolicy({ ...base, amountBaseUnits: DEV_TRANSACTION_CAP_BASE_UNITS.toString() });
    assert.equal(result.decision, "auto_approve");
  });

  it("blocks inactive workspaces", () => {
    const result = evaluatePolicy({ ...base, workspaceActive: false });
    assert.equal(result.decision, "blocked");
  });

  it("blocks non-development workspaces in development mode", () => {
    const result = evaluatePolicy({ ...base, workspaceMode: "community" });
    assert.equal(result.decision, "blocked");
  });

  it("does not leak allowlist content into reasons", () => {
    const result = evaluatePolicy({ ...base, userId: "333333333", allowedDevUserIds: OTHER });
    assert.equal(result.reason.includes("222222222"), false);
  });
});
