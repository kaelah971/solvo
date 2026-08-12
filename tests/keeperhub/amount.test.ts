import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalizeAmount, parseUsdcAmount, PROOF_MAX_AMOUNT_USDC } from "../../src/server/keeperhub/amount.ts";

describe("canonicalizeAmount", () => {
  it("normalizes equivalent spellings to one decimal string", () => {
    assert.equal(canonicalizeAmount("0.1"), "0.1");
    assert.equal(canonicalizeAmount("0.10"), "0.1");
    assert.equal(canonicalizeAmount("01.5"), "1.5");
    assert.equal(canonicalizeAmount(".5"), "0.5");
    assert.equal(canonicalizeAmount("1.000"), "1");
    assert.equal(canonicalizeAmount("007"), "7");
    assert.equal(canonicalizeAmount("0"), "0");
    assert.equal(canonicalizeAmount(" 0.05 "), "0.05");
  });

  it("marks invalid spellings", () => {
    assert.equal(canonicalizeAmount("-1"), "invalid");
    assert.equal(canonicalizeAmount("+1"), "invalid");
    assert.equal(canonicalizeAmount("1e3"), "invalid");
    assert.equal(canonicalizeAmount("abc"), "invalid");
    assert.equal(canonicalizeAmount(""), "0");
  });
});

describe("parseUsdcAmount", () => {
  it("accepts a positive amount within the proof cap", () => {
    const result = parseUsdcAmount("0.01");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.amount, "0.01");
  });

  it("accepts exactly the cap", () => {
    const result = parseUsdcAmount(PROOF_MAX_AMOUNT_USDC);
    assert.equal(result.ok, true);
  });

  it("rejects amounts above the hard cap", () => {
    const result = parseUsdcAmount("0.11");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /cap/i);
  });

  it("rejects zero and negative amounts", () => {
    assert.equal(parseUsdcAmount("0").ok, false);
    assert.equal(parseUsdcAmount("0.00").ok, false);
    assert.equal(parseUsdcAmount("-0.01").ok, false);
  });

  it("rejects more than 6 decimal places (USDC micro-units)", () => {
    const result = parseUsdcAmount("0.0000001");
    assert.equal(result.ok, false);
  });

  it("rejects exponents and non-numeric input", () => {
    assert.equal(parseUsdcAmount("1e-2").ok, false);
    assert.equal(parseUsdcAmount("0.0.1").ok, false);
    assert.equal(parseUsdcAmount("").ok, false);
  });
});
