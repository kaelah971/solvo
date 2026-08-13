import type { SolvoRepository } from "../db/repository.ts";
import { DASHBOARD_MAX_LIMIT } from "../db/repository.ts";
import type { ClaimLinkRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { buildClaimStatusView, getEffectiveClaimStatus, maskClaimWallet } from "../claim/status.ts";
import { canReissueClaim, maskIdentity } from "./access.ts";
import { buildAuditView } from "./audit.ts";
import type {
  ClaimDetailView,
  ClaimListItemView,
  ClaimStatusBucket,
  DashboardContext,
} from "./types.ts";

/**
 * M12.2 — Claim read model.
 *
 * Uses the M11.2 claim status rules: effective status (computed expiry),
 * masked wallets, and pipeline-only proof. Claims never expose the raw
 * token, the token hash, or the token prefix, and never reconstruct links.
 * Reissue eligibility = role gate (owner/approver) + state gate
 * (pending/expired/rejected only — M11.5).
 */

function networkLabel(chainId: string): string {
  return chainId === "8453" ? "BASE" : chainId;
}

/** State eligibility for reissue (M11.5: created incl. expired, or cancelled). */
export function claimReissueEligibility(claim: ClaimLinkRow, ctx: DashboardContext): {
  eligible: boolean;
  reason: string | null;
} {
  if (!canReissueClaim(ctx)) {
    return { eligible: false, reason: "Only an active owner or approver can reissue a claim link." };
  }
  if (claim.status !== "created" && claim.status !== "cancelled") {
    return {
      eligible: false,
      reason: "This claim cannot be reissued because it was already claimed or approved.",
    };
  }
  return { eligible: true, reason: null };
}

export function buildClaimListItemView(
  claim: ClaimLinkRow,
  nowIso: string,
  requesterLabel: string | null,
): ClaimListItemView {
  return {
    claimId: claim.id,
    effectiveStatus: getEffectiveClaimStatus(claim, nowIso),
    storedStatus: claim.status,
    amountUsdc: baseUnitsToUsdc(BigInt(claim.amount_base_units)),
    currency: claim.currency_symbol,
    network: networkLabel(claim.chain_id),
    expiresAt: claim.expires_at,
    maskedWallet: claim.claimed_recipient !== null ? maskClaimWallet(claim.claimed_recipient) : null,
    payoutId: claim.payout_id,
    requesterLabel,
    createdAt: claim.created_at,
  };
}

export type ListClaimViewsOptions = {
  status?: ClaimStatusBucket | readonly ClaimStatusBucket[];
  before?: string;
  beforeId?: string;
  limit?: number;
};

/**
 * Read service: workspace-scoped claim list, newest first. Optional filter by
 * EFFECTIVE status (a `created` claim past its deadline filters as `expired`,
 * never as `pending`).
 */
export async function listClaimViews(
  repo: SolvoRepository,
  ctx: DashboardContext,
  options: ListClaimViewsOptions = {},
): Promise<{ views: ClaimListItemView[]; capped: boolean }> {
  const wanted = options.status === undefined ? null : toList(options.status);
  const claims = await repo.listClaimLinksByWorkspace(ctx.workspaceId, {
    before: options.before,
    beforeId: options.beforeId,
    limit: options.limit,
  });
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labelById = new Map<string, string>();
  for (const member of members) labelById.set(member.telegram_user_id, maskIdentity(member.telegram_user_id) ?? "…");

  const views: ClaimListItemView[] = [];
  for (const claim of claims) {
    const view = buildClaimListItemView(claim, ctx.nowIso, claim.requester_id !== null ? labelById.get(claim.requester_id) ?? null : null);
    if (wanted !== null && !wanted.includes(view.effectiveStatus)) continue;
    views.push(view);
  }
  const capped = claims.length >= (options.limit ?? 50);
  return { views, capped };
}

export type ClaimDetailResult = ClaimDetailView | null;

/**
 * Read service: one claim's detail. Returns null for unknown or
 * cross-workspace claim ids (no existence leak). Proof comes only from the
 * M11.2 status view (pipeline), never from the claim row or agent_runs.
 */
export async function getClaimDetailView(
  repo: SolvoRepository,
  ctx: DashboardContext,
  claimId: string,
): Promise<ClaimDetailResult> {
  const claim = await repo.getClaimLinkById(claimId);
  if (claim === null || claim.workspace_id !== ctx.workspaceId) return null;

  let payout: Awaited<ReturnType<SolvoRepository["getPayoutById"]>> = null;
  let items: Awaited<ReturnType<SolvoRepository["getPayoutItemsByPayoutId"]>> = [];
  if (claim.payout_id !== null) {
    payout = await repo.getPayoutById(claim.payout_id);
    items = payout !== null ? await repo.getPayoutItemsByPayoutId(payout.id) : [];
  }
  const audits = await repo.listAuditEventsByWorkspace(ctx.workspaceId, {
    claimId: claim.id,
    limit: DASHBOARD_MAX_LIMIT,
  });
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labelById = new Map(members.map((member) => [member.telegram_user_id, maskIdentity(member.telegram_user_id) ?? "…"]));

  const statusView = buildClaimStatusView({ claim, nowIso: ctx.nowIso, payout, items });
  const reissue = claimReissueEligibility(claim, ctx);

  return {
    ...buildClaimListItemView(claim, ctx.nowIso, claim.requester_id !== null ? labelById.get(claim.requester_id) ?? null : null),
    // The pipeline-upgraded status is authoritative: a stored `executed`
    // claim whose pipeline confirms completion reads `completed` here even
    // though the claim row itself still says `executed`.
    effectiveStatus: statusView.effectiveStatus,
    statusView: {
      payoutState: statusView.payoutState,
      itemCount: statusView.itemCount,
      claimedAt: statusView.claimedAt,
      txHash: statusView.txHash,
      txExplorerUrl: statusView.txExplorerUrl,
      safetyNote: statusView.safetyNote,
    },
    auditTimeline: audits.map(buildAuditView),
    reissueEligible: reissue.eligible,
    reissueIneligibleReason: reissue.reason,
  };
}

function toList<T>(value: T | readonly T[]): T[] {
  return (Array.isArray(value) ? [...value] : [value]) as T[];
}
