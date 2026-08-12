import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifySecretToken } from "../../src/server/telegram/webhook-secret.ts";

describe("verifySecretToken", () => {
  it("accepts the matching secret", () => {
    assert.equal(verifySecretToken("super-secret", "super-secret"), true);
  });

  it("rejects a mismatched secret", () => {
    assert.equal(verifySecretToken("super-secret", "other-secret"), false);
  });

  it("rejects empty values", () => {
    assert.equal(verifySecretToken("", "secret"), false);
    assert.equal(verifySecretToken("secret", ""), false);
    assert.equal(verifySecretToken("", ""), false);
  });

  it("rejects prefix matches (not just startsWith)", () => {
    assert.equal(verifySecretToken("secret", "secret-extra"), false);
    assert.equal(verifySecretToken("secret-extra", "secret"), false);
  });
});
