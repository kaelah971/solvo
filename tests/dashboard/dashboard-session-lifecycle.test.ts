import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildApprovalsPageModel } from "../../src/server/dashboard/approvals-page.ts";
import {
  buildAgentRunListPageModel,
  buildAuditPageModel,
} from "../../src/server/dashboard/observability-page.ts";
import { buildClaimListPageModel } from "../../src/server/dashboard/claims-page.ts";
import { buildMembersPageModel, buildRecipientsPageModel } from "../../src/server/dashboard/directory-page.ts";
import {
  createDashboardLoginLink,
  issueDashboardSessionFromLoginToken,
  verifyDashboardLoginToken,
} from "../../src/server/dashboard/login-links.ts";
import { buildOverviewPageModel } from "../../src/server/dashboard/overview-page.ts";
import {
  buildBatchListPageModel,
  buildPayoutListPageModel,
} from "../../src/server/dashboard/payouts-page.ts";
import { buildPolicyPageModel } from "../../src/server/dashboard/policies-page.ts";
import {
  buildDashboardSessionClearAttributes,
  DASHBOARD_SESSION_COOKIE,
  parseDashboardSessionCookie,
  requireDashboardContext,
  type DashboardSession,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleDashboardInstruction } from "../../src/server/telegram/flows/dashboard-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

const SECRET = "test-secret";
const APP_URL = "https://solvo-beryl.vercel.app";
const FIVE_MIN = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();
const CHAT = "-100777";

function groupUser(userId: string): TelegramUser {
  return { userId, chatId: CHAT, chatType: "supergroup", messageId: 1, updateId: 1 };
}

function tokenFromLink(link: string): string {
  const match = /token=([^&]+)$/.exec(link);
  assert.ok(match, "link must carry the launch token");
  return match[1];
}

/** Reproduce a real Telegram /dashboard launch: the bot issues the link. */
async function launch(repo: MemoryRepository): Promise<{ rawToken: string; workspaceId: string }> {
  const workspaceId = await makeWorkspace(repo);
  const reply = await handleDashboardInstruction(
    { user: groupUser(OWNER) },
    { repo, now: () => new Date(NOW), appUrl: APP_URL },
  );
  assert.equal(reply.outcome, "link_issued");
  assert.ok(reply.buttonUrl !== null);
  return { rawToken: tokenFromLink(reply.buttonUrl), workspaceId };
}

/** Exchange the one-time launch token for the durable session (the auth route). */
async function bootstrap(repo: MemoryRepository, rawToken: string): Promise<DashboardSession> {
  const result = await issueDashboardSessionFromLoginToken({
    repo,
    rawToken,
    nowIso: FIVE_MIN,
    secret: SECRET,
    secureCookie: true,
  });
  assert.equal(result.kind, "redirect");
  if (result.kind !== "redirect") throw new Error("bootstrap failed");
  const session = parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=${result.cookie.value}`, SECRET);
  assert.ok(session !== null, "issued cookie must parse back to a session");
  return session;
}

type SectionLoader = {
  page: string;
  load: (repo: MemoryRepository, session: DashboardSession) => Promise<{ ok: boolean }>;
};

const SECTION_LOADERS: SectionLoader[] = [
  { page: "overview", load: async (r, s) => gateThen(r, s, "overview", buildOverviewPageModel) },
  { page: "approvals", load: async (r, s) => gateThen(r, s, "approvals", buildApprovalsPageModel) },
  { page: "payouts", load: async (r, s) => gateThen(r, s, "payouts", buildPayoutListPageModel) },
  { page: "batches", load: async (r, s) => gateThen(r, s, "batches", buildBatchListPageModel) },
  { page: "claims", load: async (r, s) => gateThen(r, s, "claims", buildClaimListPageModel) },
  { page: "recipients", load: async (r, s) => gateThen(r, s, "recipients", buildRecipientsPageModel) },
  { page: "members", load: async (r, s) => gateThen(r, s, "members", buildMembersPageModel) },
  { page: "policies", load: async (r, s) => gateThen(r, s, "policies", buildPolicyPageModel) },
  { page: "agent-runs", load: async (r, s) => gateThen(r, s, "agent-runs", buildAgentRunListPageModel) },
  { page: "audit", load: async (r, s) => gateThen(r, s, "audit", buildAuditPageModel) },
];

async function gateThen(
  repo: MemoryRepository,
  session: DashboardSession,
  pageName: string,
  build: (repo: MemoryRepository, ctx: Parameters<typeof buildOverviewPageModel>[1]) => Promise<{ ok: boolean }>,
): Promise<{ ok: boolean }> {
  const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName });
  if (!required.ok) return { ok: false };
  return build(repo, required.ctx);
}

function deniedCtx(workspaceId: string): Parameters<typeof buildOverviewPageModel>[1] {
  return {
    workspaceId,
    telegramUserId: OUTSIDER,
    memberId: null,
    role: null,
    status: null,
    mode: null,
    nowIso: FIVE_MIN,
  };
}

describe("dashboard session lifecycle — P0 (Batches must never invalidate the session)", () => {
  it("1. a valid launch establishes a durable session; the launch token stays single-use", async () => {
    const repo = new MemoryRepository();
    const { rawToken } = await launch(repo);

    const result = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(result.kind, "redirect");
    if (result.kind !== "redirect") return;
    assert.equal(result.cookie.name, DASHBOARD_SESSION_COOKIE);
    assert.equal(result.cookie.attributes.httpOnly, true);
    assert.equal(result.cookie.attributes.sameSite, "lax");
    assert.equal(result.cookie.attributes.secure, true);
    assert.equal(result.cookie.attributes.path, "/");
    assert.equal(result.cookie.attributes.maxAge, 7 * 24 * 60 * 60);
    assert.ok(!result.cookie.value.includes(rawToken), "raw launch token must never live in the session cookie");

    // The launch credential is single-use: a second exchange fails.
    assert.deepEqual(await verifyDashboardLoginToken(repo, rawToken, FIVE_MIN), { ok: false, kind: "used" });
    const again = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(again, { kind: "unavailable" });
  });

  it("2. invalid/expired launches fail closed", async () => {
    const repo = new MemoryRepository();
    await launch(repo);

    // Expired launch: token created 11 minutes before the exchange.
    const otherWorkspace = await makeWorkspace(repo);
    const expiredLink = await createDashboardLoginLink({
      repo,
      workspaceId: otherWorkspace,
      telegramUserId: OWNER,
      memberId: "member-row",
      role: "owner",
      nowIso: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
      appUrl: APP_URL,
    });
    assert.equal(expiredLink.ok, true);
    if (!expiredLink.ok) return;
    const expired = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: expiredLink.token,
      nowIso: new Date().toISOString(),
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(expired, { kind: "unavailable" });

    const malformed = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: "malformed-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(malformed, { kind: "unavailable" });
  });

  it("3. an unauthenticated direct visit to a protected section is unavailable (never public)", async () => {
    const repo = new MemoryRepository();
    const { workspaceId } = await launch(repo);

    const missing = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN });
    assert.deepEqual(missing, { ok: false });

    for (const loader of SECTION_LOADERS) {
      const denied = await loader.load(repo, { workspaceId: "does-not-exist", telegramUserId: OUTSIDER });
      assert.deepEqual(denied, { ok: false }, `${loader.page} leaked data without a session`);
    }
  });

  it("P0 CRITICAL: launch → Overview ok → Batches ok → Overview still ok, with NO launch token in URLs", async () => {
    const repo = new MemoryRepository();
    const { rawToken } = await launch(repo);
    const session = await bootstrap(repo, rawToken);

    // The launch credential is fully consumed; subsequent section loads use
    // ONLY the durable session cookie — no token, no query string.
    assert.deepEqual(await verifyDashboardLoginToken(repo, rawToken, FIVE_MIN), { ok: false, kind: "used" });

    // 1. Overview works.
    assert.equal((await gateThen(repo, session, "overview", buildOverviewPageModel)).ok, true, "overview authorized");
    // 2. Batches — must NOT invalidate anything.
    assert.equal((await gateThen(repo, session, "batches", buildBatchListPageModel)).ok, true, "batches authorized");
    // 3. Overview again — must STILL work with the SAME session object.
    assert.equal((await gateThen(repo, session, "overview", buildOverviewPageModel)).ok, true, "overview still authorized after Batches");

    // The session was never rotated, rewritten, or consumed.
    const still = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName: "overview" });
    assert.equal(still.ok, true, "session remains valid after Batches");
  });

  it("P0: every protected section resolves with the same established session (incl. refresh)", async () => {
    const repo = new MemoryRepository();
    const { rawToken } = await launch(repo);
    const session = await bootstrap(repo, rawToken);

    for (const loader of SECTION_LOADERS) {
      const model = await loader.load(repo, session);
      assert.equal(model.ok, true, `${loader.page} must resolve with the established session`);
    }

    // Refresh/persistence: re-request Batches and Overview directly with the
    // same session — still authorized.
    assert.equal((await gateThen(repo, session, "batches", buildBatchListPageModel)).ok, true, "batches refresh authorized");
    assert.equal((await gateThen(repo, session, "overview", buildOverviewPageModel)).ok, true, "overview refresh authorized");
  });

  it("sign out clears the EXACT cookie attributes the auth route issued, then everything is denied", async () => {
    const repo = new MemoryRepository();
    await launch(repo);

    const { rawToken: fresh } = await launch(repo);
    const issued = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: fresh,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(issued.kind, "redirect");
    if (issued.kind !== "redirect") return;
    assertClearMatches(issued.cookie.attributes);

    // After sign-out (no session), every section is denied.
    const gate = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN, pageName: "batches" });
    assert.deepEqual(gate, { ok: false });
    for (const loader of SECTION_LOADERS) {
      const denied = await loader.load(repo, { workspaceId: "x", telegramUserId: OUTSIDER });
      assert.deepEqual(denied, { ok: false }, `${loader.page} authorized after sign-out`);
    }
  });

  it("security: query params cannot impersonate; no raw token as a session; no secrets logged", async () => {
    const repo = new MemoryRepository();
    const { rawToken } = await launch(repo);
    const session = await bootstrap(repo, rawToken);

    // A forged session payload for another workspace/user cannot impersonate —
    // membership is re-checked from the repository.
    const forged = await requireDashboardContext({
      repo,
      session: { workspaceId: "foreign-workspace", telegramUserId: OUTSIDER },
      nowIso: FIVE_MIN,
      pageName: "overview",
    });
    assert.deepEqual(forged, { ok: false });

    // The session payload never contains the raw launch token.
    assert.ok(!JSON.stringify(session).includes(rawToken));

    // No dashboard page trusts query parameters (identity is cookie-only).
    for (const file of [
      "src/app/app/page.tsx",
      "src/app/app/batches/page.tsx",
      "src/app/app/approvals/page.tsx",
      "src/app/app/payouts/page.tsx",
      "src/app/app/audit/page.tsx",
      "src/app/app/members/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("searchParams"), false, `${file} reads query params`);
    }

    // The session diagnostic logs booleans/role/page only — never ids/cookies.
    const sessionSource = readFileSync("src/server/dashboard/session.ts", "utf8");
    const logLine = sessionSource.split("\n").find((line) => line.includes("dashboard_session_debug"));
    assert.ok(logLine !== undefined);
    for (const forbidden of ["workspaceId:", "telegramUserId:", "cookieValue", "cookie.value", "rawToken"]) {
      assert.equal(logLine.includes(forbidden), false, `session log line leaks ${forbidden}`);
    }

    // Uncaught section errors render the uniform unavailable panel — a data
    // failure can never mislabel auth state.
    const errorBoundary = readFileSync("src/app/app/error.tsx", "utf8");
    assert.match(errorBoundary, /"use client"/);
    assert.match(errorBoundary, /WORKSPACE DASHBOARD UNAVAILABLE/);
  });
});

function assertClearMatches(issued: { httpOnly: boolean; secure: boolean; sameSite: string; path: string }): void {
  const clear = buildDashboardSessionClearAttributes({ secureCookie: issued.secure });
  assert.equal(clear.sameSite, issued.sameSite, "SameSite must match the issued cookie");
  assert.equal(clear.httpOnly, issued.httpOnly);
  assert.equal(clear.secure, issued.secure);
  assert.equal(clear.path, issued.path);
  assert.equal(clear.maxAge, 0);
}
