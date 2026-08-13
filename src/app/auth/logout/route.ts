import { NextRequest, NextResponse } from "next/server";

import { DASHBOARD_SESSION_COOKIE } from "@/server/dashboard/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M12.4 — Dashboard logout.
 *
 * GET /auth/logout clears the dashboard session cookie (Max-Age 0) and
 * redirects to the site root. Idempotent: clearing an absent cookie is a
 * successful logout.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.nextUrl));
  response.cookies.set(DASHBOARD_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
