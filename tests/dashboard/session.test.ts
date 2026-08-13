import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDashboardSessionCookieValue,
  DASHBOARD_SESSION_COOKIE,
  getDashboardSessionFromHeaders,
  parseDashboardSessionCookie,
  requireDashboardContext,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

function cookieHeaderFor(session: { workspaceId: string; telegramUserId: string }): string {
  return `${DASHBOARD_SESSION_COOKIE}=${buildDashboardSessionCookieValue(session)}`;
}

describe("dashboard session seam", () => {
  it("parses a valid session cookie", () => {
    const session = parseDashboardSessionCookie(cookieHeaderFor({ workspaceId: "ws-1", telegramUserId: "123456789" }));
    assert.deepEqual(session, { workspaceId: "ws-1", telegramUserId: "123456789" });
  });

  it("parses the session among other cookies", () => {
    const header = `other=x; ${DASHBOARD_SESSION_COOKIE}=${buildDashboardSessionCookieValue({ workspaceId: "ws-1", telegramUserId: "123456789" })}; next=1`;
    assert.deepEqual(parseDashboardSessionCookie(header), { workspaceId: "ws-1", telegramUserId: "123456789" });
  });

  it("returns null for missing, malformed, and empty session cookies", () => {
    assert.equal(parseDashboardSessionCookie(null), null);
    assert.equal(parseDashboardSessionCookie(undefined), null);
    assert.equal(parseDashboardSessionCookie(""), null);
    assert.equal(parseDashboardSessionCookie("other=1"), null);
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=not-json`), null);
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=%7B%7D`), null); // {}
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=%5B1%2C2%5D`), null); // [1,2]
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=%22x%22`), null); // "x"
    assert.equal(parseDashboardSessionCookie(`${DASHBOARD_SESSION_COOKIE}=%7B%22workspaceId%22%3A%22ws-1%22%7D`), null); // missing userId
  });

  it("reads the session from a Headers object", () => {
    const headers = new Headers({ cookie: cookieHeaderFor({ workspaceId: "ws-1", telegramUserId: "123456789" }) });
    assert.deepEqual(getDashboardSessionFromHeaders(headers), { workspaceId: "ws-1", telegramUserId: "123456789" });
    assert.equal(getDashboardSessionFromHeaders(new Headers()), null);
  });

  it("does not trust query parameters (no search-param parsing exists in the seam)", () => {
    // The session contract is cookie-only; a URL with params must never
    // create a session. Parsing a cookie header shaped like a query string
    // yields null.
    const session = parseDashboardSessionCookie("workspaceId=ws-1&telegramUserId=123456789");
    assert.equal(session, null);
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

    // Removal is picked up on the next request.
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
