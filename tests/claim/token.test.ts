import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  claimTokenIsWellFormed,
  claimTokenPrefix,
  generateClaimToken,
  generateClaimTokenPair,
  hashClaimToken,
} from "../../src/server/claim/token.ts";

describe("claim token security (M7)", () => {
  it("generates unguessable 32-char base64url tokens", () => {
    const token = generateClaimToken();
    assert.match(token, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(claimTokenIsWellFormed(token));
  });

  it("never repeats tokens across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      seen.add(generateClaimToken());
    }
    assert.equal(seen.size, 500);
  });

  it("hashes deterministically and never contains the raw token", () => {
    const token = generateClaimToken();
    const a = hashClaimToken(token);
    const b = hashClaimToken(token);
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.ok(!a.includes(token));
    assert.notEqual(hashClaimToken(generateClaimToken()), a);
  });

  it("derives a short display prefix from the raw token", () => {
    const token = generateClaimToken();
    assert.equal(claimTokenPrefix(token), token.slice(0, 8));
    assert.equal(claimTokenPrefix(token).length, 8);
  });

  it("generates a complete token pair (raw + hash + prefix)", () => {
    const pair = generateClaimTokenPair();
    assert.equal(hashClaimToken(pair.raw), pair.hash);
    assert.equal(pair.prefix, pair.raw.slice(0, 8));
  });

  it("rejects malformed tokens", () => {
    assert.equal(claimTokenIsWellFormed(""), false);
    assert.equal(claimTokenIsWellFormed("short"), false);
    assert.equal(claimTokenIsWellFormed("!".repeat(32)), false);
    assert.equal(claimTokenIsWellFormed("A".repeat(33)), false);
  });

  it("does not store or expose raw tokens in hashes or prefixes", () => {
    const pair = generateClaimTokenPair();
    assert.ok(!pair.hash.includes(pair.raw));
    assert.ok(!pair.prefix.includes(pair.raw.slice(8)));
  });
});
