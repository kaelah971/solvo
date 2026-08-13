import type { ListPayoutsOptions, SolvoRepository } from "../db/repository.ts";
import type { DashboardContext, PayoutDetailView, PayoutItemView, PayoutListItemView } from "./types.ts";
import { canViewDashboard, maskIdentity } from "./access.ts";
import {
  buildPayoutItemView,
  getPayoutDetailView,
  isBatchSource,
  listPayoutViews,
} from "./payouts.ts";

/**
 * M12.5 — Payout and batch page models (server side, no React).
 *
 * Gated wrappers over the M12.2 payout read model: every builder returns the
 * single generic `{ ok: false }` for non-members / inactive members / missing
 * workspace, and every list/detail read is scoped to the operator's
 * workspace. Proof rules are inherited from the read model (tx hash ONLY on
 * completed items that carry one). Page-level display labels and the
 * truthful proof-status chip live here so page files stay copy-safe.
 */

// ── Display labels (operator-safe; no internal terms) ──────────────────────

/** User-safe source label for list pages. */
export function payoutListSourceLabel(sourceType: PayoutListItemView["sourceType"]): string {
  switch (sourceType) {
    case "telegram_command":
      return "Telegram payment";
    case "telegram_natural_language":
      return "Natural-language payment";
    case "telegram_batch":
    case "batch_csv":
      return "Batch payout";
    case "claim_link":
      return "Claim link";
    case "judge_telegram":
      return "Judge mode";
    case "m1_proof":
      return "Proof import";
    case "direct":
      return "Direct";
    default:
      return "Unknown source";
  }
}

export type PayoutProofStatus =
  | { kind: "completed_with_proof"; label: "Completed with proof" }
  | { kind: "completed_without_proof"; label: "Completed without visible proof" }
  | { kind: "pending_approval"; label: "Pending approval" }
  | { kind: "approved_not_executed"; label: "Approved but not executed" }
  | { kind: "in_flight"; label: "Executing" }
  | { kind: "failed_or_unknown"; label: "Failed or unknown" }
  | { kind: "cancelled"; label: "Cancelled" }
  | { kind: "partial"; label: "Partially completed" };

const COMPLETED = "completed";
const FAILED_OR_UNKNOWN = new Set(["validation_failed", "simulation_failed", "execution_failed", "execution_unknown"]);
const IN_FLIGHT = new Set(["approved", "simulating", "submitted", "confirming", "retrying"]);
const PENDING = "pending_approval";

/**
 * Truthful proof-status chip for one payout.
 *
 *  - "Completed with proof" requires EVERY item completed AND the payout
 *    completed AND every completed item carrying a transaction hash;
 *  - a completed payout whose items lack hashes is "Completed without
 *    visible proof" — never proof;
 *  - failed/unknown items win over in-flight/pending so operators see the
 *    worst truth;
 *  - nothing here ever fabricates a hash.
 */
export function payoutProofStatus(payout: PayoutListItemView, items: readonly PayoutItemView[]): PayoutProofStatus {
  if (payout.state === "cancelled") return { kind: "cancelled", label: "Cancelled" };

  const failed = items.filter((item) => FAILED_OR_UNKNOWN.has(item.state));
  const inFlight = items.filter((item) => IN_FLIGHT.has(item.state));
  const completed = items.filter((item) => item.state === COMPLETED);
  const pending = items.filter((item) => item.state === PENDING);

  if (failed.length > 0) return { kind: "failed_or_unknown", label: "Failed or unknown" };

  // Mixed legs (some completed, some not) read as partial — never "done".
  if (completed.length > 0 && completed.length < items.length) {
    return { kind: "partial", label: "Partially completed" };
  }

  if (items.length > 0 && completed.length === items.length) {
    if (payout.state === COMPLETED) {
      const allWithProof = completed.every((item) => item.txHash !== null);
      return allWithProof
        ? { kind: "completed_with_proof", label: "Completed with proof" }
        : { kind: "completed_without_proof", label: "Completed without visible proof" };
    }
    return { kind: "partial", label: "Partially completed" };
  }

  if (inFlight.length > 0) return { kind: "in_flight", label: "Executing" };

  if (items.length > 0 && pending.length === items.length) {
    return { kind: "pending_approval", label: "Pending approval" };
  }
  if (pending.length > 0) return { kind: "pending_approval", label: "Pending approval" };
  if (items.length === 0) return { kind: "approved_not_executed", label: "Approved but not executed" };

  return { kind: "partial", label: "Partially completed" };
}

/** Short display id (first 8 chars) for list rows. */
export function shortPayoutId(payoutId: string): string {
  return payoutId.slice(0, 8);
}

// ── Page models ────────────────────────────────────────────────────────────

export type PayoutListPageItem = {
  view: PayoutListItemView;
  sourceLabel: string;
  proofStatus: PayoutProofStatus;
  decisionLabel: string | null;
  shortId: string;
};

export type PayoutListPageModel =
  | { ok: true; items: PayoutListPageItem[]; empty: boolean }
  | { ok: false };

export async function buildPayoutListPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
  options: Pick<ListPayoutsOptions, "status" | "sourceType"> = {},
): Promise<PayoutListPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const views = await listPayoutViews(repo, ctx, options);
  if (views.length === 0) return { ok: true, items: [], empty: true };

  const items = await repo.listPayoutItemsByPayoutIds(
    ctx.workspaceId,
    views.map((view) => view.payoutId),
  );
  const itemViews = groupItemViews(items, ctx);
  const audits = await repo.listAuditEventsByWorkspace(ctx.workspaceId, {
    payoutIds: views.map((view) => view.payoutId),
  });
  const decisionByPayout = new Map<string, string | null>();
  for (const payoutId of views.map((view) => view.payoutId)) {
    decisionByPayout.set(payoutId, latestDecisionLabel(audits.filter((event) => event.payout_id === payoutId)));
  }

  const pageItems: PayoutListPageItem[] = views.map((view) => ({
    view,
    sourceLabel: payoutListSourceLabel(view.sourceType),
    proofStatus: payoutProofStatus(view, itemViews.get(view.payoutId) ?? []),
    decisionLabel: decisionByPayout.get(view.payoutId) ?? null,
    shortId: shortPayoutId(view.payoutId),
  }));
  return { ok: true, items: pageItems, empty: false };
}

export type PayoutDetailPageModel =
  | { ok: true; detail: PayoutDetailView }
  | { ok: false };

export async function buildPayoutDetailPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
  payoutId: string,
): Promise<PayoutDetailPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const detail = await getPayoutDetailView(repo, ctx, payoutId);
  if (detail === null) return { ok: false };
  return { ok: true, detail };
}

// ── Batches ────────────────────────────────────────────────────────────────

export type BatchListPageItem = {
  view: PayoutListItemView;
  shortId: string;
  completedCount: number;
  failedCount: number;
  pendingCount: number;
  proofStatus: PayoutProofStatus;
};

export type BatchListPageModel =
  | { ok: true; items: BatchListPageItem[]; empty: boolean }
  | { ok: false };

export async function buildBatchListPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<BatchListPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const views = await listPayoutViews(repo, ctx);
  const batches = views.filter((view) => isBatchSource(view.sourceType));
  if (batches.length === 0) return { ok: true, items: [], empty: true };

  const items = await repo.listPayoutItemsByPayoutIds(
    ctx.workspaceId,
    batches.map((view) => view.payoutId),
  );
  const itemViews = groupItemViews(items, ctx);

  const pageItems: BatchListPageItem[] = batches.map((view) => {
    const itemsFor = itemViews.get(view.payoutId) ?? [];
    return {
      view,
      shortId: shortPayoutId(view.payoutId),
      completedCount: itemsFor.filter((item) => item.state === "completed").length,
      failedCount: itemsFor.filter((item) => FAILED_OR_UNKNOWN.has(item.state)).length,
      pendingCount: itemsFor.filter((item) => item.state === "pending_approval").length,
      proofStatus: payoutProofStatus(view, itemsFor),
    };
  });
  return { ok: true, items: pageItems, empty: false };
}

export type BatchDetailPageModel = PayoutDetailPageModel;

/** Batch detail: identical to payout detail, but ONLY batch sources qualify. */
export async function buildBatchDetailPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
  payoutId: string,
): Promise<BatchDetailPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const detail = await getPayoutDetailView(repo, ctx, payoutId);
  if (detail === null || !isBatchSource(detail.sourceType)) return { ok: false };
  return { ok: true, detail };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function groupItemViews(
  items: Awaited<ReturnType<SolvoRepository["listPayoutItemsByPayoutIds"]>>,
  ctx: DashboardContext,
): Map<string, PayoutItemView[]> {
  const grouped = new Map<string, PayoutItemView[]>();
  for (const item of items) {
    const views = grouped.get(item.payout_id) ?? [];
    views.push(buildPayoutItemView(item, ctx, false));
    grouped.set(item.payout_id, views);
  }
  return grouped;
}

/** Latest approval/rejection label for one payout's audit events. */
export function latestDecisionLabel(
  audits: readonly { event_type: string; actor_type: string; actor_id: string | null; created_at: string }[],
): string | null {
  const decisions = audits
    .filter((event) => event.event_type === "approval_granted" || event.event_type === "approval_rejected")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const latest = decisions[decisions.length - 1];
  if (!latest) return null;
  const actor = maskIdentity(latest.actor_id) ?? "member";
  const verb = latest.event_type === "approval_rejected" ? "Rejected" : "Approved";
  return `${verb} by ${actor}`;
}
