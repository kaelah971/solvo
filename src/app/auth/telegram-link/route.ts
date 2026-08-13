import { NextRequest, NextResponse } from "next/server";

import { getDbRepository } from "@/server/db/accessor";
import { getDashboardCookieSecret } from "@/server/dashboard/session";
import {
  exchangeLoginTokenForSession,
  getDashboardAuthRouteOverrides,
} from "@/server/dashboard/auth-exchange";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M12.4 — Telegram dashboard login exchange.
 *
 * GET /auth/telegram-link?token=...
 *
 * Thin wrapper over `exchangeLoginTokenForSession` (auth-exchange.ts): the
 * one-time login token is verified, the ACTIVE same-workspace membership is
 * re-checked from the repository, the token is atomically consumed, and a
 * signed HttpOnly SameSite=Lax `solvo_dash_session` cookie is set before
 * redirecting to /app. Invalid/expired/used/nonmember/inactive all redirect
 * to /app with NO cookie — /app renders the generic no-leak unavailable
 * screen. The token is never logged and never echoed back.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Test seam only; production never sets it (see auth-exchange.ts).
  const overrides = getDashboardAuthRouteOverrides();

  const secret = overrides?.secret !== undefined ? overrides.secret : getDashboardCookieSecret();
  if (secret === null) {
    logDashboardAuthLinkDebug({ errorCode: "missing_secret" });
    return unavailableRedirect(request);
  }

  const repo = overrides?.repo !== undefined ? overrides.repo : getDbRepository();
  if (repo === null) {
    logDashboardAuthLinkDebug({ errorCode: "repo_unavailable" });
    return unavailableRedirect(request);
  }

  const rawToken = request.nextUrl.searchParams.get("token");
  if (rawToken === null) {
    logDashboardAuthLinkDebug({ errorCode: "missing_token" });
    return unavailableRedirect(request);
  }

  const result = await exchangeLoginTokenForSession({
    repo,
    rawToken,
    nowIso: new Date().toISOString(),
    secret,
    secureCookie: process.env.NODE_ENV === "production",
  });
  if (result.kind === "unavailable") return unavailableRedirect(request);

  const response = NextResponse.redirect(new URL(result.redirectTo, request.nextUrl));
  response.cookies.set(result.cookie.name, result.cookie.value, result.cookie.attributes);
  return response;
}

/** Pre-exchange failure diagnostic: constant error codes only. */
function logDashboardAuthLinkDebug(debug: { errorCode: string }): void {
  // Tag must stay on this line so source contracts only ever see it here.
  console.log(`dashboard_auth_link_debug ${JSON.stringify(debug)}`);
}

/** Redirect without setting any cookie; /app shows the generic unavailable page. */
function unavailableRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/app", request.nextUrl));
}
