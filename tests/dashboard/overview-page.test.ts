import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOverviewPageModel, roleLabel, modeLabel, auditEventLabel } from "../../src/server/dashboard/overview-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import {
  addAgentRun,
  addClaim,
  addCompletedPayout,
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OWNER,
  APPROVER,
} from "./fixtures.ts";

function ctx(role: "owner" | "approver" | "member" | null, workspaceId: string, status: "active" | "removed" | null = "active"): DashboardContext {
  return makeDashboardContext({
    workspaceId,
    telegramUserId: role === "owner" ? OWNER : role === "approver" ? APPROVER : role === "member" ? MEMBER : OUTSIDER,
    role,
    status,
    mode: role === null ? null : "community",
    nowIso: NOW,
  });
}

const OUTSIDER = "999888777";

describe("overview page model", () => {
  it("active owner, approver, and member sessions all render the overview", async () => {
    const { repo, workspaceId } = await makeFixture();
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildOverviewPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.roleLabel, role.toUpperCase());
        assert.equal(model.modeLabel, "COMMUNITY");
        assert.equal(model.workspaceLabel, "Test WS");
      }
    }
  });

  it("non-member and inactive sessions return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    const nonMember = await buildOverviewPageModel(repo, ctx(null, workspaceId));
    assert.deepEqual(nonMember, { ok: false });

    const removed = await buildOverviewPageModel(repo, ctx("owner", workspaceId, "removed"));
    assert.deepEqual(removed, { ok: false });
  });

  it("unavailable is identical for every denied shape (no leak)", async () => {
    const { repo, workspaceId } = await makeFixture();
    const denied1 = await buildOverviewPageModel(repo, ctx(null, workspaceId));
    const denied2 = await buildOverviewPageModel(repo, ctx("member", workspaceId, "removed"));
    assert.deepEqual(denied1, denied2);
    assert.deepEqual(JSON.stringify(denied1), JSON.stringify({ ok: false }));
  });

  it("carries every expected overview metric", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval", totalBaseUnits: "50000" });
    await addPayout(repo, workspaceId, { status: "pending_approval", totalBaseUnits: "30000" });
    await addCompletedPayout(repo, workspaceId, { withHash: true, totalBaseUnits: "20000" });
    await addPayout(repo, workspaceId, { status: "execution_unknown" });
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { status: "claimed" });
    await addAgentRun(repo, workspaceId, { withJson: true, status: "prepared", rawText: "pay blossom [REDACTED]" });

    const model = await buildOverviewPageModel(repo, ctx("owner", workspaceId));
    assert.ok(model.ok);
    if (!model.ok) return;
    const overview = model.overview;
    assert.equal(overview.pendingApprovals, 2);
    assert.equal(overview.pendingClaimLinks, 1);
    assert.equal(overview.claimedWaitingApproval, 1);
    assert.equal(overview.completedToday, 1);
    assert.equal(overview.completedTodayUsdc, "0.02");
    assert.equal(overview.preparedTodayUsdc, "0.08");
    assert.equal(overview.failedOrUnknown, 1);
    assert.equal(overview.activeMembers, 3);
    assert.equal(overview.recipientCount, 0);
    assert.equal(overview.recentAuditEvents.length, 0);
    assert.equal(overview.recentAgentRuns.length, 1);
    assert.equal(overview.claimCountCapped, false);
  });

  it("cross-workspace data never appears in the model", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addPayout(repo, otherWorkspaceId, { status: "pending_approval" });
    await addClaim(repo, otherWorkspaceId, { status: "claimed" });
    await addAgentRun(repo, otherWorkspaceId, { rawText: "x [REDACTED]" });

    const model = await buildOverviewPageModel(repo, ctx("owner", workspaceId));
    assert.ok(model.ok);
    if (!model.ok) return;
    assert.equal(model.overview.pendingApprovals, 0);
    assert.equal(model.overview.pendingClaimLinks, 0);
    assert.equal(model.overview.claimedWaitingApproval, 0);
    assert.equal(model.overview.recentAgentRuns.length, 0);
  });

  it("contains no raw token material, provider JSON, or transaction hashes", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { tokenHash, tokenPrefix } = await addClaim(repo, workspaceId, { status: "claimed" });
    await addAgentRun(repo, workspaceId, { withJson: true, status: "prepared" });
    await addCompletedPayout(repo, workspaceId, { withHash: true });

    const model = await buildOverviewPageModel(repo, ctx("owner", workspaceId));
    assert.ok(model.ok);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes(tokenHash));
    assert.ok(!serialized.includes(tokenPrefix));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("token_prefix"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    // No tx hash may surface on the overview at all (pipeline proof lives on
    // payout detail pages).
    assert.equal(/0x[0-9a-fA-F]{64}/.test(serialized), false);
  });

  it("the model is JSON-serializable", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval" });
    const model = await buildOverviewPageModel(repo, ctx("approver", workspaceId));
    assert.ok(model.ok);
    if (!model.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(model));
    assert.equal(roundTrip.ok, true);
    assert.equal(roundTrip.roleLabel, "APPROVER");
    assert.equal(roundTrip.overview.pendingApprovals, 1);
  });

  it("label mappers are pure and user-safe", () => {
    assert.equal(roleLabel("owner"), "OWNER");
    assert.equal(roleLabel(null), null);
    assert.equal(modeLabel("community"), "COMMUNITY");
    assert.equal(modeLabel(null), null);
    assert.equal(auditEventLabel("approval_granted"), "Approved");
    assert.equal(auditEventLabel("agent_run_started"), "Agent request received");
    assert.equal(auditEventLabel("unknown_future_event"), "Event recorded");
  });
});
