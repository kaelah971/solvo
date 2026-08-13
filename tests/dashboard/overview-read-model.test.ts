import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildWorkspaceOverview, utcDayStartIso } from "../../src/server/dashboard/overview.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import {
  addAgentRun,
  addClaim,
  addCompletedPayout,
  addPayout,
  makeFixture,
  DAY_START,
  MEMBER,
  NOW,
  OWNER,
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

describe("workspace overview read model", () => {
  it("counts pending approvals from payout items only", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addPayout(repo, workspaceId, { status: "pending_approval", totalBaseUnits: "30000" });
    await addCompletedPayout(repo, workspaceId, { withHash: true });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.pendingApprovals, 2);
    assert.equal(overview.completedToday, 1);
  });

  it("counts pending/claimed claims using effective status (expiry computed)", async () => {
    const { repo, workspaceId } = await makeFixture();
    // Pending (created, not expired).
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    // Claimed.
    await addClaim(repo, workspaceId, { status: "claimed" });
    // Expired (created past deadline — effective expired, NOT pending).
    await addClaim(repo, workspaceId, { expiresAt: "2020-01-01T00:00:00.000Z" });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.pendingClaimLinks, 1);
    assert.equal(overview.claimedWaitingApproval, 1);
    assert.equal(overview.claimCountCapped, false);
  });

  it("prepared totals count only items prepared today still pending approval", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval", totalBaseUnits: "50000" });
    await addCompletedPayout(repo, workspaceId, { withHash: true });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.preparedTodayUsdc, "0.05");
    assert.equal(overview.completedTodayUsdc, "0.05");
    // Prepared excludes completed items.
    assert.equal(overview.pendingApprovals, 1);
  });

  it("prepared totals do not assume completed proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    // Completed item WITHOUT a transaction hash — still completed (pipeline
    // state), but carries no proof. Never counted as failed or unknown.
    await addCompletedPayout(repo, workspaceId, { withHash: false });
    // Approved but not executed — not completed.
    await addPayout(repo, workspaceId, { status: "approved" });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.completedToday, 1);
    assert.equal(overview.failedOrUnknown, 0);
  });

  it("failed/unknown counts come from payout states", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "execution_failed" });
    await addPayout(repo, workspaceId, { status: "execution_unknown" });
    await addPayout(repo, workspaceId, { status: "validation_failed" });
    await addPayout(repo, workspaceId, { status: "completed" });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.failedOrUnknown, 3);
  });

  it("read models never use agent_runs as payment truth", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId, { status: "prepared", withJson: true });
    // No payouts at all.
    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.pendingApprovals, 0);
    assert.equal(overview.completedToday, 0);
    assert.equal(overview.preparedTodayUsdc, "0");
    assert.equal(overview.completedTodayUsdc, "0");
    assert.equal(overview.recentAgentRuns.length, 1);
  });

  it("includes active members, recipients, and redacted recent events", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({
      workspaceId,
      alias: "blossom",
      walletAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      createdBy: MEMBER,
    });
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addAgentRun(repo, workspaceId, { rawText: "pay blossom 0.01 USDC [REDACTED]" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "request_created",
      actorType: "member",
      actorId: MEMBER,
      metadata: { amountBaseUnits: "50000" },
    });

    const overview = await buildWorkspaceOverview(repo, ctx("member", workspaceId));
    assert.equal(overview.activeMembers, 3);
    assert.equal(overview.recipientCount, 1);
    assert.equal(overview.recentAuditEvents.length, 1); // request_created
    assert.equal(overview.recentAuditEvents[0].eventType, "request_created");
    assert.equal(overview.recentAuditEvents[0].summary?.amountUsdc, "0.05");
    assert.equal(overview.recentAgentRuns.length, 1);
    assert.equal(overview.currentMember?.role, "member");
    assert.equal(overview.workspace?.name, "Test WS");
  });

  it("scopes all numbers to the operator workspace", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addPayout(repo, otherWorkspaceId, { status: "pending_approval" });
    await addPayout(repo, otherWorkspaceId, { status: "completed" });
    await addClaim(repo, otherWorkspaceId, { status: "claimed" });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    assert.equal(overview.pendingApprovals, 0);
    assert.equal(overview.completedToday, 0);
    assert.equal(overview.pendingClaimLinks, 0);
    assert.equal(overview.claimedWaitingApproval, 0);
  });

  it("views are JSON-serializable and contain no secret shapes", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    await addClaim(repo, workspaceId, { status: "claimed" });
    await addAgentRun(repo, workspaceId, { withJson: true });

    const overview = await buildWorkspaceOverview(repo, ctx("owner", workspaceId));
    const roundTrip = JSON.parse(JSON.stringify(overview));
    assert.equal(roundTrip.pendingApprovals, 1);
    assert.equal(roundTrip.pendingClaimLinks, 0);
    assert.equal(roundTrip.claimedWaitingApproval, 1);
    const serialized = JSON.stringify(overview);
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("sk-"));
    assert.ok(!serialized.includes("kh_"));
  });

  it("utcDayStartIso computes the UTC day boundary", () => {
    assert.equal(utcDayStartIso("2026-08-13T23:59:59.999Z"), DAY_START);
    assert.equal(utcDayStartIso(DAY_START), DAY_START);
  });
});
