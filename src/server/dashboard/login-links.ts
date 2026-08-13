import { createHash, randomBytes } from "node:crypto";

import type { DashboardLoginTokenRow, SolvoRepository } from "../db/repository.ts";
import type { MemberRole } from "../db/types.ts";
import { canViewDashboard, resolveDashboardContext } from "./access.ts";
import {
  buildDashboardSessionCookie,
  type DashboardSessionCookie,
} from "./session.ts";

/**
 * M12.4 — One-time dashboard login links.
 *
 * A login link is authentication material:
 *
 *  - the raw token is 256 bits of CSPRNG entropy (base64url), returned
 *    EXACTLY once in the Telegram /dashboard reply;
 *  - only the SHA-256 token hash is persisted — the raw token never enters
 *    the database, audit metadata, logs, or errors;
 *  - tokens are short-lived (default 10 minutes) and single-use
 *    (`used_at` is set atomically on consume);
 *  - a token is scoped to workspace_id + telegram_user_id + member_id + role;
 *  - verification re-checks ACTIVE same-workspace membership from the
 *    repository before a session is issued;
 *  - unknown/expired/used tokens collapse to one generic no-leak result.
 *
 * No payment/approval/execution surface is ever touched here.
 */

export const DASHBOARD_LOGIN_EXPIRY_MINUTES = 10;
export const DASHBOARD_LOGIN_TOKEN_BYTES = 32;
export const DASHBOARD_LOGIN_TOKEN_LENGTH = 44; // base64url of 32 bytes, padded to 44

export function generateDashboardLoginToken(): string {
  return randomBytes(DASHBOARD_LOGIN_TOKEN_BYTES).toString("base64url");
}

export function hashDashboardLoginToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function dashboardLoginTokenIsWellFormed(rawToken: string): boolean {
  return /^[A-Za-z0-9_-]{43,44}$/.test(rawToken);
}

export type CreateDashboardLoginLinkInput = {
  repo: SolvoRepository;
  workspaceId: string;
  telegramUserId: string;
  memberId: string;
  role: MemberRole;
  nowIso: string;
  expiryMinutes?: number;
  /** Public base URL for the auth link (defaults to the app URL config). */
  appUrl?: string;
};

export type CreateDashboardLoginLinkResult =
  | { ok: true; token: string; link: string; expiresAt: string }
  | { ok: false; reason: string };

/**
 * Create a one-time dashboard login link. The raw token is returned exactly
 * once; only its hash is persisted. No audit row is written (the raw token
 * must never appear in audit metadata).
 */
export async function createDashboardLoginLink(
  input: CreateDashboardLoginLinkInput,
): Promise<CreateDashboardLoginLinkResult> {
  const raw = generateDashboardLoginToken();
  const expiresAt = new Date(
    new Date(input.nowIso).getTime() + (input.expiryMinutes ?? DASHBOARD_LOGIN_EXPIRY_MINUTES) * 60 * 1000,
  ).toISOString();
  try {
    await input.repo.createDashboardLoginToken({
      tokenHash: hashDashboardLoginToken(raw),
      workspaceId: input.workspaceId,
      telegramUserId: input.telegramUserId,
      memberId: input.memberId,
      role: input.role,
      expiresAt,
    });
  } catch {
    return { ok: false, reason: "The dashboard link could not be created." };
  }
  return { ok: true, token: raw, link: `${input.appUrl ?? ""}/auth/telegram-link?token=${raw}`, expiresAt };
}

export type DashboardLoginTokenState = "unknown" | "expired" | "used" | "valid";

export type VerifyDashboardLoginTokenResult =
  | { ok: true; record: DashboardLoginTokenRow }
  | { ok: false; kind: Exclude<DashboardLoginTokenState, "valid"> };

/**
 * Verify a raw login token. Expiry is checked against the clock; used tokens
 * are rejected. Never logs or returns the raw token.
 */
export async function verifyDashboardLoginToken(
  repo: SolvoRepository,
  rawToken: string,
  nowIso: string,
): Promise<VerifyDashboardLoginTokenResult> {
  if (!dashboardLoginTokenIsWellFormed(rawToken)) return { ok: false, kind: "unknown" };
  const record = await repo.getDashboardLoginTokenByHash(hashDashboardLoginToken(rawToken));
  if (record === null) return { ok: false, kind: "unknown" };
  if (record.used_at !== null) return { ok: false, kind: "used" };
  if (record.expires_at <= nowIso) return { ok: false, kind: "expired" };
  return { ok: true, record };
}

/**
 * Atomically consume a login token (single-use). Returns the record or null
 * when it is unknown/already used. The caller verifies + re-checks membership
 * before consuming.
 */
export async function consumeDashboardLoginToken(
  repo: SolvoRepository,
  rawToken: string,
  usedAtIso: string,
): Promise<DashboardLoginTokenRow | null> {
  if (!dashboardLoginTokenIsWellFormed(rawToken)) return null;
  return repo.consumeDashboardLoginToken(hashDashboardLoginToken(rawToken), usedAtIso);
}

export type IssueDashboardSessionInput = {
  repo: SolvoRepository;
  rawToken: string;
  nowIso: string;
  secret: string;
  /** Secure flag for the session cookie (true in production). */
  secureCookie: boolean;
};

export type IssueDashboardSessionResult =
  | {
      kind: "redirect";
      redirectTo: "/app";
      cookie: DashboardSessionCookie;
    }
  | { kind: "unavailable" };

/**
 * Exchange a one-time login token for a signed dashboard session cookie.
 *
 * Ordering: verify token (unknown/expired/used → generic unavailable) →
 * re-check ACTIVE same-workspace membership from the repository (removed or
 * inactive members never get a session) → atomically consume the token
 * (single-use; a raced consume collapses to unavailable). Every failure path
 * returns the exact same generic result — no existence leak.
 */
export async function issueDashboardSessionFromLoginToken(
  input: IssueDashboardSessionInput,
): Promise<IssueDashboardSessionResult> {
  const verified = await verifyDashboardLoginToken(input.repo, input.rawToken, input.nowIso);
  if (!verified.ok) return { kind: "unavailable" };

  const ctx = await resolveDashboardContext({
    repo: input.repo,
    workspaceId: verified.record.workspace_id,
    telegramUserId: verified.record.telegram_user_id,
    nowIso: input.nowIso,
  });
  if (!canViewDashboard(ctx)) return { kind: "unavailable" };

  const consumed = await consumeDashboardLoginToken(input.repo, input.rawToken, input.nowIso);
  if (consumed === null) return { kind: "unavailable" };

  const cookie = buildDashboardSessionCookie(
    { workspaceId: consumed.workspace_id, telegramUserId: consumed.telegram_user_id },
    { secret: input.secret, secureCookie: input.secureCookie },
  );
  return { kind: "redirect", redirectTo: "/app", cookie };
}
