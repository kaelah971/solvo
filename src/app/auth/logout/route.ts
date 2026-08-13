import { NextRequest, NextResponse } from "next/server";

import { buildDashboardSessionClearAttributes, DASHBOARD_SESSION_COOKIE } from "@/server/dashboard/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M12.4 — Dashboard logout.
 *
 * GET /auth/logout clears the dashboard session cookie (Max-Age 0) and
 * redirects to the site root. Idempotent: clearing an absent cookie is a
 * successful logout.
 *
 * The clear-cookie attributes come from `buildDashboardSessionClearAttributes`
 * so sign-out always deletes the exact cookie the auth route issued
 * (HttpOnly + SameSite=Lax + Secure-in-prod + Path=/).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.nextUrl));
  response.cookies.set(
    DASHBOARD_SESSION_COOKIE,
    "",
    buildDashboardSessionClearAttributes({ secureCookie: process.env.NODE_ENV === "production" }),
  );
  return response;
}
