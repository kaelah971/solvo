import { createHmac, timingSafeEqual } from "node:crypto";

import type { SolvoRepository } from "../db/repository.ts";
import type { DashboardContext } from "./types.ts";
import { canViewDashboard, resolveDashboardContext } from "./access.ts";

/**
 * M12.4 — Dashboard session seam (signed cookies).
 *
 * The M12.3 seam is upgraded to a signed cookie:
 *
 *  - cookie value = `<base64url(payload)>.<base64url(hmac-sha256)>` where the
 *    payload is JSON `{ workspaceId, telegramUserId }` and the HMAC key is
 *    `SOLVO_DASHBOARD_COOKIE_SECRET` (a dev/test constant outside production).
 *  - Cookies cannot be tampered with: a modified payload fails verification.
 *  - The cookie is HttpOnly, SameSite=Lax, Secure in production, Path=/,
 *    Max-Age 7 days.
 *  - SameSite=Lax (not Strict): the Telegram → /auth/telegram-link → /app
 *    handoff opens from Telegram's in-app/external browser, which can behave
 *    like a cross-site top-level navigation; Strict drops the session cookie
 *    there and the user lands on the generic unavailable page. Lax still
 *    blocks cross-site POST/subresource cookies (CSRF) while allowing the
 *    top-level GET navigation that this flow needs. The dashboard is
 *    read-only and every request re-checks membership from the repository.
 *  - `/app` STILL re-checks ACTIVE same-workspace membership from the
 *    repository on every request (`requireDashboardContext`) — the cookie is
 *    an identity hint, never authority.
 *  - No query parameters are ever trusted as identity.
 *
 * The Telegram `/dashboard` flow issues these cookies via
 * `issueDashboardSessionFromLoginToken` (login-links.ts); the one-time login
 * token is a separate, short-lived, hash-persisted credential.
 */

export const DASHBOARD_SESSION_COOKIE = "solvo_dash_session";
export const DASHBOARD_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Dev/test-only HMAC key; production REQUIRES a configured secret. */
const DEV_COOKIE_SECRET = "solvo-dev-dashboard-cookie-secret-do-not-use-in-production";

export type DashboardSession = {
  workspaceId: string;
  telegramUserId: string;
};

/**
 * HMAC key for session cookies. Returns null in production when
 * `SOLVO_DASHBOARD_COOKIE_SECRET` is not configured — the seam then refuses
 * every cookie (no sessions without a server secret).
 */
export function getDashboardCookieSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.SOLVO_DASHBOARD_COOKIE_SECRET;
  if (typeof configured === "string" && configured.trim().length > 0) return configured;
  if (env.NODE_ENV === "production") return null;
  return DEV_COOKIE_SECRET;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url");
}

function signaturesMatch(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** Build the header-safe signed cookie value for a session. */
export function buildDashboardSessionCookieValue(session: DashboardSession, secret: string): string {
  const payload = encodeBase64Url(JSON.stringify(session));
  return `${payload}.${signPayload(payload, secret)}`;
}

/** Verify a cookie value and return the session; null on any failure. */
export function verifyDashboardSessionValue(value: string, secret: string | null): DashboardSession | null {
  if (secret === null) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!signaturesMatch(signature, signPayload(payload, secret))) return null;
  const decoded = decodeBase64Url(payload);
  if (decoded === null) return null;
  try {
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.workspaceId !== "string" || record.workspaceId.length === 0) return null;
    if (typeof record.telegramUserId !== "string" || record.telegramUserId.length === 0) return null;
    return { workspaceId: record.workspaceId, telegramUserId: record.telegramUserId };
  } catch {
    return null;
  }
}

/** Parse the signed session from a raw Cookie header; null on any failure. */
export function parseDashboardSessionCookie(
  cookieHeader: string | null | undefined,
  secret: string | null,
): DashboardSession | null {
  if (cookieHeader === null || cookieHeader === undefined || secret === null) return null;
  const match = new RegExp(`(?:^|;\\s*)${DASHBOARD_SESSION_COOKIE}=([^;]+)`).exec(cookieHeader);
  if (match === null) return null;
  return verifyDashboardSessionValue(match[1], secret);
}

/** Read the signed session from a Headers object (the `cookie` header). */
export function getDashboardSessionFromHeaders(
  headers: Pick<Headers, "get">,
  secret: string | null,
): DashboardSession | null {
  return parseDashboardSessionCookie(headers.get("cookie"), secret);
}

export type DashboardSessionCookie = {
  name: string;
  value: string;
  attributes: {
    httpOnly: true;
    secure: boolean;
    /** Lax (not Strict): Telegram in-app/external browser handoff performs a
     * cross-site-style top-level navigation; Lax keeps CSRF protection while
     * letting the auth → /app GET redirect carry the cookie. */
    sameSite: "lax";
    path: string;
    maxAge: number;
  };
};

/** Cookie attributes for the auth route: HttpOnly + Lax + Secure-in-prod. */
export function buildDashboardSessionCookie(
  session: DashboardSession,
  input: { secret: string; secureCookie: boolean; maxAgeSeconds?: number; path?: string },
): DashboardSessionCookie {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: buildDashboardSessionCookieValue(session, input.secret),
    attributes: {
      httpOnly: true,
      secure: input.secureCookie,
      sameSite: "lax",
      path: input.path ?? "/",
      maxAge: input.maxAgeSeconds ?? DASHBOARD_SESSION_MAX_AGE_SECONDS,
    },
  };
}

/**
 * Safe per-request session diagnostic for /app pages. Logs ONLY booleans and
 * the role — never the cookie value, signature, workspace ids, user ids, or
 * any secret.
 */
function logDashboardSessionDebug(input: {
  session: DashboardSession | null;
  ctx: DashboardContext;
  allowed: boolean;
}): void {
  // Tag must stay on this line so source contracts only ever see it here.
  console.log(`dashboard_session_debug ${JSON.stringify({ cookiePresent: input.session !== null, signatureValid: input.session !== null, sessionExpired: false, membershipFound: input.ctx.memberId !== null, membershipActive: input.ctx.status === "active" && input.ctx.role !== null && input.ctx.mode !== null, role: input.ctx.role, gateResult: input.allowed ? "allowed" : "unavailable" })}`);
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
  if (input.session === null) {
    const ctx: DashboardContext = {
      workspaceId: "",
      telegramUserId: "",
      memberId: null,
      role: null,
      status: null,
      mode: null,
      nowIso: input.nowIso,
    };
    logDashboardSessionDebug({ session: null, ctx, allowed: false });
    return { ok: false };
  }
  const ctx = await resolveDashboardContext({
    repo: input.repo,
    workspaceId: input.session.workspaceId,
    telegramUserId: input.session.telegramUserId,
    nowIso: input.nowIso,
  });
  const allowed = canViewDashboard(ctx);
  logDashboardSessionDebug({ session: input.session, ctx, allowed });
  if (!allowed) return { ok: false };
  return { ok: true, ctx };
}
