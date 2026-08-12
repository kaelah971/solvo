import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { baseUnitsToUsdc, usdcToBaseUnits } from "../../src/server/execution/money.ts";

describe("usdcToBaseUnits", () => {
  it("converts 0.01 USDC to 10000 base units (6 decimals)", () => {
    const result = usdcToBaseUnits("0.01");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, 10000n);
  });

  it("converts whole dollars and edge cases", () => {
    assert.equal(usdcToBaseUnits("1")?.ok && (usdcToBaseUnits("1") as { value: bigint }).value, 1_000_000n);
    assert.equal(usdcToBaseUnits("0.10")?.ok && (usdcToBaseUnits("0.10") as { value: bigint }).value, 100_000n);
    assert.equal(usdcToBaseUnits("0.000001")?.ok && (usdcToBaseUnits("0.000001") as { value: bigint }).value, 1n);
    assert.equal(usdcToBaseUnits("0.1")?.ok && (usdcToBaseUnits("0.1") as { value: bigint }).value, 100_000n);
  });

  it("normalizes spellings to the same base units", () => {
    const a = usdcToBaseUnits("0.10");
    const b = usdcToBaseUnits("0.1");
    assert.ok(a.ok && b.ok);
    assert.equal(a.value, b.value);
  });

  it("rejects zero and negative amounts", () => {
    assert.equal(usdcToBaseUnits("0").ok, false);
    assert.equal(usdcToBaseUnits("0.000000").ok, false);
    assert.equal(usdcToBaseUnits("-0.01").ok, false);
  });

  it("rejects more than 6 decimals", () => {
    assert.equal(usdcToBaseUnits("0.0000001").ok, false);
  });

  it("rejects non-numeric and exponent forms", () => {
    assert.equal(usdcToBaseUnits("abc").ok, false);
    assert.equal(usdcToBaseUnits("1e-2").ok, false);
    assert.equal(usdcToBaseUnits("").ok, false);
  });

  it("never uses floating point arithmetic", () => {
    const result = usdcToBaseUnits("0.999999");
    assert.ok(result.ok);
    assert.equal(result.value, 999999n);
    const large = usdcToBaseUnits("18446744073709551615.999999");
    assert.ok(large.ok);
    assert.equal(large.value, 18446744073709551615999999n);
  });
});

describe("baseUnitsToUsdc", () => {
  it("round-trips values without precision loss", () => {
    for (const amount of ["0.01", "0.1", "1", "0.000001", "5.5", "0.999999"]) {
      const converted = usdcToBaseUnits(amount);
      assert.ok(converted.ok, amount);
      assert.equal(baseUnitsToUsdc(converted.value), amount, amount);
    }
  });

  it("rejects negative input", () => {
    assert.equal(baseUnitsToUsdc(-1n), "invalid");
  });
});
