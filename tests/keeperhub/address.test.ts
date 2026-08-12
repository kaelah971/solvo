import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isValidEvmAddress, ZERO_ADDRESS } from "../../src/server/keeperhub/address.ts";

const VALID_LOWER = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const VALID_CHECKSUMMED = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

describe("isValidEvmAddress", () => {
  it("accepts an all-lowercase address", () => {
    const result = isValidEvmAddress(VALID_LOWER);
    assert.equal(result.ok, true);
  });

  it("accepts an exact EIP-55 checksummed address", () => {
    const result = isValidEvmAddress(VALID_CHECKSUMMED);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.address, VALID_LOWER);
  });

  it("rejects a mixed-case address with a broken checksum", () => {
    const broken = "0x742d35Cc6634C0532925a3b844Bc454e4438f44f";
    const result = isValidEvmAddress(broken);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /checksum/i);
  });

  it("rejects the zero address", () => {
    const result = isValidEvmAddress(ZERO_ADDRESS);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /zero address/i);
  });

  it("rejects malformed inputs", () => {
    for (const input of ["", "0x123", "0x1234", "0x" + "g".repeat(40), "1234", "0x" + "1".repeat(41)]) {
      assert.equal(isValidEvmAddress(input).ok, false, `expected rejection for ${input}`);
    }
  });

  it("accepts the official ERC-55 test vectors", () => {
    const vectors = [
      "0x52908400098527886E0F7030069857D2E4169EE7",
      "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
      "0xde709f2102306220921060314715629080e2fb77",
      "0x27b1fdb04752bbc536007a920d24acb045561c26",
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
      "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
      "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
    ];
    for (const vector of vectors) {
      assert.equal(isValidEvmAddress(vector).ok, true, `expected acceptance for ${vector}`);
    }
  });
});
