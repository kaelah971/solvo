import type { SolvoRepository } from "../db/repository.ts";
import { getDbRepository } from "../db/accessor.ts";
import type { DashboardContext } from "./types.ts";
import { canViewDashboard } from "./access.ts";
import {
  getDashboardCookieSecret,
  getDashboardSessionFromHeaders,
  requireDashboardContext,
  type DashboardSession,
} from "./session.ts";

/**
 * M12.5 — Shared dashboard page gate.
 *
 * Every dashboard page (overview + all child routes) uses ONE entry point:
 *
 *   const page = await requireDashboardPageContext(await headers(), "payouts");
 *   if (!page.ok) return <DashboardUnavailable />;
 *   const model = await buildXPageModel(page.repo, page.ctx);
 *
 * That single helper performs the whole authentication sequence:
 *
 *  1. read the signed session cookie from the request headers
 *     (`resolveDashboardPageGate`);
 *  2. acquire the repository;
 *  3. re-check ACTIVE same-workspace membership from the repository
 *     (`requireDashboardContext`);
 *  4. return the verified context + repository for the page-model builder.
 *
 * There is deliberately NO per-page auth logic: every route shares this
 * exact path, so a session that works on /app works identically on
 * /app/approvals, /app/payouts, … (and every denied shape stays generic).
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

export type DashboardPageAuthResult =
  | { ok: true; repo: SolvoRepository; ctx: DashboardContext }
  | { ok: false };

/**
 * The single dashboard page gate: signed-cookie verification + repository
 * acquisition + ACTIVE membership re-check, returning the verified context.
 * Every failure (no secret, no repo, no/tampered cookie, non-member, inactive
 * member, unknown workspace) collapses to the same generic `{ ok: false }`.
 */
export async function requireDashboardPageContext(
  headers: Pick<Headers, "get">,
  pageName: string,
): Promise<DashboardPageAuthResult> {
  const gate = resolveDashboardPageGate(headers);
  const repo = getDbRepository();
  if (repo === null || gate.secret === null) return { ok: false };
  const required = await requireDashboardContext({
    repo,
    session: gate.session,
    nowIso: gate.nowIso,
    pageName,
  });
  if (!required.ok) return { ok: false };
  return { ok: true, repo, ctx: required.ctx };
}

/** Page-model gate: only ACTIVE members of the workspace may read. */
export function canReadDashboardPage(ctx: DashboardContext): boolean {
  return canViewDashboard(ctx);
}
