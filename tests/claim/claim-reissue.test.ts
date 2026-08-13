import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { ClaimLinkRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";
import { getEffectiveClaimStatus } from "../../src/server/claim/status.ts";
import { buildClaimWebPage } from "../../src/server/claim/web.ts";
import { claimStatusFoundMessage } from "../../src/server/claim/messages.ts";
import { reissueClaimLink } from "../../src/server/claim/reissue.ts";
import {
  submitClaimRecipient,
  validateClaimApprovalCallback,
  createClaim,
  claimExpiresAtIso,
} from "../../src/server/claim/service.ts";
import { generateClaimTokenPair, hashClaimToken } from "../../src/server/claim/token.ts";
import { redactSecrets } from "../../src/server/telegram/safe-logging.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const REQUESTER = "123456789";
const OWNER = "111222333";
const APPROVER = "444555666";
const MEMBER = "777888999";
const NOW = "2026-08-13T00:00:00.000Z";
const AFTER_EXPIRY = "2026-08-20T00:00:00.000Z";
const EXPIRES_AT = "2026-08-19T00:00:00.000Z";
const TX_HASH = "0x" + "ab".repeat(32);
const BASE_SCAN = `https://basescan.org/tx/${TX_HASH}`;
const APP_URL = "https://solvo.example";

async function makeFixture() {
  const repo = new MemoryRepository();
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode: "community",
    name: "Reissue WS",
    telegramChatId: "-100777",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
    status: "active",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: REQUESTER, role: "member" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: OWNER, role: "owner" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
  return { repo, workspace };
}

async function makeClaim(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  overrides: Partial<{ claimed: boolean; cancelled: boolean; expiresAt: string }> = {},
): Promise<{ claim: ClaimLinkRow; rawToken: string }> {
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId: workspace.id,
    requesterId: REQUESTER,
    amountBaseUnits: "5000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt: overrides.expiresAt ?? EXPIRES_AT,
    idempotencyKey: `st-${randomUUID()}`,
  });
  if (overrides.claimed) {
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: NOW });
  }
  if (overrides.cancelled) {
    await repo.transitionClaimStatus(claim.id, ["created"], "cancelled");
  }
  return { claim: (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow, rawToken: token.raw };
}

async function member(
  repo: MemoryRepository,
  workspace: WorkspaceRow | string,
  userId: string,
): Promise<WorkspaceMemberRow | null> {
  const workspaceId = typeof workspace === "string" ? workspace : workspace.id;
  return repo.getWorkspaceMember(workspaceId, userId);
}

async function approvePipeline(repo: MemoryRepository, workspace: WorkspaceRow, claim: ClaimLinkRow) {
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

async function completePipeline(repo: MemoryRepository, workspace: WorkspaceRow, claim: ClaimLinkRow) {
  const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
  await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
  await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
  await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
  await repo.completePayoutItem(itemId, TX_HASH, BASE_SCAN);
  await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
  return { payoutId, itemId };
}

function assertNoMoneyArtifacts(repo: MemoryRepository): void {
  assert.equal(repo.payouts.size, 0, "no payout may be created");
  assert.equal(repo.payoutItems.size, 0, "no payout item may be created");
  assert.equal(repo.executionAttempts.size, 0, "no execution attempt may be created");
}

describe("M11.5 expiry rules", () => {
  it("1. a pending claim past expires_at reads expired", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    assert.equal(getEffectiveClaimStatus(claim, AFTER_EXPIRY), "expired");
    assert.equal(getEffectiveClaimStatus(claim, NOW), "pending");
  });

  it("2. the expired read does not mutate the claim row", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    getEffectiveClaimStatus(claim, AFTER_EXPIRY);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "created", "expired must never be persisted");
    assert.equal(stored?.expires_at, EXPIRES_AT);
  });

  it("3. submitting a wallet to an expired claim fails safely", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim, rawToken } = await makeClaim(repo, workspace);
    const result = await submitClaimRecipient(repo, rawToken, RECIPIENT, "web", AFTER_EXPIRY);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "expired");
    assert.equal((await repo.getClaimLinkById(claim.id))?.status, "created");
    assertNoMoneyArtifacts(repo);
  });

  it("4. an expired claim cannot be approved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    // Approval validation only accepts `claimed` claims; an expired (created)
    // claim is rejected before any state change.
    const validation = await validateClaimApprovalCallback(
      { claimId: claim.id, action: "claim_approve", actorUserId: APPROVER, chatId: "-100777" },
      repo,
    );
    assert.equal(validation.ok, false);
    if (!validation.ok) assert.match(validation.result.answer, /already been handled/i);
    assert.equal((await repo.getClaimLinkById(claim.id))?.status, "created");
  });

  it("5. an expired claim creates no payout or execution", async () => {
    const { repo, workspace } = await makeFixture();
    const { rawToken } = await makeClaim(repo, workspace);
    await submitClaimRecipient(repo, rawToken, RECIPIENT, "web", AFTER_EXPIRY);
    assertNoMoneyArtifacts(repo);
  });

  it("6. a claimed claim past expires_at remains claimed", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    assert.equal(getEffectiveClaimStatus(claim, AFTER_EXPIRY), "claimed");
  });

  it("7. an approved claim past expires_at remains approved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await approvePipeline(repo, workspace, claim);
    const stored = (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow;
    assert.equal(getEffectiveClaimStatus(stored, AFTER_EXPIRY), "approved");
  });

  it("8. a completed claim past expires_at remains completed when pipeline proof exists", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await completePipeline(repo, workspace, claim);
    const stored = (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow;
    assert.equal(getEffectiveClaimStatus(stored, AFTER_EXPIRY), "unknown", "claim row alone cannot confirm");
    const payout = await repo.getPayoutById(stored.payout_id as string);
    const items = payout ? await repo.getPayoutItemsByPayoutId(payout.id) : [];
    const { buildClaimStatusView } = await import("../../src/server/claim/status.ts");
    const view = buildClaimStatusView({ claim: stored, nowIso: AFTER_EXPIRY, payout, items });
    assert.equal(view.effectiveStatus, "completed");
  });
});

describe("M11.5 reissue rules", () => {
  it("9-10. reissuing an expired claim creates a new claim row and returns the new raw token once", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const before = repo.claimLinks.size;
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
      appUrl: APP_URL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(repo.claimLinks.size, before + 1, "exactly one new claim row");
    assert.equal(result.claimId !== claim.id, true);
    assert.match(result.rawToken, /^[A-Za-z0-9_-]{32}$/);
    assert.equal(result.link, `${APP_URL}/claim/${result.rawToken}`);
    const stored = await repo.getClaimLinkById(result.claimId);
    assert.equal(stored?.status, "created");
    assert.equal(stored?.token_hash, hashClaimToken(result.rawToken), "only the hash of the new token is stored");
    assert.equal(stored?.token_hash.includes(result.rawToken), false);
  });

  it("11-12. the new token hash differs from the old and the old raw token is never returned", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim, rawToken: oldRaw } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
      appUrl: APP_URL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const oldStored = await repo.getClaimLinkById(claim.id);
    const newStored = await repo.getClaimLinkById(result.claimId);
    assert.ok(oldStored && newStored);
    assert.notEqual(newStored.token_hash, oldStored.token_hash);
    assert.equal(result.rawToken !== oldRaw, true);
    assert.equal(JSON.stringify(result).includes(oldRaw), false, "old raw token leaked into the result");
  });

  it("13. the old claim remains expired/closed after reissue", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    const old = await repo.getClaimLinkById(claim.id);
    assert.ok(old);
    assert.equal(old.status, "created", "old claim row is never mutated");
    assert.equal(getEffectiveClaimStatus(old, AFTER_EXPIRY), "expired");
  });

  it("14. the old token remains unusable after reissue", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim, rawToken: oldRaw } = await makeClaim(repo, workspace);
    await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    const oldClaim = await repo.getClaimLinkByTokenHash(hashClaimToken(oldRaw));
    assert.equal(oldClaim?.id, claim.id, "the old token still resolves to the OLD claim");
    const resubmit = await submitClaimRecipient(repo, oldRaw, RECIPIENT, "web", AFTER_EXPIRY);
    assert.equal(resubmit.ok, false);
    if (!resubmit.ok) assert.equal(resubmit.kind, "expired");
  });

  it("15. the new claim has a fresh expiry", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, APPROVER),
      claimId: claim.id,
      nowIso: "2026-08-14T00:00:00.000Z",
      claimExpiryHours: 72,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.expiresAt, "2026-08-17T00:00:00.000Z");
    const stored = await repo.getClaimLinkById(result.claimId);
    assert.equal(stored?.expires_at, "2026-08-17T00:00:00.000Z");
  });

  it("16. the new claim keeps the same amount/currency/network/workspace/requester", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.amountBaseUnits, "5000");
    assert.equal(result.currency, "USDC");
    assert.equal(result.chainId, CHAIN);
    assert.equal(result.workspaceId, workspace.id);
    assert.equal(result.requesterId, REQUESTER);
    const stored = await repo.getClaimLinkById(result.claimId);
    assert.equal(stored?.token_address, TOKEN);
    assert.equal(stored?.workspace_id, workspace.id);
    assert.equal(stored?.requester_id, REQUESTER);
  });

  it("17. reissue records an audit event with old/new claim source metadata", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, APPROVER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const reissued = repo.auditEvents.filter((event) => event.event_type === "claim_reissued");
    assert.equal(reissued.length, 1);
    assert.equal(reissued[0].metadata.oldClaimId, claim.id);
    assert.equal(reissued[0].metadata.newClaimId, result.claimId);
    assert.equal(reissued[0].actor_type, "approver");
    assert.equal(reissued[0].actor_id, APPROVER);
  });

  it("18-20. claimed/approved/completed claims cannot be reissued", async () => {
    const { repo, workspace } = await makeFixture();
    const claimed = await makeClaim(repo, workspace, { claimed: true });
    const claimedResult = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claimed.claim.id,
      nowIso: NOW,
    });
    assert.equal(claimedResult.ok, false);
    if (!claimedResult.ok) assert.equal(claimedResult.kind, "ineligible");

    const approved = await makeClaim(repo, workspace, { claimed: true });
    await approvePipeline(repo, workspace, approved.claim);
    const approvedResult = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: approved.claim.id,
      nowIso: NOW,
    });
    assert.equal(approvedResult.ok, false);
    if (!approvedResult.ok) assert.equal(approvedResult.kind, "ineligible");

    const completed = await makeClaim(repo, workspace, { claimed: true });
    await completePipeline(repo, workspace, completed.claim);
    const completedResult = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: completed.claim.id,
      nowIso: NOW,
    });
    assert.equal(completedResult.ok, false);
    if (!completedResult.ok) assert.equal(completedResult.kind, "ineligible");
  });

  it("21. a wrong-workspace reissue is denied and leaks nothing", async () => {
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
    await repo.addWorkspaceMember({ workspaceId: otherWorkspace.id, telegramUserId: "999000111", role: "owner" });
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, otherWorkspace.id, "999000111"),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "denied");
    assert.equal("claimId" in result, false, "a denied reissue leaks no claim id");
    assert.equal(repo.claimLinks.size, 1, "no new claim row");
    const unknown = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: "00000000-0000-4000-8000-000000000000",
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, result.ok ? "" : result.reason, "denied reasons must be identical");
  });

  it("22. a nonmember or inactive member cannot reissue", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const noMember = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: null,
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(noMember.ok, false);
    if (!noMember.ok) assert.equal(noMember.kind, "denied");

    await repo.removeWorkspaceMember(workspace.id, APPROVER);
    const stale = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await repo.getWorkspaceMember(workspace.id, REQUESTER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.kind, "denied");
    assert.equal(repo.claimLinks.size, 1);
  });

  it("23. a normal member cannot reissue even when active", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, MEMBER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "denied");
    assert.equal(repo.claimLinks.size, 1);
  });

  it("24-26. reissue creates no payout, payout item, or execution attempt", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(result.ok, true);
    assertNoMoneyArtifacts(repo);
  });

  it("27. reissue does not expose the token hash or prefix", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
      appUrl: APP_URL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("token_hash"), false);
    assert.equal(serialized.includes("token_prefix"), false);
    const stored = await repo.getClaimLinkById(result.claimId);
    assert.ok(stored);
    assert.equal(serialized.includes(stored.token_hash), false, "the stored hash leaked");
    // The raw token is legitimately returned once; its own 8-char prefix is a
    // substring of it by construction, but never a separate field.
    assert.equal("tokenPrefix" in result, false);
    assert.equal("token_prefix" in result, false);
  });

  it("28. repeated reissue creates distinct links only when explicitly requested", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const first = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    const second = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.notEqual(first.claimId, second.claimId);
    assert.notEqual(first.rawToken, second.rawToken);
    assert.equal(repo.claimLinks.size, 3, "old + two explicitly requested reissues");
    assert.equal(repo.auditEvents.filter((event) => event.event_type === "claim_reissued").length, 2);
  });

  it("29. the web expired page state remains no-submit", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const { buildClaimStatusView } = await import("../../src/server/claim/status.ts");
    const view = buildClaimStatusView({ claim, nowIso: AFTER_EXPIRY, payout: null, items: [] });
    const page = buildClaimWebPage(view);
    assert.equal(page.state, "expired");
    const pageSource = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    assert.match(pageSource, /case "expired":/);
  });

  it("30. the Telegram expired status keeps no-funds-moved copy", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const { buildClaimStatusView } = await import("../../src/server/claim/status.ts");
    const view = buildClaimStatusView({ claim, nowIso: AFTER_EXPIRY, payout: null, items: [] });
    const text = claimStatusFoundMessage(view);
    assert.match(text, /CLAIM EXPIRED/);
    assert.match(text, /No funds moved from this expired claim\./);
  });

  it("31. the reissue service imports no KeeperHub/MCP/execution writer/model provider", () => {
    const source = readFileSync("src/server/claim/reissue.ts", "utf8");
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
    ]) {
      assert.equal(imports.includes(banned), false, `reissue.ts imports ${banned}`);
    }
  });

  it("32. raw token redaction still works in logs for reissued links", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: AFTER_EXPIRY,
      appUrl: APP_URL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const url = `${APP_URL}/claim/${result.rawToken}`;
    const redacted = redactSecrets(`user opened ${url} and it failed`);
    assert.equal(redacted.includes(result.rawToken), false, "the reissued raw token reached a log");
    assert.equal(redacted.includes(`claim/${result.rawToken}`), false);
    assert.match(redacted, /\[REDACTED:CLAIM_TOKEN\]/);
  });

  it("a pending (not yet expired) created claim can be reissued with a fresh link", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.claimId !== claim.id, true);
    assert.equal((await repo.getClaimLinkById(result.claimId))?.status, "created");
    const old = await repo.getClaimLinkById(claim.id);
    assert.equal(getEffectiveClaimStatus(old as ClaimLinkRow, NOW), "pending", "old claim keeps its own state");
  });

  it("a cancelled claim can be reissued and stays cancelled", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { cancelled: true });
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: claim.id,
      nowIso: NOW,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const old = (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow;
    assert.equal(old.status, "cancelled", "the cancelled claim is never resurrected");
    assert.equal(getEffectiveClaimStatus(old, NOW), "rejected");
    assert.equal((await repo.getClaimLinkById(result.claimId))?.status, "created");
  });

  it("reissue uses the standard claim creation path (createClaim-compatible surface)", async () => {
    const { repo, workspace } = await makeFixture();
    const created = await createClaim(repo, {
      workspace,
      requesterId: REQUESTER,
      amountBaseUnits: "5000",
      idempotencyKey: "reissue-surface-1",
      expiresAt: claimExpiresAtIso(168, new Date("2026-08-12T00:00:00Z")),
      appUrl: APP_URL,
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const result = await reissueClaimLink({
      repo,
      workspaceId: workspace.id,
      member: await member(repo, workspace, OWNER),
      claimId: created.claim.id,
      nowIso: "2026-08-20T00:00:00.000Z",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.amountBaseUnits, "5000");
    assert.equal(repo.claimLinks.size, 2);
  });
});
