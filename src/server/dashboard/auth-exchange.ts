import type { SolvoRepository } from "../db/repository.ts";
import {
  issueDashboardSessionFromLoginToken,
  verifyDashboardLoginToken,
} from "./login-links.ts";
import type { DashboardSessionCookie } from "./session.ts";

/**
 * M12.4 — Telegram dashboard login exchange (framework-free seam).
 *
 * The auth route (`/auth/telegram-link`) wraps this function 1:1: verify the
 * one-time token, re-check ACTIVE same-workspace membership, atomically
 * consume the token, build the signed HttpOnly SameSite=Lax session cookie,
 * and redirect to /app. Keeping the logic here makes the full exchange
 * testable without the Next.js runtime.
 *
 * Security invariants preserved here:
 *  - invalid/expired/used/nonmember/inactive tokens collapse to ONE generic
 *    `unavailable` result with no existence leak (the diagnostic `errorCode`
 *    is log-only, never rendered to the user);
 *  - the token is consumed only AFTER verification and membership re-check;
 *  - no query parameter, user id, or workspace id is ever trusted; identity
 *    flows only from the verified token record + repository membership;
 *  - the raw token never leaves this module.
 */

export type DashboardAuthExchangeResult =
  | { kind: "redirect"; redirectTo: "/app"; cookie: DashboardSessionCookie }
  | { kind: "unavailable"; errorCode: string };

export type DashboardAuthExchangeInput = {
  repo: SolvoRepository;
  rawToken: string;
  nowIso: string;
  secret: string;
  secureCookie: boolean;
};

/** Test-only dependency override for the auth route (never set in production). */
export type DashboardAuthRouteOverrides = {
  repo?: SolvoRepository | null;
  secret?: string | null;
};

const AUTH_DEPS = Symbol.for("solvo.dashboard.auth.deps");

export function setDashboardAuthRouteOverrides(overrides: DashboardAuthRouteOverrides | null): void {
  (globalThis as unknown as Record<symbol, unknown>)[AUTH_DEPS] = overrides;
}

export function getDashboardAuthRouteOverrides(): DashboardAuthRouteOverrides | null {
  return ((globalThis as unknown as Record<symbol, unknown>)[AUTH_DEPS] ??
    null) as DashboardAuthRouteOverrides | null;
}

/**
 * Exchange a one-time login token for a signed dashboard session cookie.
 * Logs ONLY booleans, the redirect path, and a constant error code under the
 * `dashboard_auth_link_debug` tag — never the token, token hash, cookie
 * value, user ids, chat ids, workspace ids, or secrets.
 */
export async function exchangeLoginTokenForSession(
  input: DashboardAuthExchangeInput,
): Promise<DashboardAuthExchangeResult> {
  const result = await issueDashboardSessionFromLoginToken({
    repo: input.repo,
    rawToken: input.rawToken,
    nowIso: input.nowIso,
    secret: input.secret,
    secureCookie: input.secureCookie,
  });
  if (result.kind === "redirect") {
    logDashboardAuthLinkDebug({
      tokenPresent: true,
      tokenLookupFound: true,
      tokenExpired: false,
      tokenAlreadyUsed: false,
      tokenConsumed: true,
      cookieSet: true,
      redirectPath: result.redirectTo,
      errorCode: null,
    });
    return { kind: "redirect", redirectTo: result.redirectTo, cookie: result.cookie };
  }

  // Classify the denial for the diagnostic only (one extra read on the
  // failure path); the result handed to the caller stays generic.
  const verdict = await verifyDashboardLoginToken(input.repo, input.rawToken, input.nowIso);
  logDashboardAuthLinkDebug({
    tokenPresent: true,
    tokenLookupFound: verdict.ok,
    tokenExpired: !verdict.ok && verdict.kind === "expired",
    tokenAlreadyUsed: !verdict.ok && verdict.kind === "used",
    tokenConsumed: false,
    cookieSet: false,
    redirectPath: "/app",
    errorCode: verdict.ok ? "membership_denied" : verdict.kind,
  });
  return { kind: "unavailable", errorCode: verdict.ok ? "membership_denied" : verdict.kind };
}

function logDashboardAuthLinkDebug(debug: {
  tokenPresent: boolean;
  tokenLookupFound: boolean;
  tokenExpired: boolean;
  tokenAlreadyUsed: boolean;
  tokenConsumed: boolean;
  cookieSet: boolean;
  redirectPath: string;
  errorCode: string | null;
}): void {
  // Tag must stay on this line so source contracts only ever see it here.
  console.log(`dashboard_auth_link_debug ${JSON.stringify({ tokenPresent: debug.tokenPresent, tokenLookupFound: debug.tokenLookupFound, tokenExpired: debug.tokenExpired, tokenAlreadyUsed: debug.tokenAlreadyUsed, tokenConsumed: debug.tokenConsumed, cookieSet: debug.cookieSet, redirectPath: debug.redirectPath, errorCode: debug.errorCode })}`);
}
