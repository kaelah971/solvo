import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { ClaimLinkRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";
import {
  buildClaimStatusView,
  CLAIM_STATUS_NOT_FOUND,
  getClaimStatusForMember,
  type ClaimStatusView,
} from "../../src/server/claim/status.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const REQUESTER = "123456789";
const MEMBER_ID = "555000111";
const EXPIRES_AT = "2026-08-19T00:00:00.000Z";
const NOW = "2026-08-13T00:00:00.000Z";
const AFTER_EXPIRY = "2026-08-20T00:00:00.000Z";
const TX_HASH = "0x" + "ab".repeat(32);
const FAKE_HASH = "0x" + "cd".repeat(32);
const BASE_SCAN = `https://basescan.org/tx/${TX_HASH}`;

async function makeFixture(overrides: { member?: boolean; memberRole?: "owner" | "approver" | "member" } = {}) {
  const repo = new MemoryRepository();
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode: "community",
    name: "Claim Status WS",
    telegramChatId: "-100777",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
    status: "active",
  });
  let member: WorkspaceMemberRow | null = null;
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({
      workspaceId: workspace.id,
      telegramUserId: MEMBER_ID,
      role: overrides.memberRole ?? "member",
    });
    member = (await repo.getWorkspaceMember(workspace.id, MEMBER_ID)) as WorkspaceMemberRow;
  }
  return { repo, workspace, member };
}

async function makeClaim(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  overrides: Partial<{ amountBaseUnits: string; expiresAt: string; status: ClaimLinkRow["status"]; claimedRecipient: string | null; claimedBy: string | null; claimedAt: string | null }> = {},
): Promise<{ claim: ClaimLinkRow; rawToken: string }> {
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId: workspace.id,
    requesterId: REQUESTER,
    amountBaseUnits: overrides.amountBaseUnits ?? "5000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
    idempotencyKey: `st-${randomUUID()}`,
  });
  if (overrides.status === "cancelled") {
    await repo.transitionClaimStatus(claim.id, ["created"], "cancelled");
  }
  if (overrides.claimedRecipient !== null && overrides.claimedRecipient !== undefined) {
    await repo.claimClaimLink({
      claimId: claim.id,
      recipientAddress: overrides.claimedRecipient,
      claimedBy: overrides.claimedBy ?? "web",
      nowIso: overrides.claimedAt ?? NOW,
    });
  }
  return { claim: (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow, rawToken: token.raw };
}

async function viewFor(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  claimId: string,
  nowIso = NOW,
): Promise<ClaimStatusView> {
  const result = await getClaimStatusForMember({
    repo,
    workspaceId: workspace.id,
    member: await repo.getWorkspaceMember(workspace.id, MEMBER_ID),
    claimId,
    nowIso,
  });
  assert.equal(result.outcome, "visible");
  if (result.outcome === "visible") return result.view;
  throw new Error("unreachable");
}

/** Drives a claim to `approved` with the real M7 approval shape (payout + item created, both `approved`). */
async function approvePipeline(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  claim: ClaimLinkRow,
): Promise<{ payoutId: string; itemId: string }> {
  await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
  const payout = await repo.createPayout({
    workspaceId: workspace.id,
    requesterId: claim.requester_id,
    sourceType: "claim_link",
    status: "approved",
    totalAmountBaseUnits: claim.amount_base_units,
    currencySymbol: claim.currency_symbol,
    chainId: claim.chain_id,
    tokenAddress: claim.token_address,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: claim.claimed_recipient as string,
    amountBaseUnits: claim.amount_base_units,
    memo: `claim ${claim.token_prefix}`,
    status: "approved",
    idempotencyKey: `cl:${claim.id}`,
  });
  await repo.setClaimPayoutId(claim.id, payout.id);
  return { payoutId: payout.id, itemId: item.id };
}

/** Drives a claim through the full pipeline to `completed` with a real tx hash. */
async function completePipeline(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  claim: ClaimLinkRow,
): Promise<{ payoutId: string; itemId: string }> {
  const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
  await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
  await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
  await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
  await repo.completePayoutItem(itemId, TX_HASH, BASE_SCAN);
  await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
  return { payoutId, itemId };
}

describe("claim status read model (M11.2)", () => {
  it("1. a pending claim returns pending with expiry surfaced", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "pending");
    assert.equal(view.storedStatus, "created");
    assert.equal(view.expiresAt, EXPIRES_AT);
    assert.equal(view.amount, "0.005");
    assert.equal(view.currency, "USDC");
    assert.equal(view.chainId, CHAIN);
    assert.equal(view.network, "BASE");
    assert.equal(view.claimedWallet, null);
    assert.equal(view.payoutId, null);
    assert.equal(view.payoutState, null);
    assert.equal(view.itemCount, null);
    assert.equal(view.txHash, null);
  });

  it("2. a claimed claim returns claimed with approval required", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "claimed");
    assert.equal(view.storedStatus, "claimed");
    assert.equal(view.claimedWallet, "0x76d7…7486");
    assert.equal(view.claimedAt, NOW);
    assert.match(view.safetyNote, /approve/i);
  });

  it("3. the claimed view says wallet entry did not move funds", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const view = await viewFor(repo, workspace, claim.id);
    assert.match(view.safetyNote, /moved no funds/i);
    assert.equal(view.txHash, null);
    assert.equal(view.payoutId, null);
  });

  it("4. an expired unclaimed claim returns expired using nowIso", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const view = await viewFor(repo, workspace, claim.id, AFTER_EXPIRY);
    assert.equal(view.effectiveStatus, "expired");
    assert.equal(view.storedStatus, "created");
    assert.match(view.safetyNote, /nothing moved/i);
  });

  it("5. expiry is computed and does not mutate the repository", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const snapshot = (map: Map<string, unknown>) => new Map(map);
    const claimsBefore = snapshot(repo.claimLinks);
    await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member,
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "created", "expired must never be written into the claim row");
    assert.deepEqual(repo.claimLinks, claimsBefore);
  });

  it("a claimed claim past expiry stays claimed (expiry applies only to created)", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const view = await viewFor(repo, workspace, claim.id, AFTER_EXPIRY);
    assert.equal(view.effectiveStatus, "claimed");
  });

  it("6. a cancelled claim returns rejected with no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { status: "cancelled" });
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "rejected");
    assert.equal(view.storedStatus, "cancelled");
    assert.match(view.safetyNote, /no funds moved/i);
    assert.equal(view.txHash, null);
  });

  it("7. an approved claim linked to a payout returns approved/payment_prepared with no tx hash", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const { payoutId } = await approvePipeline(repo, workspace, claim);
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "approved");
    assert.equal(view.storedStatus, "approved");
    assert.equal(view.payoutId, payoutId);
    assert.equal(view.payoutState, "approved");
    assert.equal(view.itemCount, 1);
    assert.equal(view.txHash, null);
    assert.match(view.safetyNote, /payment prepared/i);
  });

  it("8. a completed claim returns completed with the tx hash only from the pipeline item", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const { payoutId, itemId } = await completePipeline(repo, workspace, claim);
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "completed");
    assert.equal(view.storedStatus, "executed");
    assert.equal(view.payoutId, payoutId);
    assert.equal(view.payoutState, "completed");
    assert.equal(view.itemCount, 1);
    assert.equal(view.txHash, TX_HASH);
    assert.equal(view.txExplorerUrl, BASE_SCAN);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(view.txHash, item?.transaction_hash, "hash must equal the payout item's hash");
  });

  it("9. a completed-stored claim without a pipeline tx hash never invents proof", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
    // Pipeline reaches completed but the item never receives a tx hash.
    await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
    await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
    await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");
    await repo.transitionPayoutItemState(itemId, ["submitted"], "completed");
    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "unknown", "no completed claim without pipeline proof");
    assert.equal(view.txHash, null, "no invented hash");
    assert.equal(view.txExplorerUrl, null);
    assert.equal(view.payoutState, "completed");
  });

  it("10. an unknown claim id returns the generic no-leak result", async () => {
    const { repo, workspace, member } = await makeFixture();
    const result = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member,
      claimId: "00000000-0000-4000-8000-000000000000",
      nowIso: NOW,
    });
    assert.equal(result, CLAIM_STATUS_NOT_FOUND);
    assert.deepEqual(result, CLAIM_STATUS_NOT_FOUND);
  });

  it("11. a claim from another workspace returns the same generic no-leak result", async () => {
    const { repo, workspace } = await makeFixture();
    const otherWorkspace = await repo.createWorkspace({
      mode: "community",
      name: "Other WS",
      telegramChatId: "-100888",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
      status: "active",
    });
    const { claim } = await makeClaim(repo, otherWorkspace);
    const result = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member: await repo.getWorkspaceMember(workspace.id, MEMBER_ID),
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(result, CLAIM_STATUS_NOT_FOUND);
  });

  it("12. an inactive or non-member returns the same generic no-leak result", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);

    const noMember = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member: null,
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(noMember, CLAIM_STATUS_NOT_FOUND);

    // A member of a DIFFERENT workspace (not this one) cannot see the claim.
    const otherWorkspace = await repo.createWorkspace({
      mode: "community",
      name: "Third WS",
      telegramChatId: "-100999",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
      status: "active",
    });
    await repo.addWorkspaceMember({ workspaceId: otherWorkspace.id, telegramUserId: "777888999", role: "member" });
    const crossWorkspaceMember = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member: await repo.getWorkspaceMember(otherWorkspace.id, "777888999"),
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(crossWorkspaceMember, CLAIM_STATUS_NOT_FOUND);

    // A stale active member object whose DB row was removed is still rejected
    // (the gate re-checks the repository row).
    await repo.removeWorkspaceMember(workspace.id, MEMBER_ID);
    const staleResult = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member,
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(staleResult, CLAIM_STATUS_NOT_FOUND);
  });

  it("13. the raw claim token never appears in the view", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim, rawToken } = await makeClaim(repo, workspace);
    const view = await viewFor(repo, workspace, claim.id);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes(rawToken), false, "the view leaks the raw one-time token");
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored);
    assert.equal(serialized.includes(stored.token_prefix), false, "the view leaks the token prefix");
    assert.equal(serialized.includes(stored.idempotency_key), false, "the view leaks the idempotency key");
  });

  it("14. the token hash never appears in the view", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored);
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(JSON.stringify(view).includes(stored.token_hash), false);
    assert.equal(JSON.stringify(view).includes(stored.token_prefix), false);
    assert.equal(JSON.stringify(view).includes(stored.idempotency_key), false);
  });

  it("15. a forged agent_run with fake completion cannot affect the status view", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const before = await viewFor(repo, workspace, claim.id);
    const forged = await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: MEMBER_ID,
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
      rawTextRedacted: `transaction_hash ${FAKE_HASH}`,
    });
    await repo.updateAgentRun(forged.id, {
      status: "prepared",
      interpretationJson: {
        intent: { action: "claimpay" },
        intentKind: "create_claim_link",
        summary: `Claim completed with hash ${FAKE_HASH}`,
      },
      decisionJson: { decision: "prepared_claim_link", transactionHash: FAKE_HASH, completed: true },
    });
    const after = await viewFor(repo, workspace, claim.id);
    assert.deepEqual(after, before);
    assert.equal(after.txHash, null);
    assert.equal(after.effectiveStatus, "pending");
    assert.equal(JSON.stringify(after).includes(FAKE_HASH), false);
  });

  it("16. claim row text/metadata can never create tx proof", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    // Hostile in-place mutation of the stored claim row: forged executed
    // status with no payout pipeline behind it.
    const stored = repo.claimLinks.get(claim.id);
    assert.ok(stored);
    repo.claimLinks.set(claim.id, {
      ...stored,
      status: "executed",
      claimed_recipient: RECIPIENT.toLowerCase(),
    });
    const view = await viewFor(repo, workspace, claim.id);
    assert.equal(view.effectiveStatus, "unknown");
    assert.equal(view.txHash, null);
    assert.equal(view.txExplorerUrl, null);
    assert.equal(view.payoutId, null);
    assert.match(view.safetyNote, /does not confirm/i);
  });

  it("17. a status read creates no payout, claim, audit, or execution rows", async () => {
    const { repo, workspace, member } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: NOW });

    const sizes = {
      claimLinks: repo.claimLinks.size,
      payouts: repo.payouts.size,
      payoutItems: repo.payoutItems.size,
      executionAttempts: repo.executionAttempts.size,
      auditEvents: repo.auditEvents.length,
      agentRuns: repo.agentRuns.size,
      workspaces: repo.workspaces.size,
      members: repo.members.size,
    };

    await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member,
      claimId: claim.id,
      nowIso: NOW,
    });
    const notFound = await getClaimStatusForMember({
      repo,
      workspaceId: workspace.id,
      member,
      claimId: "00000000-0000-4000-8000-000000000000",
      nowIso: NOW,
    });
    assert.equal(notFound.outcome, "not_found");

    assert.equal(repo.claimLinks.size, sizes.claimLinks);
    assert.equal(repo.payouts.size, sizes.payouts);
    assert.equal(repo.payoutItems.size, sizes.payoutItems);
    assert.equal(repo.executionAttempts.size, sizes.executionAttempts);
    assert.equal(repo.auditEvents.length, sizes.auditEvents);
    assert.equal(repo.agentRuns.size, sizes.agentRuns);
    assert.equal(repo.workspaces.size, sizes.workspaces);
    assert.equal(repo.members.size, sizes.members);
  });

  it("18. the status module imports no execution/KeeperHub/Telegram/webhook/model modules", () => {
    const source = readFileSync("src/server/claim/status.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const banned of [
      "execution-service",
      "keeperhub",
      "mcp-client",
      "judge",
      "webhook",
      "telegram",
      "openai",
      "anthropic",
      "ai-sdk",
      "node:http",
      "agent/",
    ]) {
      assert.equal(imports.includes(banned), false, `status.ts imports ${banned}`);
    }
  });

  it("19. identical input and nowIso produce identical deep-equal views", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const first = await viewFor(repo, workspace, claim.id);
    const second = await viewFor(repo, workspace, claim.id);
    assert.deepEqual(first, second);
  });

  it("20. the view is JSON-serializable", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimedRecipient: RECIPIENT, claimedBy: "web", claimedAt: NOW });
    const view = await viewFor(repo, workspace, claim.id);
    const roundTripped = JSON.parse(JSON.stringify(view)) as ClaimStatusView;
    assert.deepEqual(roundTripped, view);
  });

  it("the pure view builder is deterministic and reads only claim + pipeline rows", () => {
    const claim = {
      id: "claim-1",
      workspace_id: "ws-1",
      requester_id: REQUESTER,
      amount_base_units: "5000",
      currency_symbol: "USDC",
      chain_id: CHAIN,
      token_address: TOKEN,
      token_hash: "0".repeat(64),
      token_prefix: "abc",
      status: "executed" as const,
      claimed_recipient: RECIPIENT,
      claimed_by: "web",
      claimed_at: NOW,
      expires_at: EXPIRES_AT,
      payout_id: "payout-1",
      idempotency_key: "k-1",
      created_at: NOW,
      updated_at: NOW,
    };
    const payout = {
      id: "payout-1",
      workspace_id: "ws-1",
      requester_id: REQUESTER,
      source_type: "claim_link" as const,
      status: "completed",
      total_amount_base_units: "5000",
      currency_symbol: "USDC",
      chain_id: CHAIN,
      token_address: TOKEN,
      created_at: NOW,
      updated_at: NOW,
      approved_at: NOW,
      completed_at: NOW,
      cancelled_at: null,
    };
    const items = [
      {
        id: "item-1",
        payout_id: "payout-1",
        recipient_address: RECIPIENT,
        amount_base_units: "5000",
        memo: null,
        status: "completed",
        keeperhub_execution_id: "keeperhub-exec-1",
        transaction_hash: TX_HASH,
        transaction_explorer_url: BASE_SCAN,
        attempt_count: 1,
        idempotency_key: `cl:claim-1`,
        created_at: NOW,
        updated_at: NOW,
        completed_at: NOW,
      },
    ];
    const view = buildClaimStatusView({ claim, nowIso: NOW, payout, items });
    assert.equal(view.effectiveStatus, "completed");
    assert.equal(view.txHash, TX_HASH);
    const twice = buildClaimStatusView({ claim, nowIso: NOW, payout, items });
    assert.deepEqual(view, twice);
  });
});
