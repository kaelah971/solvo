import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getClaimDetailView, listClaimViews } from "../../src/server/dashboard/claims.ts";
import { listPayoutViews } from "../../src/server/dashboard/payouts.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { addClaim, addPayout, makeFixture, MEMBER, NOW, OWNER, TX_HASH, BASE_SCAN } from "./fixtures.ts";

function ctx(role: "owner" | "approver" | "member", workspaceId: string): DashboardContext {
  return makeDashboardContext({
    workspaceId,
    telegramUserId: role === "owner" ? OWNER : role === "approver" ? "444555666" : MEMBER,
    role,
    status: "active",
    mode: "community",
    nowIso: NOW,
  });
}

describe("claim read model", () => {
  it("lists claims scoped to the workspace using M11 effective status", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" }); // pending
    await addClaim(repo, workspaceId, { status: "claimed" }); // claimed
    await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" }); // expired (computed)
    await addClaim(repo, otherWorkspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" }); // foreign

    const { views } = await listClaimViews(repo, ctx("owner", workspaceId));
    assert.equal(views.length, 3);
    assert.ok(!views.some((view) => view.claimId.startsWith("other")));

    const statuses = views.map((view) => view.effectiveStatus).sort();
    assert.deepEqual(statuses, ["claimed", "expired", "pending"]);
  });

  it("filters by effective status (expired computed, never stored)", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { status: "claimed" });

    const pending = await listClaimViews(repo, ctx("owner", workspaceId), { status: "pending" });
    assert.equal(pending.views.length, 1);
    assert.equal(pending.views[0].effectiveStatus, "pending");

    const expired = await listClaimViews(repo, ctx("owner", workspaceId), { status: "expired" });
    assert.equal(expired.views.length, 1);
    assert.equal(expired.views[0].effectiveStatus, "expired");

    const claimed = await listClaimViews(repo, ctx("owner", workspaceId), { status: "claimed" });
    assert.equal(claimed.views.length, 1);
  });

  it("claim list and detail mask wallets", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, {
      status: "claimed",
      claimedRecipient: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    });

    const { views } = await listClaimViews(repo, ctx("owner", workspaceId));
    assert.equal(views[0].maskedWallet, "0x76d7…7486");

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    assert.equal(detail.maskedWallet, "0x76d7…7486");
    assert.equal(detail.statusView.safetyNote.length > 0, true);
  });

  it("detail never exposes raw token, token hash, or token prefix", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId, tokenHash, tokenPrefix } = await addClaim(repo, workspaceId);

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    const serialized = JSON.stringify(detail);
    assert.ok(!serialized.includes(tokenHash));
    assert.ok(!serialized.includes(tokenPrefix));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("token_prefix"));
  });

  it("proof comes only from the pipeline (completed claim with hash)", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    // Approve claim → pipeline payout + item, then complete the item.
    await repo.transitionClaimStatus(claimId, ["claimed"], "approved");
    const payout = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "claim_link",
      status: "approved",
      totalAmountBaseUnits: "50000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    const { item } = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      amountBaseUnits: "50000",
      memo: "claim",
      status: "approved",
      idempotencyKey: "claim-proof-item",
    });
    await repo.setClaimPayoutId(claimId, payout.id);
    // Pipeline: item completes only after the payout moves approved →
    // simulating → submitted → confirming → completed.
    await repo.completePayoutItem(item.id, TX_HASH, BASE_SCAN);
    for (const [from, to] of [
      ["approved", "simulating"],
      ["simulating", "submitted"],
      ["submitted", "confirming"],
      ["confirming", "completed"],
    ] as const) {
      await repo.transitionPayoutState(payout.id, [from], to);
    }

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    assert.equal(detail.effectiveStatus, "completed");
    assert.equal(detail.statusView.txHash, TX_HASH);
    assert.equal(detail.statusView.txExplorerUrl, BASE_SCAN);
  });

  it("approved claim without pipeline proof shows no hash", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(claimId, ["claimed"], "approved");

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    assert.equal(detail.effectiveStatus, "approved");
    assert.equal(detail.statusView.txHash, null);
  });

  it("stored executed claim without pipeline proof reads not-confirmed (no hash)", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(claimId, ["claimed"], "approved");
    await repo.transitionClaimStatus(claimId, ["approved"], "executed");

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    assert.equal(detail.effectiveStatus, "unknown");
    assert.equal(detail.statusView.txHash, null);
    assert.equal(detail.effectiveStatus, "unknown");
  });

  it("reissue eligibility requires owner/approver AND eligible state", async () => {
    const { repo, workspaceId } = await makeFixture();
    const pending = await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    const expired = await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });
    const cancelled = await addClaim(repo, workspaceId, { status: "cancelled" });
    const claimed = await addClaim(repo, workspaceId, { status: "claimed" });

    // Owner: pending/expired/cancelled eligible; claimed ineligible.
    assert.equal((await getClaimDetailView(repo, ctx("owner", workspaceId), pending.claimId))?.reissueEligible, true);
    assert.equal((await getClaimDetailView(repo, ctx("owner", workspaceId), expired.claimId))?.reissueEligible, true);
    assert.equal((await getClaimDetailView(repo, ctx("owner", workspaceId), cancelled.claimId))?.reissueEligible, true);
    assert.equal((await getClaimDetailView(repo, ctx("owner", workspaceId), claimed.claimId))?.reissueEligible, false);
    assert.match(
      (await getClaimDetailView(repo, ctx("owner", workspaceId), claimed.claimId))?.reissueIneligibleReason ?? "",
      /already claimed or approved/,
    );

    // Approver: same eligibility.
    assert.equal((await getClaimDetailView(repo, ctx("approver", workspaceId), pending.claimId))?.reissueEligible, true);

    // Member: never eligible, role reason.
    const memberDetail = await getClaimDetailView(repo, ctx("member", workspaceId), pending.claimId);
    assert.ok(memberDetail);
    assert.equal(memberDetail.reissueEligible, false);
    assert.match(memberDetail.reissueIneligibleReason ?? "", /owner or approver/);
  });

  it("detail returns null for unknown and cross-workspace claim ids", async () => {
    const { repo, otherWorkspaceId, workspaceId } = await makeFixture();
    const foreign = await addClaim(repo, otherWorkspaceId);

    assert.equal(await getClaimDetailView(repo, ctx("owner", workspaceId), foreign.claimId), null);
    assert.equal(await getClaimDetailView(repo, ctx("owner", workspaceId), "does-not-exist"), null);
    assert.equal(workspaceId.length > 0, true);
  });

  it("linked payout id/state surfaced from the pipeline", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(claimId, ["claimed"], "approved");
    const payout = await repo.createPayout({
      workspaceId,
      requesterId: MEMBER,
      sourceType: "claim_link",
      status: "approved",
      totalAmountBaseUnits: "50000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    });
    await repo.setClaimPayoutId(claimId, payout.id);

    const detail = await getClaimDetailView(repo, ctx("owner", workspaceId), claimId);
    assert.ok(detail);
    assert.equal(detail.payoutId, payout.id);
    assert.equal(detail.statusView.payoutState, "approved");
    assert.equal(detail.statusView.itemCount, 0);
  });

  it("claim views are JSON-serializable and deterministic", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { status: "claimed" });

    const { views } = await listClaimViews(repo, ctx("owner", workspaceId));
    assert.equal(JSON.parse(JSON.stringify(views)).length, 2);
    assert.deepEqual(
      views.map((view) => view.effectiveStatus).sort(),
      ["claimed", "pending"],
    );
  });

  it("claim-source payouts are labeled as claim payments", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "approved", sourceType: "claim_link" });

    const views = await listPayoutViews(repo, ctx("owner", workspaceId));
    assert.equal(views.length, 1);
    assert.equal(views[0].sourceLabel, "Claim link");
  });
});
