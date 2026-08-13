import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  exchangeLoginTokenForSession,
  getDashboardAuthRouteOverrides,
  setDashboardAuthRouteOverrides,
} from "../../src/server/dashboard/auth-exchange.ts";
import {
  createDashboardLoginLink,
  verifyDashboardLoginToken,
} from "../../src/server/dashboard/login-links.ts";
import {
  buildDashboardSessionCookieValue,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  parseDashboardSessionCookie,
  requireDashboardContext,
  verifyDashboardSessionValue,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleDashboardInstruction } from "../../src/server/telegram/flows/dashboard-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

const SECRET = "test-secret";
const APP_URL = "https://solvo-beryl.vercel.app";
const FIVE_MIN = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();

const CHAT = "-100777"; // must match the makeWorkspace fixture chat id

function groupUser(userId: string): TelegramUser {
  return { userId, chatId: CHAT, chatType: "supergroup", messageId: 1, updateId: 1 };
}

function tokenFromButtonUrl(buttonUrl: string): string {
  const match = /token=([^&]+)$/.exec(buttonUrl);
  assert.ok(match, "button URL must carry the one-time token");
  return match[1];
}

/** Issue a token via the real /dashboard flow (deterministic flow clock). */
async function issueLinkViaFlow(repo: MemoryRepository): Promise<{ rawToken: string; buttonUrl: string }> {
  await makeWorkspace(repo);
  const reply = await handleDashboardInstruction(
    { user: groupUser(OWNER) },
    { repo, now: () => new Date(NOW), appUrl: APP_URL },
  );
  assert.equal(reply.outcome, "link_issued");
  assert.ok(reply.buttonUrl !== null);
  return { rawToken: tokenFromButtonUrl(reply.buttonUrl), buttonUrl: reply.buttonUrl };
}

/** Issue a token against the REAL wall clock (route/exchange-level tests). */
async function issueToken(repo: MemoryRepository, nowIso: string): Promise<{ rawToken: string; workspaceId: string }> {
  const workspaceId = await makeWorkspace(repo);
  const created = await createDashboardLoginLink({
    repo,
    workspaceId,
    telegramUserId: OWNER,
    memberId: "member-row",
    role: "owner",
    nowIso,
    appUrl: APP_URL,
  });
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error("token creation failed");
  return { rawToken: created.token, workspaceId };
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

describe("dashboard login flow — production parity", () => {
  it("0. the auth-route override seam round-trips and resets to null", () => {
    setDashboardAuthRouteOverrides({ secret: "s" });
    assert.equal(getDashboardAuthRouteOverrides()?.secret, "s");
    setDashboardAuthRouteOverrides(null);
    assert.equal(getDashboardAuthRouteOverrides(), null);
  });

  it("1. /dashboard flow creates a token row and sends a button with the production app URL", async () => {
    const repo = new MemoryRepository();
    const { buttonUrl, rawToken } = await issueLinkViaFlow(repo);

    assert.ok(buttonUrl.startsWith(`${APP_URL}/auth/telegram-link?token=`));
    assert.equal(repo.dashboardLoginTokens.size, 1, "exactly one token row");
    const stored = [...repo.dashboardLoginTokens.values()][0];
    assert.ok(!stored.token_hash.includes(rawToken), "raw token persisted");
    assert.equal(stored.telegram_user_id, OWNER);
  });

  it("2. auth exchange with a valid token produces the signed HttpOnly Lax Secure cookie and /app redirect", async () => {
    const repo = new MemoryRepository();
    const { rawToken, workspaceId } = await issueToken(repo, new Date().toISOString());

    const result = await exchangeLoginTokenForSession({
      repo,
      rawToken,
      nowIso: new Date().toISOString(),
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(result.kind, "redirect");
    if (result.kind !== "redirect") return;
    assert.equal(result.redirectTo, "/app");

    // This cookie object is exactly what the route sets via Set-Cookie.
    assert.equal(result.cookie.name, DASHBOARD_SESSION_COOKIE);
    assert.equal(result.cookie.attributes.httpOnly, true);
    assert.equal(result.cookie.attributes.sameSite, "lax");
    assert.equal(result.cookie.attributes.secure, true);
    assert.equal(result.cookie.attributes.path, "/");
    assert.equal(result.cookie.attributes.maxAge, DASHBOARD_SESSION_MAX_AGE_SECONDS);
    assert.equal(result.cookie.value.split(".").length, 2, "signed payload.signature value");

    // The cookie parses back to the verified session.
    assert.deepEqual(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=${result.cookie.value}`, SECRET), {
      workspaceId,
      telegramUserId: OWNER,
    });

    // The token is consumed exactly once.
    assert.deepEqual(await verifyDashboardLoginToken(repo, rawToken, FIVE_MIN), { ok: false, kind: "used" });
  });

  it("2b. the route wraps the exchange with Set-Cookie + redirect to /app", () => {
    const route = readFileSync("src/app/auth/telegram-link/route.ts", "utf8");
    assert.match(route, /NextResponse\.redirect\(new URL\(result\.redirectTo, request\.nextUrl\)\)/);
    assert.match(route, /response\.cookies\.set\(result\.cookie\.name, result\.cookie\.value, result\.cookie\.attributes\)/);
    assert.match(route, /unavailableRedirect\(request\)/);
    assert.match(route, /export const dynamic = "force-dynamic"/);
  });

  it("3. /app gate accepts the issued cookie for an active member and resolves the context", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const cookieValue = buildDashboardSessionCookieValue({ workspaceId, telegramUserId: OWNER }, SECRET);
    const session = parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=${cookieValue}`, SECRET);
    assert.deepEqual(session, { workspaceId, telegramUserId: OWNER });
    const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.equal(required.ok, true);
    if (required.ok) assert.equal(required.ctx.role, "owner");
  });

  it("4. every /app page and the auth route are dynamic (cookie-dependent gate per request)", () => {
    const files = [
      "src/app/app/page.tsx",
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
      "src/app/auth/telegram-link/route.ts",
    ];
    for (const file of files) {
      assert.ok(existsSync(file), `${file} missing`);
      assert.match(readFileSync(file, "utf8"), /export const dynamic = "force-dynamic"/, `${file} is not dynamic`);
    }
  });

  it("5-7. invalid, expired, and used tokens return unavailable with no cookie and a diagnostic errorCode", async () => {
    const repo = new MemoryRepository();
    const expired = await issueToken(repo, new Date(Date.now() - 11 * 60 * 1000).toISOString());
    const used = await issueToken(repo, new Date().toISOString());
    const usedVerdict = await verifyDashboardLoginToken(repo, used.rawToken, new Date().toISOString());
    assert.equal(usedVerdict.ok, true);
    if (usedVerdict.ok) {
      await repo.consumeDashboardLoginToken(usedVerdict.record.token_hash, new Date().toISOString());
    }

    const cases = [
      { name: "invalid", token: "malformed-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", expected: "unknown" },
      { name: "expired", token: expired.rawToken, expected: "expired" },
      { name: "used", token: used.rawToken, expected: "used" },
    ];
    for (const testCase of cases) {
      const result = await exchangeLoginTokenForSession({
        repo,
        rawToken: testCase.token,
        nowIso: new Date().toISOString(),
        secret: SECRET,
        secureCookie: true,
      });
      assert.equal(result.kind, "unavailable", `${testCase.name}: must be unavailable`);
      if (result.kind === "unavailable") {
        assert.equal(result.errorCode, testCase.expected, `${testCase.name}: diagnostic error code`);
      }
    }
  });

  it("8. a tampered cookie is rejected by the /app gate", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const value = buildDashboardSessionCookieValue({ workspaceId, telegramUserId: OWNER }, SECRET);
    const tamperedPayload = Buffer.from(JSON.stringify({ workspaceId, telegramUserId: OUTSIDER })).toString("base64url");
    const tampered = `${tamperedPayload}.${value.slice(value.lastIndexOf(".") + 1)}`;

    assert.equal(verifyDashboardSessionValue(tampered, SECRET), null);
    const session = parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=${tampered}`, SECRET);
    const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.deepEqual(required, { ok: false });
  });

  it("9. a missing cookie shows the generic unavailable gate", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const required = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN });
    assert.deepEqual(required, { ok: false });
  });

  it("10. a removed/inactive member with a valid token never gets a session and the token stays unused", async () => {
    const repo = new MemoryRepository();
    const { rawToken, workspaceId } = await issueToken(repo, new Date().toISOString());
    await repo.removeWorkspaceMember(workspaceId, OWNER);

    const result = await exchangeLoginTokenForSession({
      repo,
      rawToken,
      nowIso: new Date().toISOString(),
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(result.kind, "unavailable", "removed member must get no session");
    if (result.kind === "unavailable") assert.equal(result.errorCode, "membership_denied");
    assert.equal((await verifyDashboardLoginToken(repo, rawToken, new Date().toISOString())).ok, true, "token not consumed");
  });

  it("11. string Telegram user ids round-trip and numeric-shaped payloads are rejected", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);

    // String id matches the member row.
    const cookieValue = buildDashboardSessionCookieValue({ workspaceId, telegramUserId: OWNER }, SECRET);
    const session = parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=${cookieValue}`, SECRET);
    assert.equal(typeof session?.telegramUserId, "string");
    const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.equal(required.ok, true, "string id must resolve the member row");

    // A numeric payload (number, not string) must be rejected outright.
    const numericPayload = Buffer.from(JSON.stringify({ workspaceId, telegramUserId: 111222333 })).toString("base64url");
    const numeric = `${numericPayload}.${sign(numericPayload, SECRET)}`;
    assert.equal(verifyDashboardSessionValue(numeric, SECRET), null, "numeric user id must never be accepted");
  });

  it("12-13. raw tokens are never redisplayed and unavailable results carry no token material", async () => {
    const repo = new MemoryRepository();
    const { rawToken } = await issueToken(repo, new Date().toISOString());
    const result = await exchangeLoginTokenForSession({
      repo,
      rawToken,
      nowIso: new Date().toISOString(),
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(result.kind, "redirect");
    if (result.kind === "redirect") {
      assert.ok(!result.cookie.value.includes(rawToken), "cookie echoes the login token");
      assert.ok(!JSON.stringify(result).includes(OWNER), "user id leaked into the result");
    }

    const invalid = await exchangeLoginTokenForSession({
      repo,
      rawToken: "malformed-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      nowIso: new Date().toISOString(),
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(invalid.kind, "unavailable");
    if (invalid.kind === "unavailable") {
      assert.ok(!invalid.errorCode.includes("malformed"), "rejected token material in the error code");
    }
  });
});
