import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canApproveReject,
  canManageMembers,
  canManagePolicies,
  canManageRecipients,
  canReissueClaim,
  canViewApprovals,
  canViewDashboard,
  canViewSensitiveDestinations,
  isActiveMember,
  makeDashboardContext,
  maskIdentity,
} from "../../src/server/dashboard/access.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { resolveDashboardContext } from "../../src/server/dashboard/access.ts";
import { makeWorkspace, NOW, OUTSIDER } from "./fixtures.ts";

function ctx(input: {
  role: "owner" | "approver" | "member" | null;
  status?: "active" | "removed" | null;
  mode?: "community" | null;
}) {
  return makeDashboardContext({
    workspaceId: "ws-1",
    telegramUserId: "123456789",
    role: input.role,
    status: input.status ?? "active",
    mode: input.mode ?? "community",
    nowIso: NOW,
  });
}

describe("dashboard access helpers", () => {
  it("owner/approver/member access helpers differ correctly", () => {
    const owner = ctx({ role: "owner" });
    const approver = ctx({ role: "approver" });
    const member = ctx({ role: "member" });

    assert.ok(isActiveMember(owner));
    assert.ok(canViewDashboard(owner));
    assert.ok(canViewDashboard(approver));
    assert.ok(canViewDashboard(member));
    assert.ok(canViewApprovals(member));

    assert.ok(canApproveReject(owner));
    assert.ok(canApproveReject(approver));
    assert.equal(canApproveReject(member), false);

    assert.ok(canManageMembers(owner));
    assert.equal(canManageMembers(approver), false);
    assert.equal(canManageMembers(member), false);

    assert.ok(canManageRecipients(owner));
    assert.ok(canManageRecipients(approver));
    assert.equal(canManageRecipients(member), false);

    assert.ok(canManagePolicies(owner));
    assert.equal(canManagePolicies(approver), false);

    assert.ok(canReissueClaim(owner));
    assert.ok(canReissueClaim(approver));
    assert.equal(canReissueClaim(member), false);

    assert.ok(canViewSensitiveDestinations(owner));
    assert.ok(canViewSensitiveDestinations(approver));
    assert.equal(canViewSensitiveDestinations(member), false);
  });

  it("inactive and non-member contexts are denied everywhere", () => {
    const removed = ctx({ role: "owner", status: "removed" });
    const nonMember = ctx({ role: null, status: null });

    for (const denied of [removed, nonMember]) {
      assert.equal(isActiveMember(denied), false);
      assert.equal(canViewDashboard(denied), false);
      assert.equal(canViewApprovals(denied), false);
      assert.equal(canApproveReject(denied), false);
      assert.equal(canManageMembers(denied), false);
      assert.equal(canManageRecipients(denied), false);
      assert.equal(canManagePolicies(denied), false);
      assert.equal(canReissueClaim(denied), false);
      assert.equal(canViewSensitiveDestinations(denied), false);
    }
  });

  it("a null workspace mode denies (no workspace)", () => {
    const noWorkspace = ctx({ role: null, status: null, mode: null });
    assert.equal(canViewDashboard(noWorkspace), false);
  });

  it("resolveDashboardContext reads membership fresh from the repository", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);

    const ownerCtx = await resolveDashboardContext({
      repo,
      workspaceId,
      telegramUserId: "111222333",
      nowIso: NOW,
    });
    assert.equal(ownerCtx.role, "owner");
    assert.equal(ownerCtx.status, "active");
    assert.equal(ownerCtx.mode, "community");

    const outsider = await resolveDashboardContext({
      repo,
      workspaceId,
      telegramUserId: OUTSIDER,
      nowIso: NOW,
    });
    assert.equal(outsider.role, null);
    assert.equal(outsider.status, null);
    assert.ok(!canViewDashboard(outsider));

    // Removal is picked up on the next resolution.
    await repo.removeWorkspaceMember(workspaceId, "111222333");
    const removed = await resolveDashboardContext({
      repo,
      workspaceId,
      telegramUserId: "111222333",
      nowIso: NOW,
    });
    assert.equal(removed.status, "removed");
    assert.ok(!canViewDashboard(removed));
  });

  it("maskIdentity masks values and stays deterministic", () => {
    assert.equal(maskIdentity("123456789"), "1234…789");
    assert.equal(maskIdentity("123456789"), "1234…789");
    assert.equal(maskIdentity("abc"), "…");
    assert.equal(maskIdentity(null), null);
  });
});
