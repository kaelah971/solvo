import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAgentRunView, listAgentRunViews } from "../../src/server/dashboard/agent-runs.ts";
import { buildAuditView, auditEventSource, summarizeAuditMetadata } from "../../src/server/dashboard/audit.ts";
import { listMemberViews } from "../../src/server/dashboard/members.ts";
import { listRecipientViews } from "../../src/server/dashboard/recipients.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { addAgentRun, addPayout, makeFixture, MEMBER, NOW, OWNER } from "./fixtures.ts";

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

describe("agent runs read model", () => {
  it("lists runs scoped to the workspace, newest first, redacted text only", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const first = await addAgentRun(repo, workspaceId, { rawText: "pay blossom 0.01 USDC [REDACTED]" });
    await addAgentRun(repo, workspaceId, { rawText: "check claim xyz [REDACTED]" });
    await addAgentRun(repo, otherWorkspaceId, { rawText: "foreign run [REDACTED]" });

    const views = await listAgentRunViews(repo, ctx("owner", workspaceId));
    assert.equal(views.length, 2);
    const ids = new Set(views.map((view) => view.runId));
    assert.ok(ids.has(first));
    assert.ok(views.every((view) => (view.rawTextRedacted ?? "").includes("[REDACTED]")));
    // Deterministic sort: (created_at, id) descending between consecutive rows.
    for (let i = 1; i < views.length; i += 1) {
      assert.ok(compareKeys(views[i - 1].createdAt, views[i - 1].runId, views[i].createdAt, views[i].runId) >= 0);
    }
  });

  it("exposes redacted raw text only, never provider/decision/interpretation JSON", async () => {
    const { repo, workspaceId } = await makeFixture();
    const runId = await addAgentRun(repo, workspaceId, {
      withJson: true,
      status: "prepared",
      rawText: "pay blossom 0.01 USDC [REDACTED]",
    });

    const view = await getAgentRunView(repo, ctx("owner", workspaceId), runId);
    assert.ok(view);
    assert.equal(view.status, "prepared");
    assert.equal(view.provider, "static");
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes("candidates"));
    assert.ok(!serialized.includes("interpretation"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes('"intent"'));
    assert.ok(!serialized.includes("sk-"));
  });

  it("getAgentRunView returns null for unknown and cross-workspace run ids", async () => {
    const { repo, otherWorkspaceId, workspaceId } = await makeFixture();
    const foreign = await addAgentRun(repo, otherWorkspaceId, { rawText: "x" });

    assert.equal(await getAgentRunView(repo, ctx("owner", workspaceId), foreign), null);
    assert.equal(await getAgentRunView(repo, ctx("owner", workspaceId), "does-not-exist"), null);
    assert.equal(workspaceId.length > 0, true);
  });

  it("views are JSON-serializable and carry no transaction truth", async () => {
    const { repo, workspaceId } = await makeFixture();
    const runId = await addAgentRun(repo, workspaceId, { withJson: true, status: "prepared" });

    const view = await getAgentRunView(repo, ctx("owner", workspaceId), runId);
    assert.ok(view);
    assert.equal(JSON.parse(JSON.stringify(view)).runId, runId);
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes("0x"));
    assert.ok(!serialized.includes("completed\""));
    assert.ok(!serialized.includes("txHash"));
  });
});

describe("audit read model", () => {
  it("builds safe views with whitelisted metadata summaries", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_created",
      actorType: "member",
      actorId: MEMBER,
      metadata: {
        amountBaseUnits: "50000",
        tokenPrefix: "a1b2c3d4",
        tokenHash: "0xdeadbeef",
        internalFlag: "never-show",
      },
    });

    const events = await repo.listAuditEventsByWorkspace(workspaceId);
    const view = buildAuditView(events[0]);
    assert.equal(view.eventType, "claim_created");
    assert.equal(view.source, "claim");
    assert.equal(view.actorMaskedId, "7778…999");
    assert.deepEqual(view.summary, { amountUsdc: "0.05" });
    const serialized = JSON.stringify(view);
    assert.ok(!serialized.includes("a1b2c3d4"));
    assert.ok(!serialized.includes("0xdeadbeef"));
    assert.ok(!serialized.includes("internalFlag"));
  });

  it("summarizeAuditMetadata ignores unsafe keys entirely", () => {
    const summary = summarizeAuditMetadata({
      amountBaseUnits: "123456",
      itemCount: 3,
      totalBaseUnits: "500000",
      reason: "for the sprint",
      batchId: "batch-1",
      claimedRecipient: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      tokenHash: "hash",
      executionId: "kh-exec-9",
      transactionHash: "0xdeadbeef",
      rawProviderBlob: { a: 1 },
    });
    assert.ok(summary);
    assert.equal(summary.amountUsdc, "0.123456");
    assert.equal(summary.itemCount, 3);
    assert.equal(summary.totalUsdc, "0.5");
    assert.equal(summary.maskedRecipient, "0x76d7…7486");
    assert.equal("tokenHash" in summary, false);
    assert.equal("executionId" in summary, false);
    assert.equal("transactionHash" in summary, false);
    assert.equal("rawProviderBlob" in summary, false);
  });

  it("event sources distinguish payout/claim/agent/workspace truth", () => {
    assert.equal(auditEventSource("approval_granted"), "payout");
    assert.equal(auditEventSource("execution_completed"), "payout");
    assert.equal(auditEventSource("claim_approved"), "claim");
    assert.equal(auditEventSource("claim_reissued"), "claim");
    assert.equal(auditEventSource("agent_run_started"), "agent");
    assert.equal(auditEventSource("member_added"), "workspace");
    assert.equal(auditEventSource("policy_blocked"), "workspace");
  });

  it("audit events can be filtered by claim id via metadata", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_rejected",
      actorType: "approver",
      actorId: "444555666",
      metadata: { claimId: "claim-1" },
    });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_rejected",
      actorType: "approver",
      actorId: "444555666",
      metadata: { claimId: "claim-2" },
    });

    const filtered = await repo.listAuditEventsByWorkspace(workspaceId, { claimId: "claim-1" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].metadata.claimId, "claim-1");
  });

  it("audit list is workspace-scoped and deterministic (newest first)", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.appendAuditEvent({ workspaceId, payoutId: null, payoutItemId: null, eventType: "request_created", actorType: "member", actorId: MEMBER, metadata: {} });
    await repo.appendAuditEvent({ workspaceId, payoutId: null, payoutItemId: null, eventType: "approval_required", actorType: "system", actorId: null, metadata: {} });
    await repo.appendAuditEvent({ workspaceId: otherWorkspaceId, payoutId: null, payoutItemId: null, eventType: "request_created", actorType: "member", actorId: MEMBER, metadata: {} });

    const events = await repo.listAuditEventsByWorkspace(workspaceId);
    assert.equal(events.length, 2);
    assert.ok(events.every((event) => event.workspace_id === workspaceId));
    for (let i = 1; i < events.length; i += 1) {
      assert.ok(compareKeys(events[i - 1].created_at, events[i - 1].id, events[i].created_at, events[i].id) >= 0);
    }
  });
});

/** (created_at, id) descending comparison — the repository's sort contract. */
function compareKeys(aCreated: string, aId: string, bCreated: string, bId: string): number {
  const aKey = `${aCreated}\u0000${aId}`;
  const bKey = `${bCreated}\u0000${bId}`;
  return aKey.localeCompare(bKey);
}

describe("members and recipients read models", () => {
  it("member list is scoped by workspace with masked identities", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.addWorkspaceMember({ workspaceId: otherWorkspaceId, telegramUserId: "555666777", role: "owner" });

    const views = await listMemberViews(repo, ctx("owner", workspaceId));
    assert.equal(views.length, 3);
    assert.equal(views.filter((view) => view.role === "owner").length, 1);
    assert.ok(views.every((view) => view.maskedId.includes("…")));
    assert.ok(!views.some((view) => view.maskedId === "555666777"));
  });

  it("recipient list is scoped by workspace; full wallet owner/approver only", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const wallet = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: wallet, createdBy: MEMBER });
    await repo.addRecipient({ workspaceId: otherWorkspaceId, alias: "foreign", walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e", createdBy: MEMBER });

    const ownerViews = await listRecipientViews(repo, ctx("owner", workspaceId));
    assert.equal(ownerViews.length, 1);
    assert.equal(ownerViews[0].wallet, wallet);
    assert.equal(ownerViews[0].createdByLabel?.includes("…"), true);

    const memberViews = await listRecipientViews(repo, ctx("member", workspaceId));
    assert.equal(memberViews[0].wallet, "0x76d7…7486");
  });

  it("all dashboard views are JSON-serializable", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId, { rawText: "x [REDACTED]" });
    await addPayout(repo, workspaceId);
    await repo.addRecipient({
      workspaceId,
      alias: "blossom",
      walletAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      createdBy: MEMBER,
    });

    for (const view of await listMemberViews(repo, ctx("owner", workspaceId))) {
      assert.ok(JSON.parse(JSON.stringify(view)));
    }
    for (const view of await listRecipientViews(repo, ctx("owner", workspaceId))) {
      assert.ok(JSON.parse(JSON.stringify(view)));
    }
    const runs = await listAgentRunViews(repo, ctx("owner", workspaceId));
    assert.equal(runs.length, 1);
    assert.equal(JSON.parse(JSON.stringify(runs[0])).runId, runs[0].runId);
  });
});
