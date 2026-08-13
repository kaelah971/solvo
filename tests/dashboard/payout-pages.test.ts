import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBatchDetailPageModel,
  buildBatchListPageModel,
  buildPayoutDetailPageModel,
  buildPayoutListPageModel,
  payoutListSourceLabel,
  payoutProofStatus,
  shortPayoutId,
} from "../../src/server/dashboard/payouts-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import type { Fixture } from "./fixtures.ts";
import {
  addAgentRun,
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

async function seedCompletedPayout(repo: Fixture["repo"], workspaceId: string, withHash: boolean) {
  const { payoutId, itemId } = await addPayout(repo, workspaceId, { status: "completed" });
  await repo.completePayoutItem(itemId, withHash ? TX_HASH : "", withHash ? BASE_SCAN : "");
  return payoutId;
}

describe("payout list page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId);
    const nonMember = await buildPayoutListPageModel(repo, ctx(null, workspaceId));
    const removed = await buildPayoutListPageModel(repo, ctx("owner", workspaceId, "removed"));
    assert.deepEqual(nonMember, { ok: false });
    assert.deepEqual(removed, { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId);
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildPayoutListPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.items.length, 1);
        assert.equal(model.empty, false);
      }
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addPayout(repo, otherWorkspaceId);
    const model = await buildPayoutListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("labels prepared/pending separately from completed, without fake proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await seedCompletedPayout(repo, workspaceId, true);
    await seedCompletedPayout(repo, workspaceId, false);

    const model = await buildPayoutListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;

    const byStatus = new Map(model.items.map((item) => [item.proofStatus.kind, item]));
    assert.equal(byStatus.get("pending_approval")?.proofStatus.label, "Pending approval");
    assert.equal(byStatus.get("completed_with_proof")?.proofStatus.label, "Completed with proof");
    assert.equal(byStatus.get("completed_without_proof")?.proofStatus.label, "Completed without visible proof");
  });

  it("failed/unknown, cancelled, in-flight, and partial chips are truthful", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "execution_failed" });
    await addPayout(repo, workspaceId, { status: "cancelled" });
    await addPayout(repo, workspaceId, { status: "approved" });
    // Batch with one completed + one pending leg.
    const { payoutId, itemId } = await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "telegram_batch" });
    await repo.createPayoutItem({
      payoutId,
      recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      amountBaseUnits: "10000",
      memo: "endurance",
      status: "completed",
      idempotencyKey: "partial-leg",
    });
    void itemId;

    const model = await buildPayoutListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const byStatus = new Map(model.items.map((item) => [item.proofStatus.kind, item]));
    assert.equal(byStatus.get("failed_or_unknown")?.proofStatus.label, "Failed or unknown");
    assert.equal(byStatus.get("cancelled")?.proofStatus.label, "Cancelled");
    assert.equal(byStatus.get("in_flight")?.proofStatus.label, "Executing");
    assert.equal(byStatus.get("partial")?.proofStatus.label, "Partially completed");
  });

  it("source labels are safe and mapped per source type", () => {
    assert.equal(payoutListSourceLabel("telegram_command"), "Telegram payment");
    assert.equal(payoutListSourceLabel("telegram_natural_language"), "Natural-language payment");
    assert.equal(payoutListSourceLabel("telegram_batch"), "Batch payout");
    assert.equal(payoutListSourceLabel("batch_csv"), "Batch payout");
    assert.equal(payoutListSourceLabel("claim_link"), "Claim link");
    assert.equal(payoutListSourceLabel("judge_telegram"), "Judge mode");
    assert.equal(payoutListSourceLabel("m1_proof"), "Proof import");
    assert.equal(payoutListSourceLabel("direct"), "Direct");
  });

  it("decision summaries come from approval audit events only", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "approved" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: null,
      eventType: "approval_granted",
      actorType: "approver",
      actorId: "444555666",
      metadata: {},
    });
    const model = await buildPayoutListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items[0].decisionLabel, "Approved by 4445…666");
  });

  it("page items are JSON-serializable with no internal shapes", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addAgentRun(repo, workspaceId, { withJson: true });
    const model = await buildPayoutListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(model));
    assert.equal(roundTrip.items.length, 1);
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
  });

  it("shortPayoutId is a safe 8-char display id", () => {
    assert.equal(shortPayoutId("12345678-abcd-efgh"), "12345678");
  });
});

describe("payout detail page model", () => {
  it("renders current-workspace payouts and rejects unknown/cross-workspace ids", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);
    const foreign = await addPayout(repo, otherWorkspaceId);

    const ok = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), payoutId);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.detail.payoutId, payoutId);

    assert.deepEqual(await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), foreign.payoutId), { ok: false });
    assert.deepEqual(await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist"), { ok: false });
  });

  it("shows item states and amounts, proof only when a completed item has a hash", async () => {
    const { repo, workspaceId } = await makeFixture();
    const withHash = await seedCompletedPayout(repo, workspaceId, true);
    const withoutHash = await seedCompletedPayout(repo, workspaceId, false);

    const hashed = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), withHash);
    assert.equal(hashed.ok, true);
    if (hashed.ok) {
      assert.equal(hashed.detail.items[0].txHash, TX_HASH);
      assert.equal(hashed.detail.items[0].txExplorerUrl, BASE_SCAN);
    }

    const plain = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), withoutHash);
    assert.equal(plain.ok, true);
    if (plain.ok) {
      assert.equal(plain.detail.items[0].state, "completed");
      assert.equal(plain.detail.items[0].txHash, null);
      assert.equal(plain.detail.items[0].txExplorerUrl, null);
    }
  });

  it("masks destinations for member role, full for owner", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);
    const member = await buildPayoutDetailPageModel(repo, ctx("member", workspaceId), payoutId);
    assert.equal(member.ok, true);
    if (member.ok) assert.equal(member.detail.items[0].recipient, "0x76d7…7486");

    const owner = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), payoutId);
    assert.equal(owner.ok, true);
    if (owner.ok) assert.equal(owner.detail.items[0].recipient, "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486");
  });

  it("includes a safe audit timeline", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "pending_approval" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: null,
      eventType: "approval_required",
      actorType: "system",
      actorId: null,
      metadata: { amountBaseUnits: "50000" },
    });
    const model = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), payoutId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.detail.auditTimeline.length, 1);
    assert.equal(model.detail.auditTimeline[0].eventType, "approval_required");
    assert.equal(model.detail.auditTimeline[0].summary?.amountUsdc, "0.05");
  });

  it("detail view JSON never contains execution ids or token material", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId, itemId } = await addPayout(repo, workspaceId, { status: "completed" });
    await repo.setPayoutItemKeeperHubExecution(itemId, "kh-exec-7");
    const model = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), payoutId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("kh-exec-7"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("token_hash"));
  });
});

describe("batch page models", () => {
  it("lists only batch payouts with per-state counts", async () => {
    const { repo, workspaceId } = await makeFixture();
    const single = await addPayout(repo, workspaceId, { status: "pending_approval" });
    const batch = await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "telegram_batch", totalBaseUnits: "30000" });
    await repo.createPayoutItem({
      payoutId: batch.payoutId,
      recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      amountBaseUnits: "10000",
      memo: "endurance",
      status: "pending_approval",
      idempotencyKey: "batch-leg-2",
    });
    void single;

    const model = await buildBatchListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 1);
    assert.equal(model.items[0].view.payoutId, batch.payoutId);
    assert.equal(model.items[0].view.itemCount, 2);
    assert.equal(model.items[0].pendingCount, 2);
    assert.equal(model.items[0].completedCount, 0);
    assert.equal(model.items[0].failedCount, 0);
  });

  it("shows the honest empty state", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "direct" });
    const model = await buildBatchListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("detail renders batches and rejects non-batch and unknown ids", async () => {
    const { repo, workspaceId } = await makeFixture();
    const batch = await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "telegram_batch", totalBaseUnits: "20000" });
    const single = await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "direct" });

    const ok = await buildBatchDetailPageModel(repo, ctx("owner", workspaceId), batch.payoutId);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.detail.itemCount, 1);

    assert.deepEqual(await buildBatchDetailPageModel(repo, ctx("owner", workspaceId), single.payoutId), { ok: false });
    assert.deepEqual(await buildBatchDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist"), { ok: false });
  });

  it("batch detail shows per-item proof only where present", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId, itemId } = await addPayout(repo, workspaceId, { status: "completed", sourceType: "telegram_batch" });
    await repo.completePayoutItem(itemId, TX_HASH, BASE_SCAN);
    await repo.createPayoutItem({
      payoutId,
      recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      amountBaseUnits: "10000",
      memo: "endurance",
      status: "completed",
      idempotencyKey: "batch-proof-leg",
    });

    const model = await buildBatchDetailPageModel(repo, ctx("owner", workspaceId), payoutId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const proofs = model.detail.items.map((item) => item.txHash);
    assert.equal(proofs.includes(TX_HASH), true);
    assert.equal(proofs.includes(null), true, "a completed leg without a hash must not invent proof");
  });

  it("gates batch models for denied contexts", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { sourceType: "telegram_batch" });
    assert.deepEqual(await buildBatchListPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildBatchDetailPageModel(repo, ctx("owner", workspaceId, "removed"), "x"), { ok: false });
  });

  it("payoutProofStatus never claims proof without a hash", () => {
    const base = {
      payoutId: "1",
      sourceType: "direct" as const,
      sourceLabel: "Direct",
      state: "completed",
      stateLabel: "Completed",
      isBatch: false,
      totalUsdc: "0.01",
      currency: "USDC",
      itemCount: 1,
      requesterLabel: null,
      createdAt: NOW,
      updatedAt: NOW,
      approvedAt: null,
      completedAt: NOW,
      cancelledAt: null,
      claimId: null,
    };
    const noProof = payoutProofStatus(base, [
      { itemId: "i", recipient: "x", memo: null, amountUsdc: "0.01", state: "completed", stateLabel: "Completed", createdAt: NOW, completedAt: NOW, txHash: null, txExplorerUrl: null },
    ]);
    assert.deepEqual(noProof, { kind: "completed_without_proof", label: "Completed without visible proof" });
    const withProof = payoutProofStatus(base, [
      { itemId: "i", recipient: "x", memo: null, amountUsdc: "0.01", state: "completed", stateLabel: "Completed", createdAt: NOW, completedAt: NOW, txHash: TX_HASH, txExplorerUrl: BASE_SCAN },
    ]);
    assert.deepEqual(withProof, { kind: "completed_with_proof", label: "Completed with proof" });
  });
});
