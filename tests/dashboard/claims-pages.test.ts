import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildClaimDetailPageModel,
  buildClaimListPageModel,
  claimProofLabel,
  claimStatusLabel,
  reissueEligibilityDisplay,
  shortClaimId,
} from "../../src/server/dashboard/claims-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import type { Fixture } from "./fixtures.ts";
import {
  addClaim,
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OWNER,
  TX_HASH,
  BASE_SCAN,
  TOKEN_ADDRESS,
} from "./fixtures.ts";

function ctx(role: "owner" | "approver" | "member" | null, workspaceId: string, status: "active" | "removed" | null = "active"): DashboardContext {
  return makeDashboardContext({
    workspaceId,
    telegramUserId: role === "owner" ? OWNER : role === "approver" ? "444555666" : role === "member" ? MEMBER : "999888777",
    role,
    status,
    mode: role === null ? null : "community",
    nowIso: NOW,
  });
}

/** Approve a claimed claim: status → approved + a claim_link payout + item. */
async function seedApprovedPipeline(repo: Fixture["repo"], workspaceId: string, claimId: string) {
  await repo.transitionClaimStatus(claimId, ["claimed"], "approved");
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: MEMBER,
    sourceType: "claim_link",
    status: "approved",
    totalAmountBaseUnits: "50000",
    currencySymbol: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    amountBaseUnits: "50000",
    memo: "claim",
    status: "approved",
    idempotencyKey: `claim-proof-${claimId}`,
  });
  await repo.setClaimPayoutId(claimId, payout.id);
  return { payoutId: payout.id, itemId: item.id };
}

/** Drive the linked payout pipeline to completed; mark the claim executed. */
async function completePipeline(repo: Fixture["repo"], payoutId: string, itemId: string, claimId: string, withHash: boolean) {
  await repo.completePayoutItem(itemId, withHash ? TX_HASH : "", withHash ? BASE_SCAN : "");
  for (const [from, to] of [
    ["approved", "simulating"],
    ["simulating", "submitted"],
    ["submitted", "confirming"],
    ["confirming", "completed"],
  ] as const) {
    await repo.transitionPayoutState(payoutId, [from], to);
  }
  await repo.transitionClaimStatus(claimId, ["approved"], "executed");
}

describe("claim list page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId);
    const nonMember = await buildClaimListPageModel(repo, ctx(null, workspaceId));
    const removed = await buildClaimListPageModel(repo, ctx("owner", workspaceId, "removed"));
    assert.deepEqual(nonMember, { ok: false });
    assert.deepEqual(removed, { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId);
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildClaimListPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.items.length, 1);
        assert.equal(model.empty, false);
      }
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addClaim(repo, otherWorkspaceId);
    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("groups pending/unclaimed and computed-expired claims correctly", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { status: "cancelled" });

    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const byStatus = new Map(model.items.map((item) => [item.effectiveStatus, item]));
    assert.equal(byStatus.get("pending")?.statusLabel, "Pending / Unclaimed");
    assert.equal(byStatus.get("expired")?.statusLabel, "Expired", "expiry is computed, never stored");
    assert.equal(byStatus.get("rejected")?.statusLabel, "Rejected / Cancelled");
  });

  it("shows claimed-waiting-approval and approved/payment-prepared without saying paid", async () => {
    const { repo, workspaceId } = await makeFixture();
    const claimed = await addClaim(repo, workspaceId, { status: "claimed" });
    const approved = await addClaim(repo, workspaceId, { status: "claimed" });
    await seedApprovedPipeline(repo, workspaceId, approved.claimId);

    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const byStatus = new Map(model.items.map((item) => [item.effectiveStatus, item]));
    assert.equal(byStatus.get("claimed")?.statusLabel, "Claimed, waiting approval");
    assert.equal(byStatus.get("claimed")?.proofLabel, "Waiting for approval");
    assert.equal(byStatus.get("approved")?.statusLabel, "Approved / Payment prepared");
    assert.equal(byStatus.get("approved")?.proofLabel, "Payment prepared");
    void claimed;
  });

  it("shows completed only when the pipeline recorded a hash; never fake proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    const withProof = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId, itemId } = await seedApprovedPipeline(repo, workspaceId, withProof.claimId);
    await completePipeline(repo, payoutId, itemId, withProof.claimId, true);

    const executedNoProof = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId: p2, itemId: i2 } = await seedApprovedPipeline(repo, workspaceId, executedNoProof.claimId);
    await completePipeline(repo, p2, i2, executedNoProof.claimId, false);

    const executedNoPipeline = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(executedNoPipeline.claimId, ["claimed"], "approved");
    await repo.transitionClaimStatus(executedNoPipeline.claimId, ["approved"], "executed");

    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const byClaim = new Map(model.items.map((item) => [item.view.claimId, item]));
    const completed = byClaim.get(withProof.claimId);
    assert.equal(completed?.effectiveStatus, "completed");
    assert.equal(completed?.proofLabel, "Completed with proof");

    const noProof = byClaim.get(executedNoProof.claimId);
    assert.equal(noProof?.effectiveStatus, "unknown", "completed without a hash must stay not-confirmed");
    assert.equal(noProof?.proofLabel, "Not confirmed");

    const noPipeline = byClaim.get(executedNoPipeline.claimId);
    assert.equal(noPipeline?.effectiveStatus, "unknown");
    assert.equal(noPipeline?.proofLabel, "Not confirmed");
    assert.equal(model.items.some((item) => item.proofLabel.includes("proof") && item.effectiveStatus !== "completed"), false);
  });

  it("masks the claimed wallet", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, {
      status: "claimed",
      claimedRecipient: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    });
    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items[0].view.maskedWallet, "0x76d7…7486");
  });

  it("shows the linked payout state when present", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId } = await seedApprovedPipeline(repo, workspaceId, claimId);

    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items[0].view.payoutId, payoutId);
    assert.equal(model.items[0].payoutState, "approved");
  });

  it("never exposes raw token, token hash, or token prefix", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { tokenHash, tokenPrefix } = await addClaim(repo, workspaceId, { status: "claimed" });
    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes(tokenHash));
    assert.ok(!serialized.includes(tokenPrefix));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("token_prefix"));
  });

  it("page items are JSON-serializable with no internal shapes", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { status: "claimed" });
    const model = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(model));
    assert.equal(roundTrip.items.length, 1);
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
  });

  it("reissue eligibility display shows for owner/approver and denies member", async () => {
    const { repo, workspaceId } = await makeFixture();
    const expired = await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });
    const claimed = await addClaim(repo, workspaceId, { status: "claimed" });

    for (const role of ["owner", "approver"] as const) {
      const model = await buildClaimListPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true);
      if (!model.ok) continue;
      const byClaim = new Map(model.items.map((item) => [item.view.claimId, item]));
      const expiredItem = byClaim.get(expired.claimId);
      assert.equal(expiredItem?.reissue.eligible, true, role);
      assert.equal(expiredItem?.reissue.label, "Eligible to reissue", role);
      const claimedItem = byClaim.get(claimed.claimId);
      assert.equal(claimedItem?.reissue.eligible, false, role);
      assert.match(claimedItem?.reissue.reason ?? "", /already claimed or approved/);
    }

    const member = await buildClaimListPageModel(repo, ctx("member", workspaceId));
    assert.equal(member.ok, true);
    if (member.ok) {
      const expiredItem = member.items.find((item) => item.view.claimId === expired.claimId);
      assert.equal(expiredItem?.reissue.eligible, false);
      assert.equal(expiredItem?.reissue.label, "Not eligible to reissue");
      assert.match(expiredItem?.reissue.reason ?? "", /owner or approver/);
    }
  });

  it("display helpers map every effective status truthfully", () => {
    assert.equal(claimStatusLabel("pending"), "Pending / Unclaimed");
    assert.equal(claimStatusLabel("claimed"), "Claimed, waiting approval");
    assert.equal(claimStatusLabel("expired"), "Expired");
    assert.equal(claimStatusLabel("rejected"), "Rejected / Cancelled");
    assert.equal(claimStatusLabel("approved"), "Approved / Payment prepared");
    assert.equal(claimStatusLabel("completed"), "Completed");
    assert.equal(claimStatusLabel("unknown"), "Not confirmed");
    assert.equal(claimProofLabel("completed", true), "Completed with proof");
    assert.equal(claimProofLabel("completed", false), "Completed without visible proof");
    assert.equal(claimProofLabel("approved", false), "Payment prepared");
    assert.equal(claimProofLabel("claimed", false), "Waiting for approval");
    assert.equal(claimProofLabel("pending", false), "Awaiting wallet");
    assert.equal(claimProofLabel("expired", false), "Expired");
    assert.equal(claimProofLabel("rejected", false), "Rejected");
    assert.equal(claimProofLabel("unknown", false), "Not confirmed");
  });

  it("reissue display is pure: role + stored state only", () => {
    assert.equal(reissueEligibilityDisplay(ctx("owner", "ws"), "created").eligible, true);
    assert.equal(reissueEligibilityDisplay(ctx("owner", "ws"), "cancelled").eligible, true);
    assert.equal(reissueEligibilityDisplay(ctx("approver", "ws"), "created").eligible, true);
    assert.equal(reissueEligibilityDisplay(ctx("member", "ws"), "created").eligible, false);
    assert.equal(reissueEligibilityDisplay(ctx("owner", "ws"), "claimed").eligible, false);
    assert.equal(shortClaimId("12345678-abcd-efgh"), "12345678");
  });
});

describe("claim detail page model", () => {
  it("renders current-workspace claims and rejects cross-workspace/unknown ids", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId);
    const foreign = await addClaim(repo, otherWorkspaceId);

    const ok = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.detail.claimId, claimId);

    assert.deepEqual(await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), foreign.claimId), { ok: false });
    assert.deepEqual(await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist"), { ok: false });
  });

  it("shows amount/currency/network/expiry and masked wallet", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, {
      status: "claimed",
      claimedRecipient: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    });
    const model = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.detail.amountUsdc, "0.05");
    assert.equal(model.detail.currency, "USDC");
    assert.equal(model.detail.network, "BASE");
    assert.equal(model.detail.expiresAt, "2026-08-20T00:00:00.000Z");
    assert.equal(model.detail.maskedWallet, "0x76d7…7486");
  });

  it("shows linked payout state and pipeline-only proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId, itemId } = await seedApprovedPipeline(repo, workspaceId, claimId);

    const approved = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(approved.ok, true);
    if (approved.ok) {
      assert.equal(approved.detail.payoutId, payoutId);
      assert.equal(approved.detail.statusView.payoutState, "approved");
      assert.equal(approved.detail.statusView.txHash, null, "approved never shows proof");
      assert.equal(approved.detail.statusView.txExplorerUrl, null);
    }

    await completePipeline(repo, payoutId, itemId, claimId, true);
    const completed = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(completed.ok, true);
    if (completed.ok) {
      assert.equal(completed.detail.effectiveStatus, "completed");
      assert.equal(completed.detail.statusView.txHash, TX_HASH);
      assert.equal(completed.detail.statusView.txExplorerUrl, BASE_SCAN);
      assert.equal(completed.statusLabel, "Completed");
      assert.equal(completed.proofLabel, "Completed with proof");
    }
  });

  it("never shows proof for completed-without-hash or not-confirmed claims", async () => {
    const { repo, workspaceId } = await makeFixture();
    const noHash = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId, itemId } = await seedApprovedPipeline(repo, workspaceId, noHash.claimId);
    await completePipeline(repo, payoutId, itemId, noHash.claimId, false);

    const notConfirmed = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(notConfirmed.claimId, ["claimed"], "approved");
    await repo.transitionClaimStatus(notConfirmed.claimId, ["approved"], "executed");

    for (const claimId of [noHash.claimId, notConfirmed.claimId]) {
      const model = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
      assert.equal(model.ok, true);
      if (!model.ok) continue;
      assert.equal(model.detail.statusView.txHash, null, claimId);
      assert.equal(model.detail.statusView.txExplorerUrl, null, claimId);
      assert.equal(model.detail.effectiveStatus, "unknown", claimId);
      assert.equal(model.statusLabel, "Not confirmed");
      assert.equal(model.proofLabel, "Not confirmed");
    }
  });

  it("includes a safe audit timeline", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId);
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_created",
      actorType: "member",
      actorId: MEMBER,
      metadata: { claimId },
    });
    const model = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.detail.auditTimeline.length, 1);
    assert.equal(model.detail.auditTimeline[0].eventType, "claim_created");
  });

  it("detail JSON never contains token material, execution ids, or raw blobs", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId, tokenHash, tokenPrefix } = await addClaim(repo, workspaceId);
    const model = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes(tokenHash));
    assert.ok(!serialized.includes(tokenPrefix));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("token_prefix"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("simulation_result"));
  });

  it("detail reissue eligibility display reflects role and state", async () => {
    const { repo, workspaceId } = await makeFixture();
    const expired = await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });
    const claimed = await addClaim(repo, workspaceId, { status: "claimed" });

    for (const role of ["owner", "approver"] as const) {
      const eligible = await buildClaimDetailPageModel(repo, ctx(role, workspaceId), expired.claimId);
      assert.equal(eligible.ok, true);
      if (eligible.ok) {
        assert.equal(eligible.reissue.eligible, true, role);
        assert.equal(eligible.reissue.label, "Eligible to reissue", role);
      }
      const ineligible = await buildClaimDetailPageModel(repo, ctx(role, workspaceId), claimed.claimId);
      assert.equal(ineligible.ok, true);
      if (ineligible.ok) {
        assert.equal(ineligible.reissue.eligible, false, role);
        assert.equal(ineligible.reissue.label, "Not eligible to reissue", role);
      }
    }

    const member = await buildClaimDetailPageModel(repo, ctx("member", workspaceId), expired.claimId);
    assert.equal(member.ok, true);
    if (member.ok) {
      assert.equal(member.reissue.eligible, false);
      assert.equal(member.reissue.label, "Not eligible to reissue");
      assert.match(member.reissue.reason ?? "", /owner or approver/);
    }
  });

  it("claim-source payouts unrelated to the claim never appear", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { claimId } = await addClaim(repo, workspaceId, { status: "claimed" });
    await addPayout(repo, workspaceId, { status: "approved", sourceType: "claim_link" });
    const model = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimId);
    assert.equal(model.ok, true);
    if (model.ok) {
      assert.equal(model.detail.payoutId, null, "unlinked payout must not be attributed");
      assert.equal(model.detail.statusView.payoutState, null);
    }
  });
});
