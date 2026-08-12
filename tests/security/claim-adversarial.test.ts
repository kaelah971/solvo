import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import {
  claimExpiresAtIso,
  effectiveClaimStatus,
  getClaimByRawToken,
  submitClaimRecipient,
} from "../../src/server/claim/service.ts";
import { generateClaimTokenPair, hashClaimToken } from "../../src/server/claim/token.ts";
import type { WorkspaceRow } from "../../src/server/db/types.ts";
type RejectedSubmit = Extract<Awaited<ReturnType<typeof submitClaimRecipient>>, { ok: false }>;

function expectRejected(result: Awaited<ReturnType<typeof submitClaimRecipient>>, kind: RejectedSubmit["kind"]): void {
  if (result.ok) {
    assert.fail("expected the claim submission to be rejected");
  }
  assert.equal(result.kind, kind);
}


const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const RECIPIENT_2 = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function makeWorkspace(repo: MemoryRepository): Promise<WorkspaceRow> {
  return repo.createWorkspace({
    mode: "community",
    name: "Adversarial",
    telegramChatId: "-100666",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
}

async function makeClaim(repo: MemoryRepository, workspace: WorkspaceRow, expiresAt = claimExpiresAtIso(168, new Date("2026-08-12T00:00:00Z"))) {
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
    idempotencyKey: `m8-adv-${Math.random().toString(36).slice(2)}`,
  });
  return { claim, token };
}

describe("M8 claim token adversarial suite", () => {
  it("rejects a random invalid token", async () => {
    const repo = new MemoryRepository();
    const result = await submitClaimRecipient(repo, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, false);
    expectRejected(result, "not_found");
  });

  it("rejects a valid-looking but unknown token", async () => {
    const repo = new MemoryRepository();
    const result = await submitClaimRecipient(repo, generateClaimTokenPair().raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    expectRejected(result, "not_found");
  });

  it("rejects a malformed token and a one-character-altered token", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);

    const malformed = await submitClaimRecipient(repo, "bad!", RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    expectRejected(malformed, "not_found");

    const altered = token.raw.slice(0, 31) + (token.raw.endsWith("a") ? "b" : "a");
    const tampered = await submitClaimRecipient(repo, altered, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    expectRejected(tampered, "not_found");
    const claim = await repo.getClaimLinkById((await getClaimByRawToken(repo, token.raw))?.claim.id ?? "");
    assert.equal(claim?.status, "created");
  });

  it("rejects an expired token (claim just after expiry)", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    // 1h expiry from 00:00 → expires 01:00.
    const expiresAt = claimExpiresAtIso(1, new Date("2026-08-12T00:00:00Z"));
    const { token: atBoundaryToken } = await makeClaim(repo, workspace, expiresAt);
    const boundary = new Date("2026-08-12T00:59:59.999Z").toISOString();
    const atBoundary = await submitClaimRecipient(repo, atBoundaryToken.raw, RECIPIENT, "web", boundary);
    assert.equal(atBoundary.ok, true, "a claim exactly at the expiry boundary wins");

    const { token: justAfterToken } = await makeClaim(repo, workspace, expiresAt);
    const after = await submitClaimRecipient(repo, justAfterToken.raw, RECIPIENT, "web", "2026-08-12T01:00:00.001Z");
    assert.equal(after.ok, false);
    expectRejected(after, "expired");
  });

  it("rejects an already-claimed token and a cancelled token", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    const again = await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:01:00.000Z");
    expectRejected(again, "already_claimed");

    const { claim: c2, token: t2 } = await makeClaim(repo, workspace);
    await repo.transitionClaimStatus(c2.id, ["created"], "cancelled");
    const cancelled = await submitClaimRecipient(repo, t2.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    expectRejected(cancelled, "cancelled");
  });

  it("rejects approved and executed tokens", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
    void claim;
    const approved = await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:01:00.000Z");
    expectRejected(approved, "already_claimed");

    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    const executed = await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:02:00.000Z");
    expectRejected(executed, "already_claimed");
  });

  it("simultaneous claims by different wallets: exactly one wins, destination immutable", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);

    const attempts = await Promise.all([
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z"),
      submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:00:00.000Z"),
      submitClaimRecipient(repo, token.raw, ZERO_ADDRESS, "web", "2026-08-13T00:00:00.000Z"),
    ]);
    const winners = attempts.filter((a) => a.ok);
    assert.equal(winners.length, 1, "exactly one concurrent claim may win");
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored?.claimed_recipient);
    assert.ok([RECIPIENT, RECIPIENT_2].includes(stored.claimed_recipient), "winner's address is stored");

    // The loser's wallets can never mutate the stored destination.
    const mutation = await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:01:00.000Z");
    assert.equal(mutation.ok, false);
    const reread = await repo.getClaimLinkById(claim.id);
    assert.equal(reread?.claimed_recipient, stored.claimed_recipient);
  });

  it("simultaneous claims by the same wallet: one winner, one stored address", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    const attempts = await Promise.all([
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z"),
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z"),
      submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z"),
    ]);
    assert.equal(attempts.filter((a) => a.ok).length, 1);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.claimed_recipient, RECIPIENT);
  });

  it("wallet mutation after the first claim is always rejected", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    for (let i = 0; i < 5; i += 1) {
      const attempt = await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", `2026-08-13T00:0${i}:00.000Z`);
      assert.equal(attempt.ok, false);
    }
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.claimed_recipient, RECIPIENT);
  });

  it("rejects non-EVM wallets and the zero address", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    for (const bad of ["not-a-wallet", "0xZZZ", "0x123", "0x" + "1".repeat(39), "0x" + "G".repeat(40)]) {
      const result = await submitClaimRecipient(repo, token.raw, bad, "web", "2026-08-13T00:00:00.000Z");
      assert.equal(result.ok, false, `must reject ${bad}`);
      assert.equal(result.kind, "invalid_address");
    }
    const zero = await submitClaimRecipient(repo, token.raw, ZERO_ADDRESS, "web", "2026-08-13T00:00:00.000Z");
    expectRejected(zero, "invalid_address");
  });

  it("normalizes mixed-case valid addresses to lowercase", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    const mixed = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
    const result = await submitClaimRecipient(repo, token.raw, mixed, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.claim.claimed_recipient, RECIPIENT);
      assert.equal(result.claim.claimed_recipient, claim.token_hash ? (await repo.getClaimLinkById(claim.id))?.claimed_recipient : "");
    }
  });

  it("token replay after a successful claim never yields a second claim or payout", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    await submitClaimRecipient(repo, token.raw, RECIPIENT_2, "web", "2026-08-13T00:01:00.000Z");
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:02:00.000Z");
    assert.equal([...repo.claimLinks.values()].length, 1);
    assert.equal([...repo.payouts.values()].length, 0);
    assert.equal([...repo.executionAttempts.values()].length, 0);
  });

  it("raw tokens never appear anywhere in the persisted claim row", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    const claim = await repo.getClaimLinkById((await getClaimByRawToken(repo, token.raw))?.claim.id ?? "");
    assert.ok(claim);
    const serialized = JSON.stringify(claim);
    assert.ok(!serialized.includes(token.raw), "raw token must not be persisted");
    assert.equal(claim.token_hash, hashClaimToken(token.raw), "only the hash-derived value is stored");
    assert.equal(claim.token_prefix, token.raw.slice(0, 8), "prefix is a display hint, not the token");
    assert.ok(claim.token_prefix.length < token.raw.length);
  });

  it("effective status stays truthful for created/claimed/approved/executed", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const now = "2026-08-13T00:00:00.000Z";
    const { claim } = await makeClaim(repo, workspace);
    assert.equal(effectiveClaimStatus(claim, now), "created");
    await repo.transitionClaimStatus(claim.id, ["created"], "claimed");
    assert.equal(effectiveClaimStatus((await repo.getClaimLinkById(claim.id)) as never, now), "claimed");
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
    assert.equal(effectiveClaimStatus((await repo.getClaimLinkById(claim.id)) as never, now), "approved");
    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    assert.equal(effectiveClaimStatus((await repo.getClaimLinkById(claim.id)) as never, now), "executed");
  });
});
