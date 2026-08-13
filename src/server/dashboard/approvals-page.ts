import { getEffectiveClaimStatus } from "../claim/status.ts";
import type { SolvoRepository } from "../db/repository.ts";
import { canViewDashboard, maskIdentity } from "./access.ts";
import { buildClaimListItemView } from "./claims.ts";
import { shortClaimId } from "./claims-page.ts";
import { buildPayoutItemView, buildPayoutListItemView, isBatchSource, requesterLabelMap } from "./payouts.ts";
import { payoutListSourceLabel, shortPayoutId } from "./payouts-page.ts";
import type { PayoutItemView } from "./types.ts";
import type { DashboardContext } from "./types.ts";

/**
 * M12.10 — Approvals page model (server side, no React).
 *
 * Read-only decision queue: pending single payouts, pending batch payouts,
 * and claimed claim links awaiting approval. Built directly from the
 * workspace-scoped repo reads through the existing M12.2 pure mappers —
 * effective claim statuses use the M11.2 rules (claimed preserved, expiry
 * computed, approved/completed never queued), and nothing here can approve,
 * reject, execute, or reissue. No action surface exists in this module or
 * its page.
 */

const FAILED_OR_UNKNOWN = new Set(["validation_failed", "simulation_failed", "execution_failed", "execution_unknown"]);

// ── Role capability (display only) ─────────────────────────────────────────

export type ApprovalCapability = {
  canActLater: boolean;
  copy: string;
};

export function approvalCapability(role: DashboardContext["role"]): ApprovalCapability {
  switch (role) {
    case "owner":
    case "approver":
      return { canActLater: true, copy: "You may approve eligible requests later." };
    case "member":
      return { canActLater: false, copy: "Members can view this queue but cannot approve." };
    default:
      return { canActLater: false, copy: "View only." };
  }
}

/** Separation-of-duty note shown when the current user requested the row. */
export function selfRequesterNote(kind: "payout" | "claim"): string {
  return kind === "payout"
    ? "You requested this payout. You cannot approve it."
    : "You requested this claim. You cannot approve the claimed destination.";
}

// ── Queue row shapes ───────────────────────────────────────────────────────

export type PendingPayoutItem = {
  payoutId: string;
  shortId: string;
  sourceLabel: string;
  requesterLabel: string | null;
  requesterIsSelf: boolean;
  totalUsdc: string;
  currency: string;
  itemCount: number;
  createdAt: string;
  isBatch: boolean;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
};

export type PendingClaimItem = {
  claimId: string;
  shortId: string;
  amountUsdc: string;
  currency: string;
  network: string;
  expiresAt: string;
  maskedWallet: string | null;
  requesterLabel: string | null;
  requesterIsSelf: boolean;
  payoutId: string | null;
  createdAt: string;
};

export type ApprovalsPageModel =
  | {
      ok: true;
      capability: ApprovalCapability;
      payouts: PendingPayoutItem[];
      batches: PendingPayoutItem[];
      claims: PendingClaimItem[];
      empty: boolean;
    }
  | { ok: false };

export async function buildApprovalsPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<ApprovalsPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };

  const payouts = await repo.listPayoutsByWorkspace(ctx.workspaceId, { status: "pending_approval" });
  const payoutItems = await repo.listPayoutItemsByPayoutIds(
    ctx.workspaceId,
    payouts.map((payout) => payout.id),
  );
  const claims = await repo.listClaimLinksByWorkspace(ctx.workspaceId);
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labels = requesterLabelMap(members.map((member) => member.telegram_user_id));

  const itemsByPayout = new Map<string, PayoutItemView[]>();
  for (const item of payoutItems) {
    const views = itemsByPayout.get(item.payout_id) ?? [];
    views.push(buildPayoutItemView(item, ctx, false));
    itemsByPayout.set(item.payout_id, views);
  }

  const pending: PendingPayoutItem[] = [];
  for (const payout of payouts) {
    const itemViews = itemsByPayout.get(payout.id) ?? [];
    const view = buildPayoutListItemView(
      payout,
      itemViews.length,
      payout.requester_id !== null ? labels.get(payout.requester_id) ?? maskIdentity(payout.requester_id) : null,
    );
    pending.push({
      payoutId: payout.id,
      shortId: shortPayoutId(payout.id),
      sourceLabel: payoutListSourceLabel(payout.source_type),
      requesterLabel: view.requesterLabel,
      requesterIsSelf: payout.requester_id !== null && payout.requester_id === ctx.telegramUserId,
      totalUsdc: view.totalUsdc,
      currency: view.currency,
      itemCount: view.itemCount,
      createdAt: view.createdAt,
      isBatch: isBatchSource(payout.source_type),
      completedCount: itemViews.filter((item) => item.state === "completed").length,
      pendingCount: itemViews.filter((item) => item.state === "pending_approval").length,
      failedCount: itemViews.filter((item) => FAILED_OR_UNKNOWN.has(item.state)).length,
    });
  }

  const claimed: PendingClaimItem[] = [];
  for (const claim of claims) {
    if (getEffectiveClaimStatus(claim, ctx.nowIso) !== "claimed") continue;
    const view = buildClaimListItemView(
      claim,
      ctx.nowIso,
      claim.requester_id !== null ? labels.get(claim.requester_id) ?? null : null,
    );
    claimed.push({
      claimId: claim.id,
      shortId: shortClaimId(claim.id),
      amountUsdc: view.amountUsdc,
      currency: view.currency,
      network: view.network,
      expiresAt: view.expiresAt,
      maskedWallet: view.maskedWallet,
      requesterLabel: view.requesterLabel,
      requesterIsSelf: claim.requester_id !== null && claim.requester_id === ctx.telegramUserId,
      payoutId: view.payoutId,
      createdAt: view.createdAt,
    });
  }

  const payoutsQueue = pending.filter((item) => !item.isBatch);
  const batchesQueue = pending.filter((item) => item.isBatch);
  return {
    ok: true,
    capability: approvalCapability(ctx.role),
    payouts: payoutsQueue,
    batches: batchesQueue,
    claims: claimed,
    empty: payoutsQueue.length === 0 && batchesQueue.length === 0 && claimed.length === 0,
  };
}
