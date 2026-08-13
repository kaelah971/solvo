import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import { buildApprovalsPageModel } from "../../src/server/dashboard/approvals-page.ts";
import {
  buildAgentRunDetailPageModel,
  buildAgentRunListPageModel,
  buildAuditPageModel,
} from "../../src/server/dashboard/observability-page.ts";
import { buildClaimDetailPageModel, buildClaimListPageModel } from "../../src/server/dashboard/claims-page.ts";
import { buildMembersPageModel, buildRecipientsPageModel } from "../../src/server/dashboard/directory-page.ts";
import { buildOverviewPageModel } from "../../src/server/dashboard/overview-page.ts";
import {
  buildBatchDetailPageModel,
  buildBatchListPageModel,
  buildPayoutDetailPageModel,
  buildPayoutListPageModel,
} from "../../src/server/dashboard/payouts-page.ts";
import { buildPolicyPageModel } from "../../src/server/dashboard/policies-page.ts";
import { requireDashboardContext } from "../../src/server/dashboard/session.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import {
  addAgentRun,
  addClaim,
  addPayout,
  makeFixture,
  MEMBER,
  NOW,
  OUTSIDER,
  OWNER,
} from "./fixtures.ts";

const FIVE_MIN = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();

type ListBuilder = { route: string; build: (repo: MemoryRepository, ctx: DashboardContext) => Promise<unknown> };

const LIST_BUILDERS: ListBuilder[] = [
  { route: "overview", build: (repo, ctx) => buildOverviewPageModel(repo, ctx) },
  { route: "approvals", build: (repo, ctx) => buildApprovalsPageModel(repo, ctx) },
  { route: "payouts", build: (repo, ctx) => buildPayoutListPageModel(repo, ctx) },
  { route: "batches", build: (repo, ctx) => buildBatchListPageModel(repo, ctx) },
  { route: "claims", build: (repo, ctx) => buildClaimListPageModel(repo, ctx) },
  { route: "recipients", build: (repo, ctx) => buildRecipientsPageModel(repo, ctx) },
  { route: "members", build: (repo, ctx) => buildMembersPageModel(repo, ctx) },
  { route: "policies", build: (repo, ctx) => buildPolicyPageModel(repo, ctx) },
  { route: "agent-runs", build: (repo, ctx) => buildAgentRunListPageModel(repo, ctx) },
  { route: "audit", build: (repo, ctx) => buildAuditPageModel(repo, ctx) },
];

function isOk(model: unknown): model is { ok: true } {
  return typeof model === "object" && model !== null && (model as { ok?: boolean }).ok === true;
}

function deniedCtx(workspaceId: string, overrides: Partial<DashboardContext> = {}): DashboardContext {
  return makeDashboardContext({
    workspaceId,
    telegramUserId: OUTSIDER,
    role: null,
    status: null,
    mode: null,
    nowIso: FIVE_MIN,
    ...overrides,
  });
}

describe("dashboard route parity — one shared gate for every route", () => {
  it("1-10. a valid owner session renders every dashboard route model (empty workspace)", async () => {
    const { repo, workspaceId } = await makeFixture();
    const required = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OWNER },
      nowIso: FIVE_MIN,
    });
    assert.equal(required.ok, true);
    if (!required.ok) return;
    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(repo, required.ctx);
      assert.equal(isOk(model), true, `${builder.route} must render for the owner session (empty)`);
    }
  });

  it("1-10. the same owner session renders every route with real workspace data", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "telegram_command" });
    await addClaim(repo, workspaceId, { status: "claimed" });
    await addAgentRun(repo, workspaceId, { rawText: "pay blossom 0.01 USDC" });
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486", createdBy: OWNER });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });

    const required = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OWNER },
      nowIso: FIVE_MIN,
    });
    assert.equal(required.ok, true);
    if (!required.ok) return;
    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(repo, required.ctx);
      assert.equal(isOk(model), true, `${builder.route} must render with data`);
    }
  });

  it("11. a missing or tampered cookie denies every route (one shared gate)", async () => {
    const { repo, workspaceId } = await makeFixture();

    const missing = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN });
    assert.deepEqual(missing, { ok: false });

    const tampered = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OUTSIDER }, // a valid cookie never encodes this for the member row
      nowIso: FIVE_MIN,
    });
    assert.deepEqual(tampered, { ok: false });

    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(repo, deniedCtx(workspaceId));
      assert.deepEqual(model, { ok: false }, `${builder.route} leaked data for a denied session`);
    }
  });

  it("12. inactive/removed members are denied on every route", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.removeWorkspaceMember(workspaceId, MEMBER);

    const removed = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: MEMBER },
      nowIso: FIVE_MIN,
    });
    assert.deepEqual(removed, { ok: false });

    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(
        repo,
        deniedCtx(workspaceId, {
          telegramUserId: MEMBER,
          role: "member",
          status: "removed",
          mode: "community",
        }),
      );
      assert.deepEqual(model, { ok: false }, `${builder.route} admitted a removed member`);
    }
  });

  it("13. detail routes render in-workspace items and stay generic for foreign/missing items", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const { payoutId } = await addPayout(repo, workspaceId);
    const batch = await addPayout(repo, workspaceId, { sourceType: "telegram_batch" });
    const { claimId } = await addClaim(repo, workspaceId);
    const runId = await addAgentRun(repo, workspaceId);
    const foreignPayout = await addPayout(repo, otherWorkspaceId);

    const required = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OWNER },
      nowIso: FIVE_MIN,
    });
    assert.equal(required.ok, true);
    if (!required.ok) return;
    const ctx = required.ctx;

    assert.equal(isOk(await buildPayoutDetailPageModel(repo, ctx, payoutId)), true, "own payout detail");
    assert.equal(isOk(await buildBatchDetailPageModel(repo, ctx, batch.payoutId)), true, "own batch detail");
    assert.equal(isOk(await buildClaimDetailPageModel(repo, ctx, claimId)), true, "own claim detail");
    assert.equal(isOk(await buildAgentRunDetailPageModel(repo, ctx, runId)), true, "own run detail");

    const unknown = await buildPayoutDetailPageModel(repo, ctx, "does-not-exist");
    const foreign = await buildPayoutDetailPageModel(repo, ctx, foreignPayout.payoutId);
    assert.deepEqual(foreign, unknown, "cross-workspace payout leaks existence");
    assert.deepEqual(unknown, { ok: false });

    assert.deepEqual(await buildClaimDetailPageModel(repo, ctx, "does-not-exist"), { ok: false });
    assert.deepEqual(await buildAgentRunDetailPageModel(repo, ctx, "does-not-exist"), { ok: false });
  });

  it("13b. data-loading never throws and denied contexts are never mislabeled as allowed", async () => {
    const { repo, workspaceId } = await makeFixture();
    const ctx = deniedCtx(workspaceId);
    for (const builder of LIST_BUILDERS) {
      await assert.doesNotReject(() => builder.build(repo, ctx), `${builder.route} threw on a denied context`);
    }
    // A non-member context must never produce an ok model.
    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(repo, ctx);
      assert.equal(isOk(model), false, `${builder.route} returned ok for a denied context`);
    }
  });

  it("14-15. mobile nav toggle is MENU / CLOSE and never SECTIONSMENU/SECTIONSCLOSE", () => {
    const nav = readFileSync("src/components/DashboardNav.tsx", "utf8");
    assert.match(nav, /\{open \? "Close" : "Menu"\}/);
    assert.doesNotMatch(nav, />\s*Sections\s*</);
    for (const legacy of ["SectionsMenu", "SectionsClose", "Sections Menu", "Sections Close", "SECTIONSMENU", "SECTIONSCLOSE"]) {
      assert.equal(nav.includes(legacy), false, `legacy toggle label "${legacy}" still present`);
    }
  });
});
