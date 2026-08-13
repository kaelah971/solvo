import {
  buildDashboardSessionClearAttributes,
  DASHBOARD_SESSION_COOKIE,
  type DashboardSessionCookie,
} from "./session.ts";

/**
 * M12.4 — Logout seam (framework-free).
 *
 * Logout is a STATE-CHANGING operation and must only ever run from an
 * explicit user POST — never from a GET navigation or a Next.js Link
 * prefetch (a prefetched GET /auth/logout used to clear the session cookie
 * in the background while the dashboard was merely rendered). This seam owns
 * the cookie-clear payload; the route wires it into the POST handler.
 */

export type LogoutCookieSet = {
  name: string;
  value: "";
  attributes: DashboardSessionCookie["attributes"];
};

/**
 * The exact Set-Cookie payload that destroys the dashboard session:
 * same name/path/SameSite/Secure as the issued cookie, Max-Age 0.
 * Idempotent — clearing an absent cookie is a successful logout.
 */
export function logoutCookieSet(secureCookie: boolean): LogoutCookieSet {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: "",
    attributes: buildDashboardSessionClearAttributes({ secureCookie }),
  };
}
