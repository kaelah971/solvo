import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDashboardSessionCookie,
  buildDashboardSessionCookieValue,
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  getDashboardCookieSecret,
  getDashboardSessionFromHeaders,
  parseDashboardSessionCookie,
  requireDashboardContext,
  verifyDashboardSessionValue,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

const SECRET = "test-secret";

function cookieHeaderFor(session: { workspaceId: string; telegramUserId: string }, secret: string = SECRET): string {
  return `${DASHBOARD_SESSION_COOKIE}=${buildDashboardSessionCookieValue(session, secret)}`;
}

describe("dashboard session seam", () => {
  it("parses a valid signed session cookie", () => {
    const session = parseDashboardSessionCookie(
      cookieHeaderFor({ workspaceId: "ws-1", telegramUserId: "123456789" }),
      SECRET,
    );
    assert.deepEqual(session, { workspaceId: "ws-1", telegramUserId: "123456789" });
  });

  it("parses the session among other cookies", () => {
    const header = `other=x; ${DASHBOARD_SESSION_COOKIE}=${buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "123456789" }, SECRET)}; next=1`;
    assert.deepEqual(parseDashboardSessionCookie(header, SECRET), { workspaceId: "ws-1", telegramUserId: "123456789" });
  });

  it("rejects unsigned, malformed, empty, and wrong-shape cookies", () => {
    assert.equal(parseDashboardSessionCookie(null, SECRET), null);
    assert.equal(parseDashboardSessionCookie(undefined, SECRET), null);
    assert.equal(parseDashboardSessionCookie("", SECRET), null);
    assert.equal(parseDashboardSessionCookie("other=1", SECRET), null);
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=not-json`, SECRET), null);
    // Legacy M12.3-style unsigned JSON cookie must NOT be accepted.
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=%7B%22workspaceId%22%3A%22ws-1%22%2C%22telegramUserId%22%3A%22123456789%22%7D`, SECRET), null);
    // Signed but wrong payload shape.
    const bad = buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "" }, SECRET);
    assert.equal(verifyDashboardSessionValue(bad, SECRET), null);
  });

  it("rejects tampered cookies (wrong signature / modified payload)", () => {
    const value = buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "123456789" }, SECRET);
    // Modified payload, old signature.
    const tamperedPayload = Buffer.from(JSON.stringify({ workspaceId: "ws-2", telegramUserId: "123456789" })).toString("base64url");
    const tampered = `${tamperedPayload}.${value.slice(value.lastIndexOf(".") + 1)}`;
    assert.equal(verifyDashboardSessionValue(tampered, SECRET), null);
    // Random signature.
    assert.equal(verifyDashboardSessionValue(`${value.slice(0, value.lastIndexOf("."))}.AAAA`, SECRET), null);
    // Signed with a different secret.
    const otherSecret = buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "123456789" }, "other-secret");
    assert.equal(verifyDashboardSessionValue(otherSecret, SECRET), null);
  });

  it("verification refuses when no secret is available (production)", () => {
    const value = buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "123456789" }, SECRET);
    assert.equal(verifyDashboardSessionValue(value, null), null);
    assert.equal(parseDashboardSessionCookie(cookieHeaderFor({ workspaceId: "ws-1", telegramUserId: "123456789" }), null), null);
  });

  it("reads the session from a Headers object", () => {
    const headers = new Headers({ cookie: cookieHeaderFor({ workspaceId: "ws-1", telegramUserId: "123456789" }) });
    assert.deepEqual(getDashboardSessionFromHeaders(headers, SECRET), { workspaceId: "ws-1", telegramUserId: "123456789" });
    assert.equal(getDashboardSessionFromHeaders(new Headers(), SECRET), null);
  });

  it("buildDashboardSessionCookie emits secure attributes", () => {
    const cookie = buildDashboardSessionCookie(
      { workspaceId: "ws-1", telegramUserId: "123456789" },
      { secret: SECRET, secureCookie: true },
    );
    assert.equal(cookie.name, DASHBOARD_SESSION_COOKIE);
    assert.equal(cookie.attributes.httpOnly, true);
    assert.equal(cookie.attributes.sameSite, "strict");
    assert.equal(cookie.attributes.secure, true);
    assert.equal(cookie.attributes.path, "/");
    assert.equal(cookie.attributes.maxAge, DASHBOARD_SESSION_MAX_AGE_SECONDS);
    // The cookie value carries no raw session material outside the signed payload.
    assert.ok(!cookie.value.includes("ws-1"));
  });

  it("does not trust query parameters (no search-param parsing exists in the seam)", () => {
    const session = parseDashboardSessionCookie("workspaceId=ws-1&telegramUserId=123456789", SECRET);
    assert.equal(session, null);
  });

  it("getDashboardCookieSecret requires a configured secret in production", () => {
    const env = (values: Record<string, string | undefined>) => values as NodeJS.ProcessEnv;
    // Production without a configured secret → null (sessions refused).
    assert.equal(getDashboardCookieSecret(env({ NODE_ENV: "production" })), null);
    assert.equal(getDashboardCookieSecret(env({ NODE_ENV: "production", SOLVO_DASHBOARD_COOKIE_SECRET: "" })), null);
    assert.equal(
      getDashboardCookieSecret(env({ NODE_ENV: "production", SOLVO_DASHBOARD_COOKIE_SECRET: "configured-secret" })),
      "configured-secret",
    );
    // Non-production falls back to the dev constant.
    assert.equal(getDashboardCookieSecret(env({ NODE_ENV: "development" })), "solvo-dev-dashboard-cookie-secret-do-not-use-in-production");
    assert.equal(getDashboardCookieSecret(env({ NODE_ENV: "test" })), "solvo-dev-dashboard-cookie-secret-do-not-use-in-production");
  });

  it("requireDashboardContext resolves and gates from repository rows", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);

    const owner = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OWNER },
      nowIso: NOW,
    });
    assert.equal(owner.ok, true);
    if (owner.ok) assert.equal(owner.ctx.role, "owner");

    const outsider = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OUTSIDER },
      nowIso: NOW,
    });
    assert.deepEqual(outsider, { ok: false });

    const noSession = await requireDashboardContext({ repo, session: null, nowIso: NOW });
    assert.deepEqual(noSession, { ok: false });

    // Removal is picked up on the next request — a stale valid session dies.
    await repo.removeWorkspaceMember(workspaceId, OWNER);
    const removed = await requireDashboardContext({
      repo,
      session: { workspaceId, telegramUserId: OWNER },
      nowIso: NOW,
    });
    assert.deepEqual(removed, { ok: false });
  });

  it("requireDashboardContext collapses unknown workspaces to the generic denial", async () => {
    const repo = new MemoryRepository();
    const result = await requireDashboardContext({
      repo,
      session: { workspaceId: "does-not-exist", telegramUserId: OWNER },
      nowIso: NOW,
    });
    assert.deepEqual(result, { ok: false });
  });
});
