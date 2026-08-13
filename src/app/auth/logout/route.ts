import { NextRequest, NextResponse } from "next/server";

import { logoutCookieSet } from "@/server/dashboard/logout-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * M12.4 — Dashboard logout.
 *
 * POST /auth/logout clears the dashboard session cookie (Max-Age 0) and
 * redirects to the site root. Idempotent: clearing an absent cookie is a
 * successful logout.
 *
 * GET /auth/logout is deliberately NON-destructive (405 Method Not Allowed):
 * a GET request — Next.js Link prefetch, crawler, preview, or accidental
 * navigation — must NEVER clear the dashboard session. Logout only happens
 * after the user actually submits the Sign Out POST form.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/", request.nextUrl));
  const clear = logoutCookieSet(process.env.NODE_ENV === "production");
  response.cookies.set(clear.name, clear.value, clear.attributes);
  return response;
}

/** Non-destructive: no cookie mutation, no redirect, no session side effects. */
export function GET(): Response {
  return new Response(null, { status: 405 });
}
