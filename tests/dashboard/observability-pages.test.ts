import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentRunIntentLabel,
  agentRunSurfaceLabel,
  auditSourceLabel,
  buildAgentRunDetailPageModel,
  buildAgentRunListPageModel,
  buildAuditPageModel,
} from "../../src/server/dashboard/observability-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import {
  addAgentRun,
  addClaim,
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OWNER,
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

describe("agent runs list page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId);
    assert.deepEqual(await buildAgentRunListPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildAgentRunListPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId);
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildAgentRunListPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.items.length, 1, role);
        assert.equal(model.empty, false, role);
      }
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addAgentRun(repo, otherWorkspaceId);
    const model = await buildAgentRunListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("shows provider/status/intent/decision labels and redacted text only", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId, {
      withJson: true,
      status: "prepared",
      rawText: "pay blossom 0.01 USDC [REDACTED]",
    });
    const model = await buildAgentRunListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const item = model.items[0];
    assert.equal(item.view.provider, "static");
    assert.equal(item.view.rawTextRedacted, "pay blossom 0.01 USDC [REDACTED]");
    assert.equal(item.statusLabel, "PREPARED");
    assert.equal(item.intentLabel, "Prepare payment");
    assert.equal(item.surfaceLabel, "TELEGRAM");
    assert.equal(item.decisionLabel.length > 0, true);
  });

  it("never exposes provider/interpretation/decision/candidates JSON or secrets", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId, { withJson: true, status: "prepared" });
    const model = await buildAgentRunListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("candidates"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes('"intent"'));
    assert.ok(!serialized.includes("sk-"));
    assert.ok(!serialized.includes("0x"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("txHash"));
  });

  it("is JSON-serializable and deterministic", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addAgentRun(repo, workspaceId);
    const model = await buildAgentRunListPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(JSON.parse(JSON.stringify(model)).items.length, 1);
  });
});

describe("agent run detail page model", () => {
  it("renders same-workspace runs and rejects cross-workspace/unknown ids", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const runId = await addAgentRun(repo, workspaceId);
    const foreign = await addAgentRun(repo, otherWorkspaceId);

    const ok = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), runId);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.run.runId, runId);

    assert.deepEqual(await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), foreign), { ok: false });
    assert.deepEqual(await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist"), { ok: false });
  });

  it("links to payout/claim only when the linked entity is in the same workspace", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);
    const foreignPayout = await addPayout(repo, otherWorkspaceId);
    const { claimId } = await addClaim(repo, workspaceId);

    const linked = await addAgentRun(repo, workspaceId, { rawText: "linked [REDACTED]" });
    await repo.updateAgentRun(linked, { payoutId, claimId });
    const ok = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), linked);
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.payoutLink, payoutId);
      assert.equal(ok.claimLink, claimId);
    }

    const stale = await addAgentRun(repo, workspaceId, { rawText: "stale [REDACTED]" });
    await repo.updateAgentRun(stale, { payoutId: foreignPayout.payoutId, claimId: "foreign-claim" });
    const staleOk = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), stale);
    assert.equal(staleOk.ok, true);
    if (staleOk.ok) {
      assert.equal(staleOk.payoutLink, null, "foreign payout must not link");
      assert.equal(staleOk.claimLink, null, "unknown claim must not link");
    }
  });

  it("detail JSON never contains raw blobs, secrets, or tx truth", async () => {
    const { repo, workspaceId } = await makeFixture();
    const runId = await addAgentRun(repo, workspaceId, { withJson: true, status: "failed", rawText: "x [REDACTED]" });
    const model = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), runId);
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("sk-"));
    assert.ok(!serialized.includes("0x"));
  });
});

describe("audit page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    assert.deepEqual(await buildAuditPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildAuditPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildAuditPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) assert.equal(model.items.length, 1, role);
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId: otherWorkspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });
    const model = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("shows event type, timestamp, actor, source family, and safe summary only", async () => {
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
    const model = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const item = model.items[0];
    assert.equal(item.eventLabel, "Claim link created");
    assert.equal(item.sourceLabel, "CLAIM");
    assert.equal(item.view.actorMaskedId?.includes("…"), true);
    assert.equal(item.summaryLabel, "0.05 USDC");
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("a1b2c3d4"), "token prefix leaked");
    assert.ok(!serialized.includes("0xdeadbeef"), "token hash leaked");
    assert.ok(!serialized.includes("internalFlag"), "raw metadata leaked");
    assert.ok(!serialized.includes("token_prefix"), "raw metadata key leaked");
  });

  it("payout events carry payout references and reason summaries", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId, { status: "pending_approval" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId,
      payoutItemId: null,
      eventType: "approval_rejected",
      actorType: "approver",
      actorId: "444555666",
      metadata: { reason: "out of budget" },
    });
    const model = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const item = model.items[0];
    assert.equal(item.entityLabel, `Payout ${payoutId.slice(0, 8)}`);
    assert.equal(item.sourceLabel, "PAYOUT");
    assert.equal(item.summaryLabel, "out of budget");
  });

  it("audit model never exposes execution ids or secret markers", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "request_created",
      actorType: "member",
      actorId: MEMBER,
      metadata: { executionId: "kh-exec-9", apiKey: "sk-abc" },
    });
    const model = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("kh-exec-9"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("sk-abc"));
    assert.ok(!serialized.includes("apiKey"));
  });

  it("is JSON-serializable and deterministic", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });
    const model = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(JSON.parse(JSON.stringify(model)).items.length, 1);
  });
});

describe("observability display helpers", () => {
  it("surface/intent/source labels are safe and mapped", () => {
    assert.equal(agentRunSurfaceLabel("telegram"), "TELEGRAM");
    assert.equal(agentRunSurfaceLabel("web"), "WEB");
    assert.equal(agentRunSurfaceLabel("mystery"), "OTHER");
    assert.equal(agentRunIntentLabel("prepare_payment"), "Prepare payment");
    assert.equal(agentRunIntentLabel("prepare_batch_payment"), "Prepare batch");
    assert.equal(agentRunIntentLabel("create_claim_link"), "Create claim link");
    assert.equal(agentRunIntentLabel("inspect_payment_status"), "Payment status");
    assert.equal(agentRunIntentLabel("clarify_missing_fields"), "Needs clarification");
    assert.equal(agentRunIntentLabel("unsupported"), "Unsupported");
    assert.equal(agentRunIntentLabel(null), "Other");
    assert.equal(auditSourceLabel("payout"), "PAYOUT");
    assert.equal(auditSourceLabel("claim"), "CLAIM");
    assert.equal(auditSourceLabel("agent"), "AGENT");
    assert.equal(auditSourceLabel("workspace"), "WORKSPACE");
    assert.equal(auditSourceLabel("system"), "SYSTEM");
  });
});
