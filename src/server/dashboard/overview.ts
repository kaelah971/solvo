import type { SolvoRepository } from "../db/repository.ts";
import { DASHBOARD_MAX_LIMIT } from "../db/repository.ts";
import type { ExecutionState } from "../execution/state-machine.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { getEffectiveClaimStatus } from "../claim/status.ts";
import { maskIdentity } from "./access.ts";
import { buildAuditView } from "./audit.ts";
import { buildAgentRunView } from "./agent-runs.ts";
import type { DashboardContext, OverviewView } from "./types.ts";

/**
 * M12.2 — Workspace overview read model.
 *
 * Truth rules:
 *  - pending/prepared/failed numbers come from payout/payout_item states;
 *  - the prepared total is the sum of items prepared today that are STILL
 *    pending approval — prepared is not paid;
 *  - the completed total comes only from completed payout items (window =
 *    completed_at today) — completed only with pipeline truth;
 *  - failed/unknown is a count of failed + execution_unknown items and is
 *    explicitly not proof of anything;
 *  - claim counts use the M11.2 effective status rules (computed expiry);
 *  - agent_runs are never a source for any payment number.
 */

const FAILED_OR_UNKNOWN_STATES: readonly ExecutionState[] = [
  "validation_failed",
  "simulation_failed",
  "execution_failed",
  "execution_unknown",
];

export function utcDayStartIso(nowIso: string): string {
  return `${nowIso.slice(0, 10)}T00:00:00.000Z`;
}

export async function buildWorkspaceOverview(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<OverviewView> {
  const workspace = await repo.getWorkspaceById(ctx.workspaceId);
  const dayStart = utcDayStartIso(ctx.nowIso);

  const pendingApprovals = await repo.countPayoutItemsByWorkspaceStates(ctx.workspaceId, ["pending_approval"]);

  const claims = await repo.listClaimLinksByWorkspace(ctx.workspaceId, { limit: DASHBOARD_MAX_LIMIT });
  let pendingClaimLinks = 0;
  let claimedWaitingApproval = 0;
  for (const claim of claims) {
    const effective = getEffectiveClaimStatus(claim, ctx.nowIso);
    if (effective === "pending") pendingClaimLinks += 1;
    if (effective === "claimed") claimedWaitingApproval += 1;
  }

  const completedTodayItems = await repo.listPayoutItemsByWorkspace(ctx.workspaceId, {
    statuses: ["completed"],
    completedSinceIso: dayStart,
  });
  let completedTodayUsdc = 0n;
  for (const item of completedTodayItems) completedTodayUsdc += BigInt(item.amount_base_units);

  const preparedTodayUsdc = await repo.sumPayoutItemsByWorkspaceStates(
    ctx.workspaceId,
    ["pending_approval"],
    dayStart,
  );
  const failedOrUnknown = await repo.countPayoutItemsByWorkspaceStates(ctx.workspaceId, FAILED_OR_UNKNOWN_STATES);

  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const recipients = await repo.listRecipients(ctx.workspaceId);

  const recentAuditEvents = await repo.listAuditEventsByWorkspace(ctx.workspaceId, { limit: 10 });
  const recentAgentRuns = await repo.listAgentRunsByWorkspace(ctx.workspaceId, { limit: 10 });

  return {
    workspace: workspace
      ? { id: workspace.id, name: workspace.name, mode: workspace.mode, status: workspace.status }
      : null,
    currentMember: ctx.role !== null ? { role: ctx.role, maskedId: maskIdentity(ctx.telegramUserId) } : null,
    pendingApprovals,
    pendingClaimLinks,
    claimedWaitingApproval,
    completedToday: completedTodayItems.length,
    preparedTodayUsdc: baseUnitsToUsdc(BigInt(preparedTodayUsdc)),
    completedTodayUsdc: baseUnitsToUsdc(completedTodayUsdc),
    failedOrUnknown,
    activeMembers: members.length,
    recipientCount: recipients.length,
    recentAuditEvents: recentAuditEvents.map(buildAuditView),
    recentAgentRuns: recentAgentRuns.map(buildAgentRunView),
    claimCountCapped: claims.length >= DASHBOARD_MAX_LIMIT,
    computedAt: ctx.nowIso,
  };
}
