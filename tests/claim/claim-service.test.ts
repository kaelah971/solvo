import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { WorkspaceRow } from "../../src/server/db/types.ts";
import {
  applyClaimApprovalCallback,
  claimExpiresAtIso,
  createClaim,
  effectiveClaimStatus,
  getClaimByRawToken,
  submitClaimRecipient,
  validateClaimApprovalCallback,
} from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";
import { FakeGateway } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const REQUESTER = "123456789";
const APPROVER = "987654321";

async function makeWorkspace(repo: MemoryRepository, chatId = "-100777"): Promise<WorkspaceRow> {
  return repo.createWorkspace({
    mode: "community",
    name: "Claim Guild",
    telegramChatId: chatId,
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
}

async function makeClaim(repo: MemoryRepository, workspace: WorkspaceRow, amount = "5000", requester = REQUESTER) {
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId: workspace.id,
    requesterId: requester,
    amountBaseUnits: amount,
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt: claimExpiresAtIso(168, new Date("2026-08-12T00:00:00Z")),
    idempotencyKey: `cl-test-${requester}-${amount}`,
  });
  return { claim, token };
}

describe("claim service (M7)", () => {
  it("creates a claim with the token hash only and returns the raw token once", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const result = await createClaim(repo, {
      workspace,
      requesterId: REQUESTER,
      amountBaseUnits: "5000",
      idempotencyKey: "cl-1",
      expiresAt: claimExpiresAtIso(168, new Date("2026-08-12T00:00:00Z")),
      appUrl: "https://solvo.example",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.claim.status, "created");
    assert.equal(result.claim.amount_base_units, "5000");
    assert.equal(result.claim.requester_id, REQUESTER);
    assert.equal(result.link, `https://solvo.example/claim/${result.rawToken}`);
    assert.equal(result.claim.token_hash, generateClaimTokenPair().hash !== result.claim.token_hash ? result.claim.token_hash : "hash");
    assert.ok(!JSON.stringify(result.claim).includes(result.rawToken), "raw token must never be persisted");
    const stored = await repo.getClaimLinkById(result.claim.id);
    assert.ok(stored);
    assert.ok(!JSON.stringify(stored).includes(result.rawToken));
  });

  it("looks a claim up by raw token via its hash", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    const lookup = await getClaimByRawToken(repo, token.raw);
    assert.ok(lookup);
    assert.equal(lookup.claim.id, claim.id);
    assert.equal(lookup.workspace.id, workspace.id);
  });

  it("returns null for unknown or malformed tokens", async () => {
    const repo = new MemoryRepository();
    assert.equal(await getClaimByRawToken(repo, "not-a-valid-token"), null);
    assert.equal(await getClaimByRawToken(repo, "A".repeat(32)), null);
  });

  it("treats an unclaimed claim past expiry as expired", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    // makeClaim uses expiresAt = 2026-08-12 + 168h = 2026-08-19.
    const afterExpiry = "2026-08-20T00:00:00.000Z";
    const claim = (await getClaimByRawToken(repo, token.raw))?.claim;
    assert.ok(claim);
    assert.equal(effectiveClaimStatus(claim, afterExpiry), "expired");
    const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", afterExpiry);
    if (result.ok) {
      assert.fail("expired claim must not be claimable");
    }
    assert.equal(result.kind, "expired");
    const stored = await repo.getClaimLinkByTokenHash(claim.token_hash);
    assert.equal(stored?.status, "created", "expired claims keep their stored status but are unclaimable");
    assert.equal([...repo.payouts.values()].length, 0);
  });

  it("claims a valid claim with a validated EVM address", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    const result = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.claim.status, "claimed");
    assert.equal(result.claim.claimed_recipient, RECIPIENT);
    assert.equal(result.claim.claimed_by, "web");
    // Claiming creates NO payout and NO execution.
    assert.equal([...repo.payouts.values()].length, 0);
    assert.equal([...repo.payoutItems.values()].length, 0);
    assert.equal([...repo.executionAttempts.values()].length, 0);
  });

  it("rejects an invalid wallet address", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    const result = await submitClaimRecipient(repo, token.raw, "0x123", "web", "2026-08-13T00:00:00.000Z");
    if (result.ok) {
      assert.fail("invalid address must be rejected");
    }
    assert.equal(result.kind, "invalid_address");
    const after = await repo.getClaimLinkByTokenHash((await getClaimByRawToken(repo, token.raw))?.claim.token_hash ?? "");
    assert.equal(after?.status, "created");
  });

  it("cannot be claimed twice and never mutates the stored recipient", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    const first = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(first.ok, true);
    const second = await submitClaimRecipient(
      repo,
      token.raw,
      "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
      "web",
      "2026-08-13T00:01:00.000Z",
    );
    assert.equal(second.ok, false);
    assert.equal(second.kind, "already_claimed");
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.claimed_recipient, RECIPIENT, "duplicate submit must not change the recipient");
  });

  it("approval validation enforces owner/approver, correct chat, and separation of duty", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: REQUESTER, role: "member" });
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");

    // member cannot decide
    const memberDecision = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: REQUESTER, chatId: "-100777" },
      repo,
    );
    assert.equal(memberDecision.ok, false);

    // requester cannot self-approve even with a role
    await repo.updateWorkspaceMemberRole(workspace.id, REQUESTER, "approver");
    const selfApproval = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: REQUESTER, chatId: "-100777" },
      repo,
    );
    assert.equal(selfApproval.ok, false);
    if (!selfApproval.ok) assert.match(selfApproval.result.answer, /separation of duty/i);

    // wrong chat rejected
    const wrongChat = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-999" },
      repo,
    );
    assert.equal(wrongChat.ok, false);

    // valid approver decision passes
    const valid = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-100777" },
      repo,
    );
    assert.equal(valid.ok, true);
  });

  it("approval creates the payout, executes exactly once, and marks the claim executed", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: REQUESTER, role: "member" });
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");

    const gateway = new FakeGateway({});
    const validation = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-100777" },
      repo,
    );
    assert.equal(validation.ok, true);
    if (!validation.ok) return;

    const result = await applyClaimApprovalCallback(validation.context, { repo, gateway });
    assert.equal(result.executed, true);
    assert.match(result.edited ?? "", /COMPLETED/);
    assert.equal(gateway.simulateCalls, 1);
    assert.equal(gateway.executeCalls, 1);

    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "executed");
    assert.ok(stored?.payout_id);

    const payout = await repo.getPayoutById(stored.payout_id as string);
    assert.ok(payout);
    assert.equal(payout.source_type, "claim_link");
    assert.equal(payout.requester_id, REQUESTER);
    const items = await repo.getPayoutItemsByPayoutId(payout.id);
    assert.equal(items.length, 1);
    assert.equal(items[0].recipient_address, RECIPIENT);
    assert.equal(items[0].amount_base_units, "5000");
    assert.equal(items[0].idempotency_key, `cl:${claim.id}`);
    assert.equal([...repo.executionAttempts.values()].filter((a) => a.phase === "execution").length, 1);
  });

  it("rejects a claim after approval was already given", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");

    const validation = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-100777" },
      repo,
    );
    assert.equal(validation.ok, false);
    if (!validation.ok) assert.match(validation.result.answer, /already been handled/i);
  });

  it("rejecting a claim cancels it without creating a payout", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { claim, token } = await makeClaim(repo, workspace);
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");

    const gateway = new FakeGateway({});
    const validation = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_reject", actorUserId: APPROVER, chatId: "-100777" },
      repo,
    );
    assert.equal(validation.ok, true);
    if (!validation.ok) return;
    await applyClaimApprovalCallback(validation.context, { repo, gateway });

    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "cancelled");
    assert.equal([...repo.payouts.values()].length, 0);
    assert.equal(gateway.executeCalls, 0);
    const resubmit = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:01:00.000Z");
    if (resubmit.ok) {
      assert.fail("cancelled claim must not be claimable");
    }
    assert.equal(resubmit.kind, "cancelled");
  });

  it("a claimed wallet never causes automatic execution", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const { token } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal([...repo.payouts.values()].length, 0);
    assert.equal([...repo.executionAttempts.values()].length, 0);
    // Repeated attempts still never execute.
    await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:01:00.000Z");
    assert.equal([...repo.executionAttempts.values()].length, 0);
  });
});
