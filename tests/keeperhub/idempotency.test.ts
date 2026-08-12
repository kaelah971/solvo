import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveIdempotencyKey } from "../../src/server/keeperhub/idempotency.ts";

const base = {
  taskId: "solvo-dev-proof",
  chainId: "8453",
  recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
  amount: "0.01",
  tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

describe("deriveIdempotencyKey", () => {
  it("is stable across repeated calls", () => {
    assert.equal(deriveIdempotencyKey(base), deriveIdempotencyKey(base));
  });

  it("changes when the amount changes", () => {
    assert.notEqual(
      deriveIdempotencyKey(base),
      deriveIdempotencyKey({ ...base, amount: "0.02" }),
    );
  });

  it("changes when the recipient changes", () => {
    assert.notEqual(
      deriveIdempotencyKey(base),
      deriveIdempotencyKey({ ...base, recipientAddress: "0x5aeda56215b167893e80b4fe645ba6d5bab767de" }),
    );
  });

  it("changes when the task id changes", () => {
    assert.notEqual(
      deriveIdempotencyKey(base),
      deriveIdempotencyKey({ ...base, taskId: "another-task" }),
    );
  });

  it("agrees between checksummed and lowercase recipient spellings", () => {
    assert.equal(
      deriveIdempotencyKey(base),
      deriveIdempotencyKey({ ...base, recipientAddress: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e" }),
    );
  });

  it("agrees between amount spellings with the same value", () => {
    assert.equal(
      deriveIdempotencyKey(base),
      deriveIdempotencyKey({ ...base, amount: "0.010" }),
    );
  });

  it("returns a 64-character lowercase hex digest", () => {
    const key = deriveIdempotencyKey(base);
    assert.match(key, /^[0-9a-f]{64}$/);
  });

  it("escapes task id separators so fields cannot collide", () => {
    const a = deriveIdempotencyKey({ ...base, taskId: "a|b" });
    const b = deriveIdempotencyKey({ ...base, taskId: "a", recipientAddress: "b|0x742d35cc6634c0532925a3b844bc454e4438f44e" });
    assert.notEqual(a, b);
  });
});
