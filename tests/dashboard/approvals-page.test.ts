import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  approvalCapability,
  buildApprovalsPageModel,
  selfRequesterNote,
} from "../../src/server/dashboard/approvals-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import {
  addClaim,
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OWNER,
  TX_HASH,
  BASE_SCAN,
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

async function addPendingBatch(repo: Awaited<ReturnType<typeof makeFixture>>["repo"], workspaceId: string) {
  const { payoutId } = await addPayout(repo, workspaceId, {
    status: "pending_approval",
    sourceType: "telegram_batch",
    totalBaseUnits: "30000",
  });
  await repo.createPayoutItem({
    payoutId,
    recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
    amountBaseUnits: "10000",
    memo: "endurance",
    status: "pending_approval",
    idempotencyKey: `batch-approval-leg-${payoutId}`,
  });
  return payoutId;
}

describe("approvals page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    assert.deepEqual(await buildApprovalsPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildApprovalsPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildApprovalsPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.payouts.length, 1, role);
        assert.equal(model.empty, false, role);
      }
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addPayout(repo, otherWorkspaceId, { status: "pending_approval" });
    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.payouts.length, 0);
    assert.equal(model.batches.length, 0);
    assert.equal(model.claims.length, 0);
    assert.equal(model.empty, true);
  });

  it("queues pending single payouts and pending batch payouts separately", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addPendingBatch(repo, workspaceId);

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.payouts.length, 1);
    assert.equal(model.payouts[0].isBatch, false);
    assert.equal(model.payouts[0].sourceLabel, "Direct");
    assert.equal(model.payouts[0].itemCount, 1);
    assert.equal(model.payouts[0].totalUsdc, "0.05");

    assert.equal(model.batches.length, 1);
    assert.equal(model.batches[0].isBatch, true);
    assert.equal(model.batches[0].sourceLabel, "Batch payout");
    assert.equal(model.batches[0].itemCount, 2);
    assert.equal(model.batches[0].totalUsdc, "0.03");
    assert.equal(model.batches[0].pendingCount, 2);
    assert.equal(model.batches[0].completedCount, 0);
    assert.equal(model.batches[0].failedCount, 0);
  });

  it("never queues completed or rejected/cancelled payouts", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "completed" });
    await addPayout(repo, workspaceId, { status: "cancelled" });
    await addPayout(repo, workspaceId, { status: "execution_failed" });

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.payouts.length, 0);
    assert.equal(model.batches.length, 0);
    assert.equal(model.empty, true);
  });

  it("queues claimed claims only — pending/expired/approved/not-confirmed never appear", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" }); // pending
    await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" }); // expired
    await addClaim(repo, workspaceId, { status: "claimed" }); // claimed → queued
    const approved = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(approved.claimId, ["claimed"], "approved");
    const executed = await addClaim(repo, workspaceId, { status: "claimed" });
    await repo.transitionClaimStatus(executed.claimId, ["claimed"], "approved");
    await repo.transitionClaimStatus(executed.claimId, ["approved"], "executed");

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.claims.length, 1, "only the claimed claim may be queued");
    assert.equal(model.claims[0].amountUsdc, "0.05");
    assert.equal(model.claims[0].currency, "USDC");
    assert.equal(model.claims[0].network, "BASE");
    assert.equal(model.claims[0].maskedWallet, "0x76d7…7486");
  });

  it("queues completed claims never — pipeline proof does not put them back in the queue", async () => {
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
    const { item } = await repo.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      amountBaseUnits: "50000",
      memo: "claim",
      status: "approved",
      idempotencyKey: "approvals-completed-claim-item",
    });
    await repo.setClaimPayoutId(claimId, payout.id);
    await repo.completePayoutItem(item.id, TX_HASH, BASE_SCAN);
    for (const [from, to] of [
      ["approved", "simulating"],
      ["simulating", "submitted"],
      ["submitted", "confirming"],
      ["confirming", "completed"],
    ] as const) {
      await repo.transitionPayoutState(payout.id, [from], to);
    }

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.claims.length, 0);
    assert.equal(model.empty, true);
  });

  it("flags requester-is-self for payouts and claims", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval", requesterId: OWNER });
    await addClaim(repo, workspaceId, { status: "claimed", requesterId: OWNER });

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.payouts[0].requesterIsSelf, true);
    assert.equal(model.claims[0].requesterIsSelf, true);

    const other = await buildApprovalsPageModel(repo, ctx("approver", workspaceId));
    assert.equal(other.ok, true);
    if (other.ok) {
      assert.equal(other.payouts[0].requesterIsSelf, false);
      assert.equal(other.claims[0].requesterIsSelf, false);
    }
  });

  it("reports the role capability copy per role", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });

    const owner = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(owner.ok, true);
    if (owner.ok) {
      assert.equal(owner.capability.canActLater, true);
      assert.match(owner.capability.copy, /You may approve eligible requests later\./);
    }
    const approver = await buildApprovalsPageModel(repo, ctx("approver", workspaceId));
    assert.equal(approver.ok, true);
    if (approver.ok) {
      assert.equal(approver.capability.canActLater, true);
      assert.match(approver.capability.copy, /You may approve eligible requests later\./);
    }
    const member = await buildApprovalsPageModel(repo, ctx("member", workspaceId));
    assert.equal(member.ok, true);
    if (member.ok) {
      assert.equal(member.capability.canActLater, false);
      assert.match(member.capability.copy, /Members can view this queue but cannot approve\./);
    }
  });

  it("never exposes raw token/hash/prefix or provider JSON in serialized output", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { tokenHash, tokenPrefix } = await addClaim(repo, workspaceId, { status: "claimed" });
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addPendingBatch(repo, workspaceId);

    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes(tokenHash));
    assert.ok(!serialized.includes(tokenPrefix));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("token_prefix"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.equal(JSON.parse(JSON.stringify(model)).claims.length, 1);
  });

  it("masked wallets never leak full addresses", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, {
      status: "claimed",
      claimedRecipient: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    });
    const model = await buildApprovalsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.claims[0].maskedWallet, "0x76d7…7486");
    assert.ok(!JSON.stringify(model).includes("0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486"));
  });

  it("capability and SoD helpers are pure and safe", () => {
    assert.equal(approvalCapability("owner").canActLater, true);
    assert.equal(approvalCapability("approver").canActLater, true);
    assert.equal(approvalCapability("member").canActLater, false);
    assert.equal(approvalCapability(null).canActLater, false);
    assert.match(selfRequesterNote("payout"), /cannot approve it\./);
    assert.match(selfRequesterNote("claim"), /cannot approve the claimed destination\./);
  });
});
