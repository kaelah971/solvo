import type { SolvoRepository } from "../db/repository.ts";
import type { WorkspaceMemberRow } from "../db/types.ts";
import { maskIdentity } from "./access.ts";
import type { DashboardContext, MemberListItemView } from "./types.ts";

/**
 * M12.2 — Members read model.
 *
 * Workspace-scoped member list with masked identities (the repository returns
 * active members, ordered by role). Removed-member history remains in the
 * audit trail; full member management lands with the M12.7 page/actions.
 */
export async function listMemberViews(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<MemberListItemView[]> {
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  return members.map(buildMemberListItemView);
}

export function buildMemberListItemView(member: WorkspaceMemberRow): MemberListItemView {
  return {
    memberId: member.id,
    role: member.role,
    status: member.status,
    maskedId: maskIdentity(member.telegram_user_id) ?? "…",
    createdAt: member.created_at,
  };
}
