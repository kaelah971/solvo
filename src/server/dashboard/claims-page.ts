import type { SolvoRepository } from "../db/repository.ts";
import { canReissueClaim, canViewDashboard } from "./access.ts";
import { getClaimDetailView, listClaimViews } from "./claims.ts";
import type { ClaimDetailView, ClaimListItemView, ClaimStatusBucket, DashboardContext } from "./types.ts";

/**
 * M12.6 — Claim page models (server side, no React).
 *
 * Gated wrappers over the M12.2 claim read model: every builder returns the
 * single generic `{ ok: false }` for non-members / inactive members / missing
 * workspace, and every read is scoped to the operator's workspace. Effective
 * statuses follow the M11.2 rules (expiry computed, claimed preserved,
 * approved never reads as paid, completed ONLY when the linked pipeline has
 * a completed item carrying a transaction hash, not-confirmed never shows
 * proof). Reissue eligibility is DISPLAY ONLY — no action, form, or server
 * action exists anywhere in this module or its pages.
 */

// ── Display labels (operator-safe; no internal terms) ──────────────────────

/** User-safe effective status label. */
export function claimStatusLabel(status: ClaimStatusBucket): string {
  switch (status) {
    case "pending":
      return "Pending / Unclaimed";
    case "claimed":
      return "Claimed, waiting approval";
    case "expired":
      return "Expired";
    case "rejected":
      return "Rejected / Cancelled";
    case "approved":
      return "Approved / Payment prepared";
    case "completed":
      return "Completed";
    case "unknown":
      return "Not confirmed";
  }
}

/** Truthful proof chip: pipeline truth only, never invented. */
export function claimProofLabel(status: ClaimStatusBucket, hasTxProof: boolean): string {
  switch (status) {
    case "completed":
      return hasTxProof ? "Completed with proof" : "Completed without visible proof";
    case "approved":
      return "Payment prepared";
    case "claimed":
      return "Waiting for approval";
    case "pending":
      return "Awaiting wallet";
    case "expired":
      return "Expired";
    case "rejected":
      return "Rejected";
    case "unknown":
      return "Not confirmed";
  }
}

/** Short display id (first 8 chars) for list rows. */
export function shortClaimId(claimId: string): string {
  return claimId.slice(0, 8);
}

// ── Reissue eligibility (display only) ─────────────────────────────────────

export type ReissueEligibilityDisplay = {
  eligible: boolean;
  label: "Eligible to reissue" | "Not eligible to reissue";
  reason: string | null;
};

/**
 * Reissue ELIGIBILITY DISPLAY ONLY. Mirrors the M11.5 rules: role gate
 * (active owner/approver) + state gate (stored `created`, incl. computed
 * expired, or `cancelled`). Nothing here reissues; pages render the label
 * and a note that the action is not wired yet.
 */
export function reissueEligibilityDisplay(ctx: DashboardContext, storedStatus: string): ReissueEligibilityDisplay {
  if (!canReissueClaim(ctx)) {
    return {
      eligible: false,
      label: "Not eligible to reissue",
      reason: "Only an active owner or approver can reissue a claim link.",
    };
  }
  if (storedStatus !== "created" && storedStatus !== "cancelled") {
    return {
      eligible: false,
      label: "Not eligible to reissue",
      reason: "This claim cannot be reissued because it was already claimed or approved.",
    };
  }
  return { eligible: true, label: "Eligible to reissue", reason: null };
}

// ── Pipeline enrichment for the list ───────────────────────────────────────

type PipelineInfo = {
  payoutState: string | null;
  hasTxProof: boolean;
};

/**
 * Load the linked payout pipeline for claim list rows (payout state + proof
 * presence). Payouts are looked up through the repository by id — the read
 * model never reconstructs links or exposes token material.
 */
async function pipelineInfoFor(
  repo: SolvoRepository,
  views: readonly ClaimListItemView[],
): Promise<Map<string, PipelineInfo>> {
  const infoByClaim = new Map<string, PipelineInfo>();
  const claimByPayout = new Map<string, string>();
  for (const view of views) {
    if (view.payoutId !== null) claimByPayout.set(view.payoutId, view.claimId);
  }
  for (const payoutId of claimByPayout.keys()) {
    const payout = await repo.getPayoutById(payoutId);
    const claimId = claimByPayout.get(payoutId);
    if (payout === null || claimId === undefined) continue;
    let hasTxProof = false;
    if (payout.status === "completed") {
      const items = await repo.getPayoutItemsByPayoutId(payout.id);
      hasTxProof = items.some(
        (item) => item.status === "completed" && item.transaction_hash !== null && item.transaction_hash.length > 0,
      );
    }
    infoByClaim.set(claimId, { payoutState: payout.status, hasTxProof });
  }
  return infoByClaim;
}

// ── List page model ────────────────────────────────────────────────────────

export type ClaimListPageItem = {
  view: ClaimListItemView;
  /** Pipeline-upgraded effective status (stored `executed` + pipeline proof reads `completed`). */
  effectiveStatus: ClaimStatusBucket;
  statusLabel: string;
  proofLabel: string;
  shortId: string;
  payoutState: string | null;
  reissue: ReissueEligibilityDisplay;
};

export type ClaimListPageModel =
  | { ok: true; items: ClaimListPageItem[]; empty: boolean }
  | { ok: false };

export async function buildClaimListPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<ClaimListPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const { views } = await listClaimViews(repo, ctx);
  if (views.length === 0) return { ok: true, items: [], empty: true };

  const pipeline = await pipelineInfoFor(repo, views);

  const items: ClaimListPageItem[] = views.map((view) => {
    const info = pipeline.get(view.claimId);
    // M11.2 upgrade: completion requires the linked payout pipeline to have
    // recorded a completed item WITH a transaction hash. Nothing else can
    // read as completed.
    const effectiveStatus: ClaimStatusBucket = info?.hasTxProof === true ? "completed" : view.effectiveStatus;
    return {
      view,
      effectiveStatus,
      statusLabel: claimStatusLabel(effectiveStatus),
      proofLabel: claimProofLabel(effectiveStatus, info?.hasTxProof === true),
      shortId: shortClaimId(view.claimId),
      payoutState: info?.payoutState ?? null,
      reissue: reissueEligibilityDisplay(ctx, view.storedStatus),
    };
  });
  return { ok: true, items, empty: false };
}

// ── Detail page model ──────────────────────────────────────────────────────

export type ClaimDetailPageModel =
  | {
      ok: true;
      detail: ClaimDetailView;
      statusLabel: string;
      proofLabel: string;
      shortId: string;
      reissue: ReissueEligibilityDisplay;
    }
  | { ok: false };

export async function buildClaimDetailPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
  claimId: string,
): Promise<ClaimDetailPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const detail = await getClaimDetailView(repo, ctx, claimId);
  if (detail === null) return { ok: false };
  const hasTxProof = detail.statusView.txHash !== null && detail.statusView.txExplorerUrl !== null;
  return {
    ok: true,
    detail,
    statusLabel: claimStatusLabel(detail.effectiveStatus),
    proofLabel: claimProofLabel(detail.effectiveStatus, hasTxProof),
    shortId: shortClaimId(detail.claimId),
    reissue: reissueEligibilityDisplay(ctx, detail.storedStatus),
  };
}
