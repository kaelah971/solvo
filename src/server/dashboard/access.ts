import type { SolvoRepository } from "../db/repository.ts";
import type { MemberRole } from "../db/types.ts";
import type { DashboardContext } from "./types.ts";

/**
 * M12.2 — Dashboard access helpers.
 *
 * Pure role/membership gates shared by every dashboard page and action
 * (M12.3+). All helpers are deterministic functions of the DashboardContext,
 * which is resolved from repository rows on every request — a stale member
 * object can never bypass them.
 */

/** Mask an identity for display: keep a short prefix + suffix. */
export function maskIdentity(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length <= 8) return "…";
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

/** True when the context describes an ACTIVE member of the workspace. */
export function isActiveMember(ctx: DashboardContext): boolean {
  return ctx.memberId !== null && ctx.role !== null && ctx.status === "active" && ctx.mode !== null;
}

/** Anyone may open the dashboard overview — active members only. */
export function canViewDashboard(ctx: DashboardContext): boolean {
  return isActiveMember(ctx);
}

/** Pending approvals are visible to every active member (read-only rows). */
export function canViewApprovals(ctx: DashboardContext): boolean {
  return isActiveMember(ctx);
}

/** Owners and approvers may approve/reject payouts, batches, and claims. */
export function canApproveReject(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && (ctx.role === "owner" || ctx.role === "approver");
}

/** Owners only: add/remove members and change roles. */
export function canManageMembers(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && ctx.role === "owner";
}

/** Owners and approvers may manage the recipient directory. */
export function canManageRecipients(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && (ctx.role === "owner" || ctx.role === "approver");
}

/** Owners only: adjust policy limits. */
export function canManagePolicies(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && ctx.role === "owner";
}

/**
 * Owners and approvers may reissue eligible claim links. The claim STATE
 * eligibility (created/expired/cancelled only) is a separate check in the
 * claims read model — this helper is the role gate only.
 */
export function canReissueClaim(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && (ctx.role === "owner" || ctx.role === "approver");
}

/** Full destinations (wallets, claim destinations) are owner/approver-only. */
export function canViewSensitiveDestinations(ctx: DashboardContext): boolean {
  return isActiveMember(ctx) && (ctx.role === "owner" || ctx.role === "approver");
}

export type ResolveDashboardContextInput = {
  repo: SolvoRepository;
  workspaceId: string;
  telegramUserId: string;
  nowIso: string;
};

/**
 * Resolve a DashboardContext from repository rows (no sessions yet — this is
 * the M12.3 identity hand-off point). Reads the workspace and the member row
 * fresh so removed/inactive members immediately lose access.
 */
export async function resolveDashboardContext(
  input: ResolveDashboardContextInput,
): Promise<DashboardContext> {
  const workspace = await input.repo.getWorkspaceById(input.workspaceId);
  const member = await input.repo.getWorkspaceMember(input.workspaceId, input.telegramUserId);
  return {
    workspaceId: input.workspaceId,
    telegramUserId: input.telegramUserId,
    memberId: member?.id ?? null,
    role: member?.role ?? null,
    status: member?.status ?? null,
    mode: workspace?.mode ?? null,
    nowIso: input.nowIso,
  };
}

/** Build a context directly from known rows (pure; used by tests). */
export function makeDashboardContext(input: {
  workspaceId: string;
  telegramUserId: string;
  role: MemberRole | null;
  status: "active" | "removed" | null;
  mode: DashboardContext["mode"];
  nowIso: string;
}): DashboardContext {
  return {
    workspaceId: input.workspaceId,
    telegramUserId: input.telegramUserId,
    memberId: input.role === null ? null : "member-row",
    role: input.role,
    status: input.status,
    mode: input.mode,
    nowIso: input.nowIso,
  };
}
