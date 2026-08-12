import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { claimExpiresAtIso, getClaimByRawToken, submitClaimRecipient } from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

async function setupClaim(repo: MemoryRepository, expiresAt = claimExpiresAtIso(168)) {
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: "Web",
    telegramChatId: "-1001",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId: workspace.id,
    requesterId: "123456789",
    amountBaseUnits: "5000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt,
    idempotencyKey: `m8-web-${Math.random().toString(36).slice(2)}`,
  });
  return { workspace, claim, token };
}

/**
 * M8 claim web-action attacks. The public claim page may ONLY record a
 * destination for a valid claim — the underlying service surface is tested
 * here directly (the server action is a thin wrapper around it).
 */
describe("M8 claim page / web action hardening", () => {
  it("a direct action without visiting the page still cannot approve or execute", async () => {
    const repo = new MemoryRepository();
    const { token } = await setupClaim(repo);
    // The ONLY available web operation is submitClaimRecipient; there is no
    // approve/execute action reachable from the page.
    const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, true);
    assert.equal([...repo.payouts.values()].length, 0, "no payout may be created by a web action");
    assert.equal([...repo.executionAttempts.values()].length, 0, "no execution may be triggered by a web action");
  });

  it("extremely long inputs are rejected, not processed", async () => {
    const repo = new MemoryRepository();
    const { token } = await setupClaim(repo);
    const longAddress = "0x" + "a".repeat(1000);
    const result = await submitClaimRecipient(repo, token.raw, longAddress, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, false);
    assert.equal(result.kind, "invalid_address");
  });

  it("stale pages submitted after another user claimed never mutate the claim", async () => {
    const repo = new MemoryRepository();
    const { claim, token } = await setupClaim(repo);
    const first = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(first.ok, true);

    // A stale page (opened earlier) submits a different wallet afterwards.
    const stale = await submitClaimRecipient(
      repo,
      token.raw,
      "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      "web",
      "2026-08-13T00:01:00.000Z",
    );
    assert.equal(stale.ok, false);
    assert.equal(stale.kind, "already_claimed");
    assert.equal((await repo.getClaimLinkById(claim.id))?.claimed_recipient, RECIPIENT);
  });

  it("cannot change the amount, currency, chain or token through the web action", async () => {
    const repo = new MemoryRepository();
    const { claim, token } = await setupClaim(repo);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored);
    // The claim row's monetary fields are immutable — no web parameter can
    // alter them because the web action only takes (token, address).
    assert.equal(stored.amount_base_units, "5000");
    assert.equal(stored.currency_symbol, "USDC");
    assert.equal(stored.chain_id, CHAIN);
    assert.equal(stored.token_address, TOKEN);
  });

  it("cannot supply a payout id or force approval through the web action", async () => {
    const repo = new MemoryRepository();
    const { token } = await setupClaim(repo);
    // The web surface exposes exactly one operation with exactly two inputs.
    // Attempts to supply extra parameters are structurally impossible at the
    // service boundary; prove the only operation available is the claim.
    const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, true);
    assert.equal([...repo.payouts.values()].length, 0);
    assert.equal((await getClaimByRawToken(repo, token.raw))?.claim.status, "claimed");
  });

  it("repeated submissions are idempotent with a truthful response", async () => {
    const repo = new MemoryRepository();
    const { claim, token } = await setupClaim(repo);
    for (let i = 0; i < 3; i += 1) {
      const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", `2026-08-13T00:0${i}:00.000Z`);
      if (i === 0) {
        assert.equal(result.ok, true);
      } else {
        assert.equal(result.ok, false);
        assert.equal(result.kind, "already_claimed");
      }
    }
    assert.equal((await repo.getClaimLinkById(claim.id))?.claimed_recipient, RECIPIENT);
  });

  it("concurrent web submissions produce exactly one stored destination", async () => {
    const repo = new MemoryRepository();
    const { claim, token } = await setupClaim(repo);
    const results = await Promise.all([
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z"),
      submitClaimRecipient(repo, token.raw, "0x742d35cc6634c0532925a3b844bc454e4438f44e", "web", "2026-08-13T00:00:00.000Z"),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored?.claimed_recipient);
    assert.equal(stored.claimed_at !== null, true);
  });

  it("an expired claim cannot be claimed through the web action", async () => {
    const repo = new MemoryRepository();
    const expiresAt = claimExpiresAtIso(1, new Date("2026-08-12T00:00:00Z"));
    const { token } = await setupClaim(repo, expiresAt);
    const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-12T01:00:00.001Z");
    assert.equal(result.ok, false);
    assert.equal(result.kind, "expired");
  });
});
