import type { DashboardContext } from "./types.ts";
import { canViewDashboard } from "./access.ts";
import {
  getDashboardCookieSecret,
  getDashboardSessionFromHeaders,
  type DashboardSession,
} from "./session.ts";

/**
 * M12.5 — Shared dashboard page gate.
 *
 * Every dashboard page follows the same M12.3/M12.4 sequence:
 *
 *  1. resolve the signed session from the request cookie header;
 *  2. acquire the repository;
 *  3. re-check ACTIVE same-workspace membership from the repository
 *     (`requireDashboardContext`);
 *  4. build the page model through a gated builder.
 *
 * This module owns step 1 (and a small test seam); steps 2–4 live in the
 * page itself so repository acquisition stays the page's responsibility.
 * Page-model builders re-verify `canViewDashboard` so a stale context can
 * never render data.
 */

export type DashboardPageGate = {
  secret: string | null;
  session: DashboardSession | null;
  nowIso: string;
};

/** Read the signed session cookie + clock for one request. */
export function resolveDashboardPageGate(
  headers: Pick<Headers, "get">,
  nowIso: string = new Date().toISOString(),
): DashboardPageGate {
  const secret = getDashboardCookieSecret();
  const session = secret !== null ? getDashboardSessionFromHeaders(headers, secret) : null;
  return { secret, session, nowIso };
}

/** Page-model gate: only ACTIVE members of the workspace may read. */
export function canReadDashboardPage(ctx: DashboardContext): boolean {
  return canViewDashboard(ctx);
}
