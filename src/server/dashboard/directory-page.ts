import type { SolvoRepository } from "../db/repository.ts";
import { canViewDashboard } from "./access.ts";
import { listMemberViews } from "./members.ts";
import { listRecipientViews } from "./recipients.ts";
import type { DashboardContext, MemberListItemView, RecipientListItemView } from "./types.ts";

/**
 * M12.7 — Recipient + member page models (server side, no React).
 *
 * Read-only directory pages. Every builder returns the single generic
 * `{ ok: false }` for non-members / inactive members / missing workspace,
 * and every read is scoped to the operator's workspace. Destinations follow
 * the M12.2 visibility rule: full wallets for owners/approvers, masked for
 * members. No add/edit/delete/role-change surface exists anywhere in this
 * module or its pages.
 */

// ── Display labels (operator-safe; no internal terms) ──────────────────────

export function memberRoleLabel(role: MemberListItemView["role"]): string {
  switch (role) {
    case "owner":
      return "OWNER";
    case "approver":
      return "APPROVER";
    case "member":
      return "MEMBER";
  }
}

export function memberStatusLabel(status: MemberListItemView["status"]): string {
  return status === "active" ? "ACTIVE" : "INACTIVE";
}

// ── Recipients page model ──────────────────────────────────────────────────

export type RecipientsPageModel =
  | { ok: true; items: RecipientListItemView[]; empty: boolean }
  | { ok: false };

export async function buildRecipientsPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<RecipientsPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const views = await listRecipientViews(repo, ctx);
  if (views.length === 0) return { ok: true, items: [], empty: true };
  return { ok: true, items: views, empty: false };
}

// ── Members page model ─────────────────────────────────────────────────────

export type MembersPageItem = {
  view: MemberListItemView;
  roleLabel: string;
  statusLabel: string;
};

export type MembersPageModel =
  | { ok: true; items: MembersPageItem[]; empty: boolean }
  | { ok: false };

export async function buildMembersPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<MembersPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const views = await listMemberViews(repo, ctx);
  if (views.length === 0) return { ok: true, items: [], empty: true };
  const items: MembersPageItem[] = views.map((view) => ({
    view,
    roleLabel: memberRoleLabel(view.role),
    statusLabel: memberStatusLabel(view.status),
  }));
  return { ok: true, items, empty: false };
}
