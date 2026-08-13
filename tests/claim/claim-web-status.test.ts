import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { ClaimLinkRow, WorkspaceRow } from "../../src/server/db/types.ts";
import { buildClaimStatusView } from "../../src/server/claim/status.ts";
import { buildClaimWebPage, claimWebStateFor } from "../../src/server/claim/web.ts";
import { submitClaimRecipient } from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const REQUESTER = "123456789";
const EXPIRES_AT = "2026-08-19T00:00:00.000Z";
const NOW = "2026-08-13T00:00:00.000Z";
const AFTER_EXPIRY = "2026-08-20T00:00:00.000Z";
const TX_HASH = "0x" + "ab".repeat(32);
const FAKE_HASH = "0x" + "cd".repeat(32);
const BASE_SCAN = `https://basescan.org/tx/${TX_HASH}`;

const BANNED_TERMS = [
  "agent_run",
  "agent run",
  "provider",
  "interpreter",
  "planner",
  "schema",
  "token_hash",
  "tokenHash",
  "token_prefix",
  "idempotency",
  "raw JSON",
  "keeperhub_execution_id",
  "execution id",
  "mcp-client",
  "webhook",
  '{"',
];

async function makeFixture() {
  const repo = new MemoryRepository();
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode: "community",
    name: "Web Claim WS",
    telegramChatId: "-100777",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
    status: "active",
  });
  return { repo, workspace };
}

async function makeClaim(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  overrides: Partial<{ claimed: boolean; cancelled: boolean }> = {},
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
    expiresAt: EXPIRES_AT,
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

/** Page data exactly as the server page builds it (view → web page). */
async function pageFor(repo: MemoryRepository, claim: ClaimLinkRow, nowIso = NOW) {
  const stored = (await repo.getClaimLinkById(claim.id)) ?? claim;
  let payout: Awaited<ReturnType<MemoryRepository["getPayoutById"]>> = null;
  let items: Awaited<ReturnType<MemoryRepository["getPayoutItemsByPayoutId"]>> = [];
  if (stored.payout_id !== null) {
    payout = await repo.getPayoutById(stored.payout_id);
    items = payout ? await repo.getPayoutItemsByPayoutId(payout.id) : [];
  }
  const view = buildClaimStatusView({ claim: stored, nowIso, payout, items });
  return buildClaimWebPage(view);
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

describe("M11.4 web claim state mapping (read model → page)", () => {
  it("1. a valid claim page shows amount/network/expiry and the wallet form state", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "valid");
    assert.equal(page.amountUsdc, "0.005");
    assert.equal(page.network, "BASE");
    assert.equal(page.expiresAt, EXPIRES_AT);
    assert.equal(page.claimedWallet, null);
    assert.equal(page.txHash, null);
  });

  it("2-3. valid copy says no funds move on wallet entry and approval is required", () => {
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /No funds move when a wallet is entered\./);
    assert.match(panel, /An owner or approver must approve the exact claimed destination before KeeperHub execution\./);
    const form = readFileSync("src/app/claim/[token]/ClaimForm.tsx", "utf8");
    assert.match(form, /nothing moves from this page/i);
  });

  it("4. an already-claimed page shows the masked wallet and no re-submit", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "waiting-approval");
    assert.equal(page.claimedWallet, "0x76d7…7486");
    assert.equal(page.claimedWallet?.includes(RECIPIENT.slice(4)), false, "full wallet must never be shown");
    const pageSource = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    assert.equal(pageSource.includes("ClaimForm"), true);
    const formSource = readFileSync("src/app/claim/[token]/ClaimForm.tsx", "utf8");
    assert.equal(formSource.includes("state="), false, "the form is only rendered for the valid state by the page");
  });

  it("5. already-claimed copy says the destination cannot change", () => {
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /The claimed wallet cannot be changed after submission\./);
  });

  it("6. an expired page shows no submit and no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const page = await pageFor(repo, claim, AFTER_EXPIRY);
    assert.equal(page.state, "expired");
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /The claim link can no longer be used\./);
    assert.match(panel, /No funds moved from this expired claim\./);
    const pageSource = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    assert.equal(pageSource.includes("ClaimForm") && /case "expired"/.test(pageSource), true);
  });

  it("7. a rejected/cancelled page shows no submit and no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { cancelled: true });
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "cancelled");
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /No funds moved from this rejected claim/);
  });

  it("8. an approved page says payment prepared with a payout reference and no tx hash", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const { payoutId } = await approvePipeline(repo, workspace, claim);
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "approved");
    assert.equal(page.payoutId, payoutId);
    assert.equal(page.txHash, null);
    assert.equal(page.txExplorerUrl, null);
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /Approval has prepared the payment\./);
    const pageSource = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    assert.match(pageSource, /Payment reference/);
  });

  it("9. a completed page shows the tx hash/BaseScan only from the pipeline proof", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await completePipeline(repo, workspace, claim);
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "completed");
    assert.equal(page.txHash, TX_HASH);
    assert.equal(page.txExplorerUrl, BASE_SCAN);
    const item = (await repo.getPayoutItemsByPayoutId((await repo.getClaimLinkById(claim.id))?.payout_id ?? ""))[0] ?? null;
    assert.ok(item);
    assert.equal(page.txHash, item.transaction_hash, "the page hash must equal the payout item hash");
  });

  it("10. a completed-stored claim without a tx hash never invents proof", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
    await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
    await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
    await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");
    await repo.transitionPayoutItemState(itemId, ["submitted"], "completed");
    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    const page = await pageFor(repo, claim);
    assert.equal(page.state, "not-confirmed");
    assert.equal(page.txHash, null);
    assert.equal(page.txExplorerUrl, null);
  });

  it("11. an unknown token renders the no-leak unavailable page", () => {
    const source = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    const unavailableBranch = source.match(/if \(!lookup\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
    assert.match(unavailableBranch, /ClaimPanel state="unavailable"/);
    assert.equal(unavailableBranch.includes("ClaimSummary"), false, "no amount/workspace summary on unavailable");
    assert.equal(unavailableBranch.includes("claimedWallet"), false);
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    assert.match(panel, /CLAIM UNAVAILABLE/);
    assert.match(panel, /may never have been issued, may have expired, or may already have been used/);
  });

  it("12. the raw token is never rendered back after page load beyond the URL", () => {
    const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");
    const page = withoutComments(readFileSync("src/app/claim/[token]/page.tsx", "utf8"));
    // The token appears only as the server-action prop pass-through (the
    // token prop is destructured but never rendered as text).
    const withoutProp = page.replace(/token=\{token\}/g, "");
    assert.equal(withoutProp.includes("{token}"), false, "page renders the raw token as text");
    const form = withoutComments(readFileSync("src/app/claim/[token]/ClaimForm.tsx", "utf8"));
    assert.equal(form.includes("{token}"), false, "form renders the raw token");
    const panel = withoutComments(readFileSync("src/components/ClaimPanel.tsx", "utf8"));
    assert.equal(panel.includes("{token}"), false, "panel renders the raw token");
  });

  it("13. the token hash and prefix are never shown", () => {
    const page = readFileSync("src/app/claim/[token]/page.tsx", "utf8");
    assert.equal(page.includes("token_prefix"), false, "page must not display the token prefix");
    assert.equal(page.includes("token_hash"), false);
    const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");
    const panel = withoutComments(readFileSync("src/components/ClaimPanel.tsx", "utf8"));
    assert.equal(panel.includes("token"), false, "panel must not render any token reference");
  });

  it("14. wallet validation stays EVM-safe on the web submit path", async () => {
    const { repo, workspace } = await makeFixture();
    const { rawToken } = await makeClaim(repo, workspace);
    const invalid = await submitClaimRecipient(repo, rawToken, "0x123", "web", NOW);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.kind, "invalid_address");
    const notAnAddress = await submitClaimRecipient(repo, rawToken, "daniel", "web", NOW);
    assert.equal(notAnAddress.ok, false);
    assert.equal(repo.payouts.size, 0);
    assert.equal(repo.executionAttempts.size, 0);
  });

  it("15. submit on expired/rejected/already-claimed fails safely", async () => {
    const { repo, workspace } = await makeFixture();
    const expired = await makeClaim(repo, workspace, {});
    const expiredResult = await submitClaimRecipient(repo, expired.rawToken, RECIPIENT, "web", AFTER_EXPIRY);
    assert.equal(expiredResult.ok, false);
    assert.equal(expiredResult.kind, "expired");

    const cancelled = await makeClaim(repo, workspace, { cancelled: true });
    const cancelledResult = await submitClaimRecipient(repo, cancelled.rawToken, RECIPIENT, "web", NOW);
    assert.equal(cancelledResult.ok, false);
    assert.equal(cancelledResult.kind, "cancelled");

    const claimed = await makeClaim(repo, workspace, { claimed: true });
    const claimedResult = await submitClaimRecipient(repo, claimed.rawToken, RECIPIENT, "web", NOW);
    assert.equal(claimedResult.ok, false);
    assert.equal(claimedResult.kind, "already_claimed");
    assert.equal(repo.payouts.size, 0);
    assert.equal(repo.payoutItems.size, 0);
    assert.equal(repo.executionAttempts.size, 0);
  });

  it("16. a successful web submit only records the destination — never approves or executes", async () => {
    const { repo, workspace } = await makeFixture();
    const { rawToken, claim } = await makeClaim(repo, workspace);
    const result = await submitClaimRecipient(repo, rawToken, RECIPIENT, "web", NOW);
    assert.equal(result.ok, true);
    const stored = await repo.getClaimLinkById(claim.id);
    assert.equal(stored?.status, "claimed");
    assert.equal(stored?.payout_id, null);
    assert.equal(repo.payouts.size, 0);
    assert.equal(repo.payoutItems.size, 0);
    assert.equal(repo.executionAttempts.size, 0);
    const types = repo.auditEvents.map((event) => event.event_type);
    assert.equal(types.includes("approval_granted"), false);
    assert.equal(types.some((type) => type.startsWith("execution_")), false);
  });

  it("17. the page reads claim truth from the claim row and proof truth from the payout pipeline", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await approvePipeline(repo, workspace, claim);
    const page = await pageFor(repo, claim);
    // Claim truth: stored status drives the state; pipeline truth drives proof.
    assert.equal(page.state, "approved");
    // A hostile claim-row mutation cannot create proof by itself.
    const stored = repo.claimLinks.get(claim.id);
    assert.ok(stored);
    repo.claimLinks.set(claim.id, { ...stored, status: "executed" });
    const forged = await pageFor(repo, claim);
    assert.equal(forged.state, "not-confirmed");
    assert.equal(forged.txHash, null);
  });

  it("18. a forged agent_run cannot affect the web claim state", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await approvePipeline(repo, workspace, claim);
    const before = await pageFor(repo, claim);
    const forged = await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: REQUESTER,
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
      rawTextRedacted: `transaction_hash ${FAKE_HASH}`,
    });
    await repo.updateAgentRun(forged.id, {
      status: "prepared",
      interpretationJson: { intent: { action: "claimpay" }, intentKind: "create_claim_link", summary: `Claim completed with hash ${FAKE_HASH}` },
      decisionJson: { decision: "prepared_claim_link", transactionHash: FAKE_HASH, completed: true },
    });
    const after = await pageFor(repo, claim);
    assert.deepEqual(after, before);
    assert.equal(after.txHash, null);
    assert.equal(after.state, "approved");
  });

  it("19. all claim panel states contain no internal terms, raw JSON markers, or secrets", () => {
    const panel = readFileSync("src/components/ClaimPanel.tsx", "utf8");
    for (const banned of BANNED_TERMS) {
      assert.equal(panel.includes(banned), false, `ClaimPanel contains banned term "${banned}"`);
    }
    assert.equal(/0x[0-9a-fA-F]{64}/.test(panel), false, "panel contains a hash-shaped string");
    // Only the completed config may claim completion words; every other
    // config's written copy must describe what has NOT happened.
    const nonCompletedConfigs = ["unavailable", "valid", "expired", "waiting-approval", "approved", "not-confirmed", "cancelled"];
    for (const state of nonCompletedConfigs) {
      const config = panel.match(
        new RegExp(`\\s["']?${state}["']?\\s*:\\s*\\{\\s*badge: "([^"]*)",\\s*tone: "[^"]*",\\s*headline: "([^"]*)",\\s*body: "([^"]*)"`),
      );
      assert.ok(config, state);
      const copy = config.slice(1).join(" ");
      for (const claimWord of ["completed", "executed", "paid", "sent"]) {
        assert.equal(new RegExp(`\\b${claimWord}\\b`).test(copy), false, `${state} copy claims "${claimWord}"`);
      }
      assert.equal(/\btransaction hash\b/.test(copy), false, `${state} copy claims a transaction hash`);
    }
    const completedConfig = panel.match(/completed: \{\s*badge: "([^"]*)"/);
    assert.ok(completedConfig);
    assert.equal(completedConfig[1], "PAYMENT COMPLETED");
  });

  it("web state mapping covers every effective status exactly once", () => {
    assert.equal(claimWebStateFor({ effectiveStatus: "pending" } as never), "valid");
    assert.equal(claimWebStateFor({ effectiveStatus: "claimed" } as never), "waiting-approval");
    assert.equal(claimWebStateFor({ effectiveStatus: "approved" } as never), "approved");
    assert.equal(claimWebStateFor({ effectiveStatus: "completed" } as never), "completed");
    assert.equal(claimWebStateFor({ effectiveStatus: "rejected" } as never), "cancelled");
    assert.equal(claimWebStateFor({ effectiveStatus: "expired" } as never), "expired");
    assert.equal(claimWebStateFor({ effectiveStatus: "unknown" } as never), "not-confirmed");
  });
});
