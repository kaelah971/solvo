import type { SolvoRepository } from "../db/repository.ts";
import type { DashboardContext } from "./types.ts";
import { canViewDashboard, resolveDashboardContext } from "./access.ts";

/**
 * M12.3 — Dashboard session seam.
 *
 * The FINAL Telegram `/dashboard` login flow (single-use login link → HttpOnly
 * SameSite=Strict session cookie) is deferred to a later M12 slice. Until then
 * this module is the one place session cookies are parsed:
 *
 *  - `parseDashboardSessionCookie` reads ONLY a server-set cookie header
 *    (`solvo_dash_session` = a small JSON payload with `workspaceId` +
 *    `telegramUserId`). It never trusts query parameters, and it never
 *    carries secrets — the cookie is a dev/test seam and M12.4+ replaces it
 *    with Telegram-issued login tokens.
 *  - `requireDashboardContext` re-checks ACTIVE same-workspace membership from
 *    the repository on every request (M12.2 `resolveDashboardContext` +
 *    `canViewDashboard`), so removed/inactive members immediately lose access.
 *
 * The route layer passes the request `cookie` header here; nothing else is
 * ever accepted as identity.
 */

export const DASHBOARD_SESSION_COOKIE = "solvo_dash_session";

export type DashboardSession = {
  workspaceId: string;
  telegramUserId: string;
};

/** Header-safe cookie value (URI-encoded JSON). */
export function buildDashboardSessionCookieValue(session: DashboardSession): string {
  return encodeURIComponent(JSON.stringify(session));
}

/** Parse the dashboard session from a raw Cookie header; null on any failure. */
export function parseDashboardSessionCookie(cookieHeader: string | null | undefined): DashboardSession | null {
  if (cookieHeader === null || cookieHeader === undefined) return null;
  const match = new RegExp(`(?:^|;\\s*)${DASHBOARD_SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
  if (match === null) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1]));
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.workspaceId !== "string" || record.workspaceId.length === 0) return null;
    if (typeof record.telegramUserId !== "string" || record.telegramUserId.length === 0) return null;
    return { workspaceId: record.workspaceId, telegramUserId: record.telegramUserId };
  } catch {
    return null;
  }
}

/** Read the dashboard session from a Headers object (the `cookie` header). */
export function getDashboardSessionFromHeaders(headers: Pick<Headers, "get">): DashboardSession | null {
  return parseDashboardSessionCookie(headers.get("cookie"));
}

export type RequireDashboardContextResult =
  | { ok: true; ctx: DashboardContext }
  | { ok: false };

export type RequireDashboardContextInput = {
  repo: SolvoRepository;
  session: DashboardSession | null;
  nowIso: string;
};

/**
 * Resolve + gate the dashboard context for one request. Every failure path —
 * no session, unknown workspace, non-member, inactive member — collapses to
 * the same generic `{ ok: false }` so callers render one no-leak unavailable
 * screen and existence never leaks.
 */
export async function requireDashboardContext(
  input: RequireDashboardContextInput,
): Promise<RequireDashboardContextResult> {
  if (input.session === null) return { ok: false };
  const ctx = await resolveDashboardContext({
    repo: input.repo,
    workspaceId: input.session.workspaceId,
    telegramUserId: input.session.telegramUserId,
    nowIso: input.nowIso,
  });
  if (!canViewDashboard(ctx)) return { ok: false };
  return { ok: true, ctx };
}
