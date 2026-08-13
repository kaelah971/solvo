import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPayoutDetailView,
  isBatchSource,
  listPayoutViews,
  payoutStateLabel,
} from "../../src/server/dashboard/payouts.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import {
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OWNER,
  TX_HASH,
  BASE_SCAN,
} from "./fixtures.ts";

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

describe("payout read model", () => {
  it("lists payouts scoped to the workspace only, newest first", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const first = await addPayout(repo, workspaceId, { totalBaseUnits: "10000" });
    const second = await addPayout(repo, workspaceId, { totalBaseUnits: "20000" });
    await addPayout(repo, otherWorkspaceId, { totalBaseUnits: "99999" });

    const views = await listPayoutViews(repo, ctx("owner", workspaceId));
    assert.equal(views.length, 2);
    assert.ok(!views.some((view) => view.totalUsdc === "0.99999"));
    const ids = new Set(views.map((view) => view.payoutId));
    assert.ok(ids.has(first.payoutId) && ids.has(second.payoutId));
    // Deterministic sort: (created_at, id) descending between consecutive rows.
    for (let i = 1; i < views.length; i += 1) {
      assert.ok(
        compareKeys(views[i - 1].createdAt, views[i - 1].payoutId, views[i].createdAt, views[i].payoutId) >= 0,
      );
    }
  });

  it("filters by state and source type", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addPayout(repo, workspaceId, { status: "completed" });

    const pending = await listPayoutViews(repo, ctx("owner", workspaceId), { status: "pending_approval" });
    assert.equal(pending.length, 1);
    assert.equal(pending[0].state, "pending_approval");

    const batches = await listPayoutViews(repo, ctx("owner", workspaceId), { sourceType: "telegram_batch" });
    assert.equal(batches.length, 0);
  });

  it("includes per-item counts and requester labels", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);
    await repo.createPayoutItem({
      payoutId,
      recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      amountBaseUnits: "10000",
      memo: "endurance",
      status: "pending_approval",
      idempotencyKey: "second-item",
    });

    const views = await listPayoutViews(repo, ctx("owner", workspaceId));
    assert.equal(views[0].itemCount, 2);
    assert.notEqual(views[0].requesterLabel, null);
    assert.equal(views[0].sourceLabel, "Direct");
  });

  it("batch payouts are distinguishable from single payouts", async () => {
    const { repo, workspaceId } = await makeFixture();
    const single = await addPayout(repo, workspaceId, { sourceType: "direct" });
    const batch = await addPayout(repo, workspaceId, { sourceType: "telegram_batch" });
    const commandBatch = await addPayout(repo, workspaceId, { sourceType: "batch_csv" });

    const views = await listPayoutViews(repo, ctx("owner", workspaceId));
    assert.equal(views.find((view) => view.payoutId === single.payoutId)?.isBatch, false);
    assert.equal(views.find((view) => view.payoutId === batch.payoutId)?.isBatch, true);
    assert.equal(views.find((view) => view.payoutId === commandBatch.payoutId)?.isBatch, true);
    assert.ok(isBatchSource("telegram_batch"));
    assert.ok(!isBatchSource("direct"));
  });

  it("detail includes item states, amounts, and timestamps", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId, itemId } = await addPayout(repo, workspaceId, { totalBaseUnits: "50000" });

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.equal(detail.totalUsdc, "0.05");
    assert.equal(detail.items.length, 1);
    assert.equal(detail.items[0].state, "pending_approval");
    assert.equal(detail.items[0].amountUsdc, "0.05");
    assert.ok(detail.createdAt);
    assert.equal(detail.itemCount, 1);
    assert.notEqual(itemId, null);
  });

  it("completed item shows tx proof only when the item has a tx hash", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "completed" });
    await repo.completePayoutItem(
      (await repo.getPayoutItemsByPayoutId(payoutId))[0].id,
      TX_HASH,
      BASE_SCAN,
    );

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.equal(detail.items[0].state, "completed");
    assert.equal(detail.items[0].txHash, TX_HASH);
    assert.equal(detail.items[0].txExplorerUrl, BASE_SCAN);
    assert.equal(detail.items[0].txHash!.startsWith("0x"), true);
  });

  it("completed item without a tx hash does not invent proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "completed" });

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.equal(detail.items[0].state, "completed");
    assert.equal(detail.items[0].txHash, null);
    assert.equal(detail.items[0].txExplorerUrl, null);
  });

  it("approved payout never shows a hash; no execution ids anywhere", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "approved" });
    await repo.setPayoutItemKeeperHubExecution((await repo.getPayoutItemsByPayoutId(payoutId))[0].id, "kh-exec-1");

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.equal(detail.items[0].txHash, null);
    const serialized = JSON.stringify(detail);
    assert.ok(!serialized.includes("kh-exec-1"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
  });

  it("detail returns null for unknown and cross-workspace payout ids", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, otherWorkspaceId);

    assert.equal(await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId), null);
    assert.equal(await getPayoutDetailView(repo, ctx("owner", workspaceId), "does-not-exist"), null);
    assert.equal(workspaceId.length > 0, true);
  });

  it("members see masked destinations; owners/approvers see full addresses", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);

    const memberDetail = await getPayoutDetailView(repo, ctx("member", workspaceId), payoutId);
    assert.ok(memberDetail);
    assert.equal(memberDetail.items[0].recipient, "0x76d7…7486");

    const ownerDetail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(ownerDetail);
    assert.equal(ownerDetail.items[0].recipient, "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486");
  });

  it("claim-linked payouts hide the item memo (token prefix lives there)", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { sourceType: "claim_link" });
    const itemId = (await repo.getPayoutItemsByPayoutId(payoutId))[0].id;
    await repo.createClaimLink({
      workspaceId,
      requesterId: MEMBER,
      amountBaseUnits: "50000",
      currencySymbol: "USDC",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      tokenHash: "hash",
      tokenPrefix: "a1b2c3d4",
      expiresAt: "2099-01-01T00:00:00.000Z",
      idempotencyKey: "claim-memo-item",
    });
    // Simulate the claim pipeline's memo: `claim <prefix>`.
    await repo.createPayoutItem({
      payoutId,
      recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      amountBaseUnits: "50000",
      memo: "claim a1b2c3d4",
      status: "approved",
      idempotencyKey: `claim-memo:${itemId}`,
    });

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    for (const item of detail.items) {
      assert.equal(item.memo, null, "claim item memos must not re-show the token prefix");
    }
    assert.ok(detail.linkedClaim === null || detail.linkedClaim.claimId.length > 0);
  });

  it("approver/decision comes from approval audit events, never invented", async () => {
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

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.equal(detail.decision?.role, "approver");
    assert.equal(detail.decision?.maskedId, "4445…666");
  });

  it("audit timeline is included in the detail view", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "pending_approval" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: null,
      eventType: "approval_required",
      actorType: "system",
      actorId: null,
      metadata: {},
    });

    const detail = await getPayoutDetailView(repo, ctx("owner", workspaceId), payoutId);
    assert.ok(detail);
    assert.ok(detail.auditTimeline.some((event) => event.eventType === "approval_required"));
  });

  it("payout views are JSON-serializable with deterministic ordering", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { totalBaseUnits: "10000" });
    await addPayout(repo, workspaceId, { totalBaseUnits: "20000" });

    const views = await listPayoutViews(repo, ctx("owner", workspaceId));
    assert.equal(JSON.parse(JSON.stringify(views)).length, 2);
    const totals = views.map((view) => view.totalUsdc).sort();
    assert.deepEqual(totals, ["0.01", "0.02"]);
    for (let i = 1; i < views.length; i += 1) {
      assert.ok(
        compareKeys(views[i - 1].createdAt, views[i - 1].payoutId, views[i].createdAt, views[i].payoutId) >= 0,
      );
    }
    assert.equal(payoutStateLabel("pending_approval"), "Awaiting approval");
    assert.equal(payoutStateLabel("completed"), "Completed");
    assert.equal(payoutStateLabel("execution_unknown"), "Unknown");
  });
});

/** (created_at, id) descending comparison — the repository's sort contract. */
function compareKeys(aCreated: string, aId: string, bCreated: string, bId: string): number {
  const aKey = `${aCreated}\u0000${aId}`;
  const bKey = `${bCreated}\u0000${bId}`;
  return aKey.localeCompare(bKey);
}
