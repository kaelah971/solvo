import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import postgres from "postgres";

import { whereFragment } from "../../src/server/db/postgres-repository.ts";
import { requireDashboardContext } from "../../src/server/dashboard/session.ts";
import { buildOverviewPageModel } from "../../src/server/dashboard/overview-page.ts";
import { buildPayoutListPageModel } from "../../src/server/dashboard/payouts-page.ts";
import { buildApprovalsPageModel } from "../../src/server/dashboard/approvals-page.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { addPayout, makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

const FIVE_MIN = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();

async function gateAndLoad(repo: MemoryRepository, userId = OWNER) {
  const workspaceId = await makeWorkspace(repo);
  const required = await requireDashboardContext({
    repo,
    session: { workspaceId, telegramUserId: userId },
    nowIso: FIVE_MIN,
  });
  assert.equal(required.ok, true, "gate must allow the active member");
  if (!required.ok) throw new Error("gate denied");
  return { workspaceId, ctx: required.ctx };
}

describe("dashboard overview load — production parity", () => {
  it("1. renders for a valid owner session with NO payout data (no crash on empty)", async () => {
    const repo = new MemoryRepository();
    const { ctx } = await gateAndLoad(repo);

    const model = await buildOverviewPageModel(repo, ctx);
    assert.equal(model.ok, true, "empty overview must load, not throw");
    if (model.ok) {
      assert.equal(model.overview.pendingApprovals, 0);
      assert.equal(model.overview.completedToday, 0);
      assert.equal(model.overview.failedOrUnknown, 0);
      assert.equal(model.overview.activeMembers, 3, "owner + approver + member fixture");
    }
  });

  it("2. renders for a valid owner session WITH payout items (no crash on data)", async () => {
    const repo = new MemoryRepository();
    const { workspaceId, ctx } = await gateAndLoad(repo);
    await addPayout(repo, workspaceId, { status: "pending_approval", sourceType: "telegram_command" });

    const model = await buildOverviewPageModel(repo, ctx);
    assert.equal(model.ok, true, "overview with items must load, not throw");
    if (model.ok) {
      assert.ok(model.overview.pendingApprovals >= 1, "pending item surfaced");
    }

    const payouts = await buildPayoutListPageModel(repo, ctx);
    assert.equal(payouts.ok, true, "payouts list must load, not throw");
    if (payouts.ok) assert.equal(payouts.empty, false);

    const approvals = await buildApprovalsPageModel(repo, ctx);
    assert.equal(approvals.ok, true, "approvals list must load, not throw");
  });

  it("3. whereFragment returns a real appendable array — the f.append crash is gone", async () => {
    // A real postgres.js client (max:0 → never connects; fragments are just
    // Query objects until executed).
    const sql = postgres("postgres://none:none@127.0.0.1:1/none", { max: 0, connect_timeout: 200 });
    try {
      const fragment = sql`p.workspace_id = ${"ws-1"}`;

      // Pre-fix regression: casting a bare fragment to "appendable" crashed
      // with `f.append is not a function` — prove that failure mode existed
      // and is what production hit.
      assert.equal(typeof (fragment as unknown as { append?: unknown }).append, "undefined");

      // Post-fix: the builder is a REAL array with a working append helper.
      const where = whereFragment(fragment);
      assert.equal(Array.isArray(where), true, "builder must be an array (serializer flattens Fragment[])");
      assert.equal(typeof where.append, "function", "builder must expose append");
      where.append(sql` AND pi.status::text = ANY(${["pending_approval"]})`);
      where.append(sql` AND pi.created_at >= ${"2026-01-01T00:00:00.000Z"}`);
      assert.equal(where.length, 3, "initial + 2 appends accumulate");
      assert.equal(typeof (where[0] as unknown as { append?: unknown }).append, "undefined", "elements stay plain fragments");
    } finally {
      await sql.end().catch(() => {});
    }

    // Serializer + type contracts of the installed postgres.js: arrays of
    // Query fragments are flattened natively (types.js) and typed (Fragment[]).
    const serializer = readFileSync("node_modules/postgres/src/types.js", "utf8");
    assert.match(serializer, /value\[0\] instanceof Query/, "postgres serializer must flatten Fragment[]");
    const types = readFileSync("node_modules/postgres/types/index.d.ts", "utf8");
    assert.match(types, /type Fragment = PendingQuery<any>/, "Fragment type exists");
    assert.match(types, /\| Fragment\[\]/, "Fragment[] is a typed interpolation");
  });

  it("4. gate allowed + overview read model load without throwing (whole /app data path)", async () => {
    const repo = new MemoryRepository();
    const { workspaceId, ctx } = await gateAndLoad(repo);
    await addPayout(repo, workspaceId, { status: "pending_approval" });

    // Mirrors src/app/app/page.tsx exactly.
    const model = await buildOverviewPageModel(repo, ctx);
    assert.equal(model.ok, true);
    if (model.ok) {
      assert.equal(typeof model.workspaceLabel, "string");
      assert.equal(typeof model.roleLabel, "string");
      assert.ok(model.roleLabel.toLowerCase().includes("owner"));
    }
  });

  it("5. missing/invalid session still shows the generic unavailable gate", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);

    const noSession = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN });
    assert.deepEqual(noSession, { ok: false });

    const outsider = await requireDashboardContext({
      repo,
      session: { workspaceId: (await makeWorkspace(repo)), telegramUserId: OUTSIDER },
      nowIso: FIVE_MIN,
    });
    assert.deepEqual(outsider, { ok: false });
  });

  it("6. no sensitive data leaks in unavailable states or overview output", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);

    const denied = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN });
    assert.ok(!JSON.stringify(denied).includes(OWNER), "user id leaked in the denied gate");
    assert.ok(!JSON.stringify(denied).includes(workspaceId), "workspace id leaked in the denied gate");

    const { ctx } = await gateAndLoad(repo);
    const model = await buildOverviewPageModel(repo, ctx);
    assert.equal(model.ok, true);
    if (model.ok) {
      const serialized = JSON.stringify(model);
      assert.ok(!serialized.includes(OWNER), "telegram user id leaked into the overview model");
      // The read model carries workspace.id internally (never rendered); the
      // user-facing labels must never contain it.
      assert.ok(!model.workspaceLabel.includes(ctx.workspaceId), "workspace id rendered in the label");
    }
  });
});
