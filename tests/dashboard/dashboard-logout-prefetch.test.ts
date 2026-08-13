import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  issueDashboardSessionFromLoginToken,
} from "../../src/server/dashboard/login-links.ts";
import { logoutCookieSet } from "../../src/server/dashboard/logout-flow.ts";
import {
  DASHBOARD_SESSION_COOKIE,
  parseDashboardSessionCookie,
  requireDashboardContext,
  type DashboardSession,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleDashboardInstruction } from "../../src/server/telegram/flows/dashboard-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { makeWorkspace, NOW, OWNER } from "./fixtures.ts";

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

/** Bootstraps a valid durable dashboard session exactly like production. */
async function bootstrapValidSession(repo: MemoryRepository): Promise<DashboardSession> {
  await makeWorkspace(repo);
  const reply = await handleDashboardInstruction(
    { user: groupUser(OWNER) },
    { repo, now: () => new Date(NOW), appUrl: APP_URL },
  );
  assert.equal(reply.outcome, "link_issued");
  assert.ok(reply.buttonUrl !== null);
  const rawToken = tokenFromLink(reply.buttonUrl);

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
  assert.ok(session !== null);
  return session;
}

describe("dashboard logout prefetch safety (P0: no GET may log the user out)", () => {
  it("1. GET /auth/logout is non-destructive (405) and cannot mutate the session", () => {
    const route = readFileSync("src/app/auth/logout/route.ts", "utf8");

    // GET returns an explicit 405 with NO cookie mutation, NO redirect.
    const getHandler = route.split("export function GET")[1] ?? "";
    assert.match(getHandler, /status: 405/, "GET must answer 405 Method Not Allowed");
    assert.equal(getHandler.includes("cookies"), false, "GET handler touches cookies");
    assert.equal(getHandler.includes("logoutCookieSet"), false, "GET handler clears the cookie");
    assert.equal(getHandler.includes("redirect"), false, "GET handler redirects");

    // POST is the only state-changing handler and uses the shared clear seam.
    const postHandler = route.split("export async function POST")[1] ?? "";
    assert.match(postHandler, /logoutCookieSet/, "POST clears via the shared seam");
    assert.match(postHandler, /response\.cookies\.set\(/, "POST sets the clear cookie");
    assert.match(postHandler, /NextResponse\.redirect/, "POST redirects to the root page");
    assert.equal(route.includes("maxAge"), false, "route must not hardcode cookie attributes");
  });

  it("2. repeated GET-equivalent requests are harmless (session stays valid)", async () => {
    const repo = new MemoryRepository();
    const session = await bootstrapValidSession(repo);

    // GET /auth/logout is a pure 405 — simulate prefetching it many times:
    // nothing is written, nothing is cleared, and the session is untouched.
    for (let i = 0; i < 5; i += 1) {
      const gate = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName: "overview" });
      assert.equal(gate.ok, true, `session died after GET-like request #${i + 1}`);
    }
  });

  it("3. POST /auth/logout clears the session with EXACT issued attributes and redirects home", () => {
    const secure = logoutCookieSet(true);
    assert.equal(secure.name, DASHBOARD_SESSION_COOKIE);
    assert.equal(secure.value, "");
    assert.equal(secure.attributes.maxAge, 0);
    assert.equal(secure.attributes.sameSite, "lax", "clear must mirror the issued Lax cookie");
    assert.equal(secure.attributes.httpOnly, true);
    assert.equal(secure.attributes.secure, true);
    assert.equal(secure.attributes.path, "/");

    const insecure = logoutCookieSet(false);
    assert.equal(insecure.attributes.secure, false);

    const route = readFileSync("src/app/auth/logout/route.ts", "utf8");
    assert.match(route, /NextResponse\.redirect\(new URL\("\/", request\.nextUrl\)\)/, "POST redirects to the root page");
  });

  it("4. P0 PRODUCTION SEQUENCE: prefetch GETs (incl. logout) never log the user out; POST logout does", async () => {
    const repo = new MemoryRepository();
    const session = await bootstrapValidSession(repo);

    const loadOverview = () => requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName: "overview" });
    const loadApprovals = () => requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName: "approvals" });
    const loadBatches = () => requireDashboardContext({ repo, session, nowIso: FIVE_MIN, pageName: "batches" });

    // 1. Overview renders.
    assert.equal((await loadOverview()).ok, true, "overview authorized");
    // 2. Next.js prefetches navigation links — INCLUDING GET /auth/logout.
    //    The GET is a 405 and mutates nothing (contract covered in test 1).
    const route = readFileSync("src/app/auth/logout/route.ts", "utf8");
    assert.ok(route.includes("status: 405") && !route.split("export function GET")[1].includes("cookies"));
    // 3. The session is untouched by prefetching.
    assert.equal((await loadApprovals()).ok, true, "approvals still authorized after prefetch");
    assert.equal((await loadBatches()).ok, true, "batches still authorized after prefetch");
    assert.equal((await loadOverview()).ok, true, "overview still authorized after prefetch");

    // 4. The user presses Sign Out (POST) — only NOW is the session cleared.
    const clear = logoutCookieSet(true);
    const loggedOutCookieHeader = `${clear.name}=${clear.value}`;
    const clearedSession = parseDashboardSessionCookie(loggedOutCookieHeader, SECRET);
    assert.equal(clearedSession, null, "POST logout must invalidate the session cookie");

    const deniedGate = await requireDashboardContext({ repo, session: null, nowIso: FIVE_MIN, pageName: "batches" });
    assert.deepEqual(deniedGate, { ok: false }, "protected route denied after logout");

    // 5. Repeated POST logout stays safe (idempotent).
    const again = logoutCookieSet(true);
    assert.equal(again.value, "");
    assert.equal(again.attributes.maxAge, 0);
  });

  it("5. Sign Out is an explicit POST form, never a Link, and sections stay Links", () => {
    const nav = readFileSync("src/components/DashboardNav.tsx", "utf8");

    // No navigational Link to the logout route — nothing Next.js can prefetch.
    assert.equal(nav.includes('href="/auth/logout"'), false, "Sign Out must not be a Link");
    assert.equal(nav.includes('<Link\n        href="/auth/logout"'), false);

    // Sign Out is an explicit POST form + submit button (no client JS).
    assert.match(nav, /<form\s+action="\/auth\/logout"\s+method="post"/, "Sign Out must be a POST form");
    assert.match(nav, /<button\s+type="submit"/, "Sign Out must be a submit button");

    // Section navigation remains client-side Links.
    assert.match(nav, /<Link\s+key=\{section\.href\}/, "sections stay Links");
    assert.match(nav, /href=\{section\.href\}/);
  });

  it("6. audit: no other destructive GET is reachable from dashboard navigation", () => {
    // All navigation hrefs live in the layout + DashboardNav. Every href must
    // be either a safe read route (/app/*) or the POST logout form.
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    const nav = readFileSync("src/components/DashboardNav.tsx", "utf8");
    const hrefs = [
      ...[...layout.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]),
      ...[...nav.matchAll(/href=\{?section\.href\}?|href="(\/app[^"]*)"|href="(\/auth[^"]*)"/g)].map((m) => m[1] ?? m[2] ?? ""),
    ].filter(Boolean);

    for (const href of new Set(hrefs)) {
      assert.ok(
        href.startsWith("/app"),
        `dashboard navigation must only link to read routes, got "${href}"`,
      );
    }
    // The only auth-related surface in the nav is the POST logout form.
    assert.equal(nav.includes("/auth/logout"), true);
    assert.equal(nav.includes('href="/auth/logout"'), false);
  });
});
