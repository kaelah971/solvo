import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  createDashboardLoginLink,
  hashDashboardLoginToken,
  verifyDashboardLoginToken,
} from "../../src/server/dashboard/login-links.ts";
import { buildApprovalsPageModel } from "../../src/server/dashboard/approvals-page.ts";
import { claimProofLabel, claimStatusLabel, buildClaimDetailPageModel, buildClaimListPageModel } from "../../src/server/dashboard/claims-page.ts";
import { buildRecipientsPageModel } from "../../src/server/dashboard/directory-page.ts";
import { buildAgentRunDetailPageModel, buildAgentRunListPageModel, buildAuditPageModel } from "../../src/server/dashboard/observability-page.ts";
import { buildOverviewPageModel } from "../../src/server/dashboard/overview-page.ts";
import {
  buildBatchDetailPageModel,
  buildBatchListPageModel,
  buildPayoutDetailPageModel,
  buildPayoutListPageModel,
} from "../../src/server/dashboard/payouts-page.ts";
import { payoutStateLabel } from "../../src/server/dashboard/payouts.ts";
import { buildPolicyPageModel } from "../../src/server/dashboard/policies-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import {
  addAgentRun,
  addClaim,
  addPayout,
  makeFixture,
  makeWorkspace,
  MEMBER,
  NOW,
  OWNER,
  TX_HASH,
  BASE_SCAN,
} from "./fixtures.ts";

/**
 * M12.11 — Dashboard security/truthfulness gate.
 *
 * A centralized adversarial pass over the whole dashboard surface: every
 * page/model re-proves the read-only, workspace-scoped, no-leak, and
 * pipeline-only-proof guarantees. Source-contract sweeps complement the
 * per-surface route tests; behavioral sweeps re-check the same properties
 * across ALL page-model builders at once.
 */

const PAGE_FILES = [
  "src/app/app/page.tsx",
  "src/app/app/layout.tsx",
  "src/app/app/approvals/page.tsx",
  "src/app/app/payouts/page.tsx",
  "src/app/app/payouts/[id]/page.tsx",
  "src/app/app/batches/page.tsx",
  "src/app/app/batches/[id]/page.tsx",
  "src/app/app/claims/page.tsx",
  "src/app/app/claims/[id]/page.tsx",
  "src/app/app/recipients/page.tsx",
  "src/app/app/members/page.tsx",
  "src/app/app/policies/page.tsx",
  "src/app/app/agent-runs/page.tsx",
  "src/app/app/agent-runs/[id]/page.tsx",
  "src/app/app/audit/page.tsx",
];

const MODEL_FILES = [
  "src/server/dashboard/access.ts",
  "src/server/dashboard/overview.ts",
  "src/server/dashboard/payouts.ts",
  "src/server/dashboard/claims.ts",
  "src/server/dashboard/members.ts",
  "src/server/dashboard/recipients.ts",
  "src/server/dashboard/audit.ts",
  "src/server/dashboard/agent-runs.ts",
  "src/server/dashboard/types.ts",
  "src/server/dashboard/overview-page.ts",
  "src/server/dashboard/payouts-page.ts",
  "src/server/dashboard/claims-page.ts",
  "src/server/dashboard/directory-page.ts",
  "src/server/dashboard/policies-page.ts",
  "src/server/dashboard/observability-page.ts",
  "src/server/dashboard/approvals-page.ts",
  "src/server/dashboard/page-gate.ts",
];

const AUTH_ROUTES = [
  "src/app/auth/telegram-link/route.ts",
  "src/app/auth/logout/route.ts",
];

const FLOW_FILE = "src/server/telegram/flows/dashboard-flow.ts";

const FORBIDDEN_IMPORT_PATTERNS = [
  "keeperhub/",
  "mcp-client",
  "execution-service",
  "execution-gateway",
  "telegram/flows",
  "telegram/webhook",
  "webhook",
  "judge/",
  "providers/",
  "openai",
  "anthropic",
  "ai-sdk",
  "postgres",
  "node:http",
  "node:https",
  "fetch(",
];

const BANNED_OUTPUT_TERMS = [
  "agent_run",
  "agent run",
  "interpreter",
  "planner",
  "schema",
  "token_hash",
  "tokenHash",
  "token_prefix",
  "tokenPrefix",
  "rawToken",
  "raw_token",
  "idempotency",
  "raw JSON",
  "keeperhub_execution_id",
  "execution id",
  "mcp-client",
  "webhook",
  "candidates_json",
  "interpretation_json",
  "decision_json",
  "simulation_result",
  "raw_keeperhub_status",
];

const BANNED_SECRET_TERMS = [
  "DATABASE_URL",
  "API_KEY",
  "BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "KEEPERHUB_API_KEY",
  "KEEPERHUB_MCP_URL",
  "SOLVO_DASHBOARD_COOKIE_SECRET",
  "sk-",
  "Bearer ",
];

const CONTROL_WORDS = ["APPROVE", "REJECT", "EXECUTE", "RETRY", "REISSUE", "ADD", "EDIT", "DELETE", "REMOVE", "SAVE", "APPLY"];

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

const LIST_BUILDERS: { name: string; build: (repo: Awaited<ReturnType<typeof makeFixture>>["repo"], ctx: DashboardContext) => Promise<unknown> }[] = [
  { name: "overview", build: (repo, c) => buildOverviewPageModel(repo, c) },
  { name: "payouts", build: (repo, c) => buildPayoutListPageModel(repo, c) },
  { name: "batches", build: (repo, c) => buildBatchListPageModel(repo, c) },
  { name: "claims", build: (repo, c) => buildClaimListPageModel(repo, c) },
  { name: "recipients", build: (repo, c) => buildRecipientsPageModel(repo, c) },
  { name: "policies", build: (repo, c) => buildPolicyPageModel(repo, c) },
  { name: "agent-runs", build: (repo, c) => buildAgentRunListPageModel(repo, c) },
  { name: "audit", build: (repo, c) => buildAuditPageModel(repo, c) },
  { name: "approvals", build: (repo, c) => buildApprovalsPageModel(repo, c) },
];

const DETAIL_BUILDERS: { name: string; build: (repo: Awaited<ReturnType<typeof makeFixture>>["repo"], ctx: DashboardContext, id: string) => Promise<unknown> }[] = [
  { name: "payout", build: (repo, c, id) => buildPayoutDetailPageModel(repo, c, id) },
  { name: "batch", build: (repo, c, id) => buildBatchDetailPageModel(repo, c, id) },
  { name: "claim", build: (repo, c, id) => buildClaimDetailPageModel(repo, c, id) },
  { name: "agent-run", build: (repo, c, id) => buildAgentRunDetailPageModel(repo, c, id) },
];

function isOkModel(model: unknown): model is { ok: true } {
  return typeof model === "object" && model !== null && (model as { ok?: boolean }).ok === true;
}

// ── Source contracts ───────────────────────────────────────────────────────

describe("M12.11 dashboard security gate — source contracts", () => {
  it("1-2, 31-35. every page imports no KeeperHub/MCP/execution/Telegram/webhook/model/fetch surface", () => {
    for (const file of [...PAGE_FILES, ...MODEL_FILES, ...AUTH_ROUTES, FLOW_FILE]) {
      const source = readFileSync(file, "utf8");
      const importLines = source.split("\n").filter((line) => /^\s*(import|export).*?(from|import\()/.test(line));
      for (const line of importLines) {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          assert.equal(line.includes(pattern), false, `${file} imports "${pattern}": ${line.trim()}`);
        }
      }
    }
  });

  it("36-38. every page is a server component with no action controls, forms, or handlers", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('"use client"'), false, `${file} is a client component`);
      assert.equal(source.includes("<form"), false, `${file} has a form`);
      assert.equal(source.includes("action="), false, `${file} has a server action`);
      assert.equal(source.includes("onClick"), false, `${file} has a client handler`);
      assert.equal(source.includes("<button"), false, `${file} has a button`);
      assert.equal(source.includes("<input"), false, `${file} has an input`);
      assert.equal(source.includes("type=\"submit\""), false);
      for (const word of CONTROL_WORDS) {
        assert.equal(source.includes(word), false, `${file} contains control term "${word}"`);
      }
    }
  });

  it("1-4. every page shares ONE gate: signed session + active membership re-check per request", () => {
    // The layout is the shell; every content page uses the single shared
    // requireDashboardPageContext helper (no per-page auth logic allowed).
    for (const file of PAGE_FILES) {
      if (file.endsWith("layout.tsx")) continue;
      const source = readFileSync(file, "utf8");
      assert.match(source, /requireDashboardPageContext\(await headers\(\), "/, `${file} misses the shared page gate`);
      assert.equal(source.includes("resolveDashboardPageGate"), false, `${file} bypasses the shared gate`);
      assert.equal(source.includes("getDbRepository("), false, `${file} acquires the repo outside the shared gate`);
      assert.equal(source.includes("requireDashboardContext"), false, `${file} calls the session seam directly`);
      assert.equal(source.includes("parseDashboardSessionCookie"), false, `${file} parses cookies itself`);
      const unavailable = (source.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
      assert.ok(unavailable >= 1, `${file}: expected >=1 unavailable branch, got ${unavailable}`);
      if (file.includes("[id]")) {
        assert.match(source, /<DashboardNotFound \/>/, `${file} misses the generic not-found panel`);
      }
    }
  });

  it("7-8. pages never trust query params and never reference session identity fields", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("searchParams"), false, `${file} reads search params`);
      assert.equal(source.includes("URLSearchParams"), false, `${file} parses search params`);
      assert.equal(source.includes("useSearchParams"), false);
      assert.equal(source.includes("window."), false, `${file} touches the browser`);
      assert.equal(source.includes("workspaceId"), false, `${file} references the raw workspace id`);
      assert.equal(source.includes("telegramUserId"), false, `${file} references the raw telegram id`);
    }
  });

  it("14-17, 39-42, 43. no page/model ships token material, raw blobs, secret markers, or hardcoded hashes", () => {
    // Pages: full prose vocabulary (the agent-runs pages are the documented
    // §13 exception for the operator "provider" label — not in this list).
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{40}/.test(source), false, `${file} contains an address-shaped literal`);
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
    // Models: raw column/blob keys only (prose may name fields truthfully).
    for (const file of MODEL_FILES) {
      const source = readFileSync(file, "utf8");
      for (const key of ["token_hash", "token_prefix", "tokenHash", "tokenPrefix", "rawToken", "raw_token"]) {
        assert.equal(source.includes(key), false, `${file} contains token-material key "${key}"`);
      }
      for (const key of ["candidates_json", "interpretation_json", "decision_json", "simulation_result", "raw_keeperhub_status", "keeperhub_execution_id"]) {
        assert.equal(source.includes(key), false, `${file} contains raw key "${key}"`);
      }
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
  });

  it("30, 44. page/model layer never exposes execution ids or raw SQL", () => {
    for (const file of [...PAGE_FILES, ...MODEL_FILES]) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("keeperhub_execution_id"), false, `${file} exposes execution ids`);
      assert.equal(source.includes("raw_keeperhub_status"), false, `${file} exposes keeperhub status blobs`);
      assert.equal(source.includes("simulation_result"), false);
      assert.equal(source.includes("candidates_json"), false);
      assert.equal(source.includes("interpretation_json"), false);
      assert.equal(source.includes("decision_json"), false);
      assert.equal(source.includes("this.sql"), false, `${file} touches the SQL client`);
      assert.equal(source.includes("sql`"), false, `${file} embeds raw SQL`);
      assert.equal(source.includes("postgres"), false, `${file} imports the database client`);
    }
  });

  it("50. no dashboard source references migrations 0013/0014 or reissue enums", () => {
    for (const file of [...PAGE_FILES, ...MODEL_FILES, ...AUTH_ROUTES, FLOW_FILE]) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("0013"), false, `${file} references migration 0013`);
      assert.equal(source.includes("0014"), false, `${file} references migration 0014`);
      assert.equal(source.includes("ALTER TYPE"), false, `${file} embeds DDL`);
    }
  });

  it("8. the auth routes never render markup, log tokens, or keep cookies", () => {
    for (const file of AUTH_ROUTES) {
      const source = readFileSync(file, "utf8");
      // The only permitted console output is the safe boolean diagnostic
      // tag; anything else (tokens, cookies, raw errors) is forbidden.
      const otherLogs = source
        .split("\n")
        .filter((line) => line.includes("console.") && !line.includes("console.log(`dashboard_auth_link_debug"));
      assert.equal(otherLogs.length, 0, `${file} logs outside the diagnostic tag`);
      assert.equal(source.includes("console.error"), false, `${file} logs errors`);
      if (file.endsWith("telegram-link/route.ts")) {
        assert.match(source, /console\.log\(`dashboard_auth_link_debug/, `${file} misses the auth diagnostic tag`);
      }
      assert.equal(/<[a-zA-Z]/.test(source.replace(/Promise</g, "")), false, `${file} renders markup`);
      assert.equal(source.includes("workspaceId"), false, `${file} leaks workspace ids`);
      assert.equal(source.includes("telegramUserId"), false, `${file} leaks telegram ids`);
    }
    const logout = readFileSync("src/app/auth/logout/route.ts", "utf8");
    assert.match(logout, /buildDashboardSessionClearAttributes/, "logout must use the shared clear-cookie attributes");
    const sessionSeam = readFileSync("src/server/dashboard/session.ts", "utf8");
    assert.match(sessionSeam, /maxAge: 0/, "the clear-cookie helper must expire the session cookie");
    assert.match(sessionSeam, /sameSite: "lax"/, "clear attributes must mirror the issued Lax cookie");
  });

  it("9-11, 14. the Telegram /dashboard flow is identity-only and only logs safe booleans", () => {
    const flow = readFileSync("src/server/telegram/flows/dashboard-flow.ts", "utf8");
    const otherLogs = flow
      .split("\n")
      .filter((line) => line.includes("console.") && !line.includes("console.log(`dashboard_login_link_debug"));
    assert.equal(otherLogs.length, 0, "flow logs outside the diagnostic tag");
    assert.match(flow, /console\.log\(`dashboard_login_link_debug/, "flow misses the login-link diagnostic tag");
    for (const word of ["execution", "keeperhub", "approve", "payout", "payment"]) {
      assert.equal(flow.includes(word), false, `flow references ${word}`);
    }
    // The raw token only ever leaves as a one-time link.
    assert.equal(flow.includes("rawToken"), false, "flow persists raw tokens");
  });

  it("46. unavailable/not-found panels accept no props and carry no sensitive fields", () => {
    const panels = readFileSync("src/components/DashboardPanels.tsx", "utf8");
    assert.match(panels, /function DashboardUnavailable\(\)/, "unavailable takes no props");
    assert.match(panels, /function DashboardNotFound\(\)/, "not-found takes no props");
    for (const field of ["workspaceId", "claimId", "payoutId", "memberId", "runId", "telegramUserId"]) {
      assert.equal(panels.includes(field), false, `panel references ${field}`);
    }
  });

  it("45. every shell nav link resolves to an implemented route directory", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    const hrefs = [...layout.matchAll(/href: "\/app([^"]*)"/g)].map((match) => match[1]);
    assert.ok(hrefs.length >= 10, `expected >=10 nav sections, got ${hrefs.length}`);
    for (const href of hrefs) {
      const dir = `src/app/app${href === "" ? "" : href}`;
      assert.ok(existsSync(dir), `nav links to missing route directory ${dir}`);
    }
  });
});

// ── Behavioral gates ───────────────────────────────────────────────────────

describe("M12.11 dashboard security gate — behavioral", () => {
  it("2-4. every list page model denies nonmember, removed, and inactive contexts", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId);
    await addClaim(repo, workspaceId);
    await addAgentRun(repo, workspaceId);
    for (const builder of LIST_BUILDERS) {
      assert.deepEqual(await builder.build(repo, ctx(null, workspaceId)), { ok: false }, `${builder.name} admitted a nonmember`);
      assert.deepEqual(await builder.build(repo, ctx("owner", workspaceId, "removed")), { ok: false }, `${builder.name} admitted a removed member`);
      assert.deepEqual(await builder.build(repo, ctx("member", workspaceId, "removed")), { ok: false }, `${builder.name} admitted an inactive member`);
    }
  });

  it("5-6. every detail page model denies denied contexts and unknown ids with the generic result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId);
    await addClaim(repo, workspaceId);
    await addAgentRun(repo, workspaceId);
    for (const builder of DETAIL_BUILDERS) {
      assert.deepEqual(await builder.build(repo, ctx(null, workspaceId), "does-not-exist"), { ok: false }, `${builder.name} admitted a nonmember`);
      assert.deepEqual(await builder.build(repo, ctx("owner", workspaceId, "removed"), "does-not-exist"), { ok: false }, `${builder.name} admitted a removed member`);
      assert.deepEqual(await builder.build(repo, ctx("owner", workspaceId), "does-not-exist"), { ok: false }, `${builder.name} returned a non-generic unknown-id result`);
    }
  });

  it("5. cross-workspace rows never appear in any list", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await addPayout(repo, otherWorkspaceId);
    await addClaim(repo, otherWorkspaceId);
    await addAgentRun(repo, otherWorkspaceId);
    await repo.addRecipient({ workspaceId: otherWorkspaceId, alias: "foreign", walletAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486", createdBy: MEMBER });
    await repo.appendAuditEvent({
      workspaceId: otherWorkspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });

    for (const builder of LIST_BUILDERS) {
      if (builder.name === "overview" || builder.name === "policies" || builder.name === "members") continue;
      const model = await builder.build(repo, ctx("owner", workspaceId));
      assert.ok(isOkModel(model), `${builder.name} failed for an empty workspace`);
      if (isOkModel(model)) {
        const view = model as { empty?: boolean; items?: unknown[] };
        assert.equal(view.empty, true, `${builder.name} showed foreign rows`);
        assert.equal((view.items ?? []).length, 0, `${builder.name} returned foreign items`);
      }
    }
  });

  it("6. unknown and cross-workspace detail ids collapse to the same generic result", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    const foreign = await addClaim(repo, otherWorkspaceId);
    const foreignRun = await addAgentRun(repo, otherWorkspaceId);
    const foreignPayout = await addPayout(repo, otherWorkspaceId);
    void foreignPayout;

    const unknown = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist");
    const cross = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), foreign.claimId);
    assert.deepEqual(cross, unknown, "claim existence leaks across workspaces");

    const runUnknown = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), "does-not-exist");
    const runCross = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), foreignRun);
    assert.deepEqual(runCross, runUnknown, "run existence leaks across workspaces");
  });

  it("47-48. every ok model is honest-empty or JSON-serializable with no mock rows", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addPayout(repo, workspaceId);
    await addClaim(repo, workspaceId);
    await addAgentRun(repo, workspaceId);
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486", createdBy: MEMBER });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });

    for (const builder of LIST_BUILDERS) {
      const model = await builder.build(repo, ctx("owner", workspaceId));
      assert.ok(isOkModel(model), `${builder.name} did not render for an active owner`);
      if (isOkModel(model)) {
        const roundTrip = JSON.parse(JSON.stringify(model));
        assert.ok(roundTrip.ok === true, `${builder.name} is not JSON-serializable`);
      }
    }
  });

  it("15-17, 29. no serialized dashboard model contains claim token material or forged proof", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { tokenHash, tokenPrefix } = await addClaim(repo, workspaceId, { status: "claimed" });
    const { payoutId, itemId } = await addPayout(repo, workspaceId, { status: "completed" });
    const runId = await addAgentRun(repo, workspaceId, { withJson: true });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_claimed",
      actorType: "web",
      actorId: null,
      metadata: { tokenPrefix, tokenHash },
    });
    await repo.setPayoutItemKeeperHubExecution(itemId, "kh-exec-gate-1");

    const models = [
      await buildOverviewPageModel(repo, ctx("owner", workspaceId)),
      await buildPayoutListPageModel(repo, ctx("owner", workspaceId)),
      await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), payoutId),
      await buildClaimListPageModel(repo, ctx("owner", workspaceId)),
      await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), (await addClaim(repo, workspaceId)).claimId),
      await buildAgentRunListPageModel(repo, ctx("owner", workspaceId)),
      await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), runId),
      await buildAuditPageModel(repo, ctx("owner", workspaceId)),
      await buildApprovalsPageModel(repo, ctx("owner", workspaceId)),
    ];
    for (const model of models) {
      const serialized = JSON.stringify(model);
      assert.ok(!serialized.includes(tokenHash), "token hash leaked into a dashboard model");
      assert.ok(!serialized.includes(tokenPrefix), "token prefix leaked into a dashboard model");
      assert.ok(!serialized.includes("kh-exec-gate-1"), "KeeperHub execution id leaked into a dashboard model");
      assert.ok(!serialized.includes("keeperhub_execution_id"));
      assert.ok(!serialized.includes("candidates_json"));
      assert.ok(!serialized.includes("interpretation_json"));
      assert.ok(!serialized.includes("decision_json"));
    }
  });

  it("20-22. completed proof appears only from a pipeline tx hash; approved never says paid", async () => {
    const { repo, workspaceId } = await makeFixture();

    // Completed payout WITH a hash: proof present.
    const withHash = await addPayout(repo, workspaceId, { status: "completed" });
    await withHashItem(repo, withHash.payoutId);
    const detail = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), withHash.payoutId);
    assert.ok(isOkModel(detail));
    if (isOkModel(detail)) {
      const d = detail as { detail: { items: { state: string; txHash: string | null }[] } };
      assert.equal(d.detail.items[0].state, "completed");
      assert.equal(d.detail.items[0].txHash, TX_HASH);
    }

    // Completed payout WITHOUT a hash: no proof, no invented hash.
    const noHash = await addPayout(repo, workspaceId, { status: "completed" });
    const plain = await buildPayoutDetailPageModel(repo, ctx("owner", workspaceId), noHash.payoutId);
    assert.ok(isOkModel(plain));
    if (isOkModel(plain)) {
      const p = plain as { detail: { items: { txHash: string | null }[] } };
      assert.equal(p.detail.items[0].txHash, null, "completed-without-hash invented proof");
    }

    // Approved payout: state label never reads as paid.
    assert.equal(payoutStateLabel("approved"), "Approved");
    assert.equal(claimStatusLabel("approved"), "Approved / Payment prepared");
    assert.equal(claimProofLabel("approved", false), "Payment prepared");
  });

  it("23-26. wallet-entry/agent-runs/audit never produce payment truth", async () => {
    const { repo, workspaceId } = await makeFixture();
    const claimed = await addClaim(repo, workspaceId, { status: "claimed" });
    const detail = await buildClaimDetailPageModel(repo, ctx("owner", workspaceId), claimed.claimId);
    assert.ok(isOkModel(detail));
    if (isOkModel(detail)) {
      const d = detail as { statusLabel: string; detail: { statusView: { txHash: string | null; safetyNote: string } } };
      assert.equal(d.statusLabel, "Claimed, waiting approval");
      assert.equal(d.detail.statusView.txHash, null, "claimed claim shows proof");
      assert.match(d.detail.statusView.safetyNote, /moved no funds|no funds/i);
    }

    const run = await addAgentRun(repo, workspaceId, { withJson: true });
    const runModel = await buildAgentRunDetailPageModel(repo, ctx("owner", workspaceId), run);
    assert.ok(isOkModel(runModel));
    if (isOkModel(runModel)) {
      const serialized = JSON.stringify(runModel);
      assert.ok(!serialized.includes("txHash"), "agent runs carry tx truth");
      assert.ok(!serialized.includes("completed\""), "agent runs claim completion");
      assert.ok(!serialized.includes("0x"), "agent runs carry hashes");
    }

    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_created",
      actorType: "member",
      actorId: MEMBER,
      metadata: { transactionHash: "0xdeadbeef" },
    });
    const audit = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.ok(isOkModel(audit));
    if (isOkModel(audit)) {
      assert.ok(!JSON.stringify(audit).includes("0xdeadbeef"), "audit rows carry transaction proof");
    }
  });

  it("27-28. prepared and completed labels stay truthful", async () => {
    assert.equal(payoutStateLabel("pending_approval"), "Awaiting approval");
    assert.equal(payoutStateLabel("completed"), "Completed");
    assert.equal(claimStatusLabel("pending"), "Pending / Unclaimed");
    assert.equal(claimStatusLabel("completed"), "Completed");
    assert.equal(claimProofLabel("completed", false), "Completed without visible proof");
    assert.equal(claimProofLabel("completed", true), "Completed with proof");
  });

  it("49. lists sort deterministically (newest first) across claim/audit/run models", async () => {
    const { repo, workspaceId } = await makeFixture();
    await addClaim(repo, workspaceId, { expiresAt: "2099-01-01T00:00:00.000Z" });
    await addClaim(repo, workspaceId, { status: "claimed" });
    await addAgentRun(repo, workspaceId, { rawText: "a [REDACTED]" });
    await addAgentRun(repo, workspaceId, { rawText: "b [REDACTED]" });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });
    await repo.appendAuditEvent({
      workspaceId,
      payoutId: null,
      payoutItemId: null,
      eventType: "member_added",
      actorType: "workspace_owner",
      actorId: OWNER,
      metadata: {},
    });

    const claims = await buildClaimListPageModel(repo, ctx("owner", workspaceId));
    assert.ok(isOkModel(claims));
    if (isOkModel(claims)) {
      const items = (claims as { items: { view: { createdAt: string; claimId: string } }[] }).items;
      for (let i = 1; i < items.length; i += 1) {
        assert.ok(compareKeys(items[i - 1].view.createdAt, items[i - 1].view.claimId, items[i].view.createdAt, items[i].view.claimId) >= 0);
      }
    }

    const runs = await buildAgentRunListPageModel(repo, ctx("owner", workspaceId));
    assert.ok(isOkModel(runs));
    if (isOkModel(runs)) {
      const items = (runs as { items: { view: { createdAt: string; runId: string } }[] }).items;
      for (let i = 1; i < items.length; i += 1) {
        assert.ok(compareKeys(items[i - 1].view.createdAt, items[i - 1].view.runId, items[i].view.createdAt, items[i].view.runId) >= 0);
      }
    }

    const audit = await buildAuditPageModel(repo, ctx("owner", workspaceId));
    assert.ok(isOkModel(audit));
    if (isOkModel(audit)) {
      const items = (audit as { items: { view: { createdAt: string; eventId: string } }[] }).items;
      for (let i = 1; i < items.length; i += 1) {
        assert.ok(compareKeys(items[i - 1].view.createdAt, items[i - 1].view.eventId, items[i].view.createdAt, items[i].view.eventId) >= 0);
      }
    }
  });

  it("10-11, 13. expired/one-time/hash-only login tokens remain enforced", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const link = await createDashboardLoginLink({
      repo,
      workspaceId,
      telegramUserId: OWNER,
      memberId: "member-row",
      role: "owner",
      nowIso: NOW,
      appUrl: "https://solvo.example",
    });
    assert.equal(link.ok, true);
    if (!link.ok) return;
    const stored = [...repo.dashboardLoginTokens.values()][0];
    assert.equal(stored.token_hash, hashDashboardLoginToken(link.token));
    assert.ok(!JSON.stringify(stored).includes(link.token), "raw login token persisted");
    const afterExpiry = new Date(new Date(NOW).getTime() + 11 * 60 * 1000).toISOString();
    assert.deepEqual(await verifyDashboardLoginToken(repo, link.token, afterExpiry), { ok: false, kind: "expired" });
  });
});

/** Complete a payout item with a pipeline tx hash. */
async function withHashItem(repo: Awaited<ReturnType<typeof makeFixture>>["repo"], payoutId: string) {
  const items = await repo.getPayoutItemsByPayoutId(payoutId);
  const item = items[0];
  await repo.completePayoutItem(item.id, TX_HASH, BASE_SCAN);
  return { itemId: item.id };
}

/** (created_at, id) descending comparison — the repository's sort contract. */
function compareKeys(aCreated: string, aId: string, bCreated: string, bId: string): number {
  const aKey = `${aCreated}\u0000${aId}`;
  const bKey = `${bCreated}\u0000${bId}`;
  return aKey.localeCompare(bKey);
}
