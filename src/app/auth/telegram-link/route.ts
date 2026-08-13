import { NextRequest, NextResponse } from "next/server";

import { getDbRepository } from "@/server/db/accessor";
import { getDashboardCookieSecret } from "@/server/dashboard/session";
import { issueDashboardSessionFromLoginToken } from "@/server/dashboard/login-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M12.4 — Telegram dashboard login exchange.
 *
 * GET /auth/telegram-link?token=...
 *
 * The raw one-time login token (from the Telegram /dashboard reply) is
 * verified, the ACTIVE same-workspace membership is re-checked from the
 * repository, the token is atomically consumed, and a signed HttpOnly
 * SameSite=Strict `solvo_dash_session` cookie is set before redirecting to
 * /app. Invalid/expired/used/nonmember/inactive all redirect to /app with NO
 * cookie — /app renders the generic no-leak unavailable screen. The token is
 * never logged and never echoed back.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const secret = getDashboardCookieSecret();
  if (secret === null) return unavailableRedirect(request);

  const repo = getDbRepository();
  if (repo === null) return unavailableRedirect(request);

  const rawToken = request.nextUrl.searchParams.get("token");
  if (rawToken === null) return unavailableRedirect(request);

  const result = await issueDashboardSessionFromLoginToken({
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

/** Redirect without setting any cookie; /app shows the generic unavailable page. */
function unavailableRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/app", request.nextUrl));
}
