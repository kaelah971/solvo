import type { SolvoRepository, ListPayoutsOptions } from "../db/repository.ts";
import { DASHBOARD_MAX_LIMIT } from "../db/repository.ts";
import type { PayoutItemRow, PayoutRow, PayoutSourceType } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { getEffectiveClaimStatus, maskClaimWallet } from "../claim/status.ts";
import { canViewSensitiveDestinations, maskIdentity } from "./access.ts";
import { buildAuditView } from "./audit.ts";
import type {
  ApproverSummary,
  DashboardContext,
  PayoutDetailView,
  PayoutItemView,
  PayoutListItemView,
} from "./types.ts";

/**
 * M12.2 — Payout read model.
 *
 * List/detail views for payouts and payout items. Truth rules:
 *  - state, totals, recipients, timestamps come from payout/payout_item rows;
 *  - tx proof (hash + explorer) appears ONLY on completed items that carry a
 *    transaction hash — nothing else can produce it;
 *  - KeeperHub execution ids are never exposed;
 *  - claim-linked items never re-show their memo (claim memos carry token
 *    prefixes); the linked claim is surfaced instead;
 *  - full destinations are owner/approver-only; members see masked wallets;
 *  - everything is scoped to the operator's workspace.
 */

export const PAYOUT_SOURCE_LABELS: Record<PayoutSourceType, string> = {
  direct: "Direct",
  claim_link: "Claim link",
  batch_csv: "Batch (command)",
  m1_proof: "M1 proof import",
  telegram_command: "Telegram command",
  telegram_natural_language: "Telegram NL payment",
  telegram_batch: "Batch (Telegram)",
  judge_telegram: "Judge",
};

export function payoutSourceLabel(sourceType: PayoutSourceType): string {
  return PAYOUT_SOURCE_LABELS[sourceType] ?? sourceType;
}

/** Batches = the M5/M10 batch sources (command + NL). */
export function isBatchSource(sourceType: PayoutSourceType): boolean {
  return sourceType === "telegram_batch" || sourceType === "batch_csv";
}

/** Truthful display label for a payout/payout-item state. */
export function payoutStateLabel(state: string): string {
  switch (state) {
    case "draft":
    case "validated":
      return "Prepared";
    case "pending_approval":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    case "simulating":
      return "Simulating";
    case "submitted":
      return "Executing";
    case "confirming":
      return "Confirming";
    case "completed":
      return "Completed";
    case "validation_failed":
    case "simulation_failed":
    case "execution_failed":
      return "Failed";
    case "retrying":
      return "Retrying";
    case "execution_unknown":
      return "Unknown";
    case "cancelled":
      return "Cancelled";
    case "partially_completed":
      return "Partially completed";
    default:
      return state;
  }
}

/** Mask a wallet for member-level views (same 6+4 shape as claim views). */
export function maskWallet(address: string): string {
  return maskClaimWallet(address);
}

function memberLabel(members: Map<string, string>, telegramUserId: string | null): string | null {
  if (telegramUserId === null) return null;
  const known = members.get(telegramUserId);
  return known ?? maskIdentity(telegramUserId);
}

/** Build the requester label map once per read. */
export function requesterLabelMap(memberTelegramIds: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of memberTelegramIds) map.set(id, maskIdentity(id) ?? "…");
  return map;
}

export function buildPayoutItemView(
  item: PayoutItemRow,
  ctx: DashboardContext,
  isClaimSource: boolean,
): PayoutItemView {
  const completed =
    item.status === "completed" && item.transaction_hash !== null && item.transaction_hash.length > 0;
  return {
    itemId: item.id,
    recipient: canViewSensitiveDestinations(ctx) ? item.recipient_address : maskWallet(item.recipient_address),
    memo: isClaimSource ? null : item.memo,
    amountUsdc: baseUnitsToUsdc(BigInt(item.amount_base_units)),
    state: item.status,
    stateLabel: payoutStateLabel(item.status),
    createdAt: item.created_at,
    completedAt: item.completed_at,
    txHash: completed ? item.transaction_hash : null,
    txExplorerUrl: completed ? item.transaction_explorer_url : null,
  };
}

export function buildPayoutListItemView(
  payout: PayoutRow,
  itemCount: number,
  requesterLabel: string | null,
): PayoutListItemView {
  return {
    payoutId: payout.id,
    sourceType: payout.source_type,
    sourceLabel: payoutSourceLabel(payout.source_type),
    state: payout.status,
    stateLabel: payoutStateLabel(payout.status),
    isBatch: isBatchSource(payout.source_type),
    totalUsdc: baseUnitsToUsdc(BigInt(payout.total_amount_base_units)),
    currency: payout.currency_symbol,
    itemCount,
    requesterLabel,
    createdAt: payout.created_at,
    updatedAt: payout.updated_at,
    approvedAt: payout.approved_at,
    completedAt: payout.completed_at,
    cancelledAt: payout.cancelled_at,
    claimId: null,
  };
}

export type ListPayoutViewsOptions = ListPayoutsOptions;

/**
 * Read service: workspace-scoped payout list, newest first, with item counts
 * and requester labels. Never reads another workspace's rows.
 */
export async function listPayoutViews(
  repo: SolvoRepository,
  ctx: DashboardContext,
  options: ListPayoutViewsOptions = {},
): Promise<PayoutListItemView[]> {
  const payouts = await repo.listPayoutsByWorkspace(ctx.workspaceId, options);
  if (payouts.length === 0) return [];
  const items = await repo.listPayoutItemsByPayoutIds(
    ctx.workspaceId,
    payouts.map((payout) => payout.id),
  );
  const countByPayout = new Map<string, number>();
  for (const item of items) {
    countByPayout.set(item.payout_id, (countByPayout.get(item.payout_id) ?? 0) + 1);
  }
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labels = requesterLabelMap(members.map((member) => member.telegram_user_id));
  return payouts.map((payout) =>
    buildPayoutListItemView(payout, countByPayout.get(payout.id) ?? 0, memberLabel(labels, payout.requester_id)),
  );
}

export type PayoutDetailResult = PayoutDetailView | null;

/**
 * Read service: one payout's full detail. Returns null for unknown or
 * cross-workspace payout ids (no existence leak).
 */
export async function getPayoutDetailView(
  repo: SolvoRepository,
  ctx: DashboardContext,
  payoutId: string,
): Promise<PayoutDetailResult> {
  const payout = await repo.getPayoutById(payoutId);
  if (payout === null || payout.workspace_id !== ctx.workspaceId) return null;

  const items = await repo.listPayoutItemsByPayoutIds(ctx.workspaceId, [payout.id]);
  const audits = await repo.listAuditEventsByWorkspace(ctx.workspaceId, {
    payoutId: payout.id,
    limit: DASHBOARD_MAX_LIMIT,
  });
  const claim = await repo.getClaimLinkByPayoutId(payout.id);

  const isClaimSource = payout.source_type === "claim_link";
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labels = requesterLabelMap(members.map((member) => member.telegram_user_id));

  const base = buildPayoutListItemView(payout, items.length, memberLabel(labels, payout.requester_id));
  base.claimId = claim !== null ? claim.id : null;

  const decision = latestDecision(audits);
  const linkedClaim =
    claim !== null
      ? { claimId: claim.id, effectiveStatus: getEffectiveClaimStatus(claim, ctx.nowIso) }
      : null;

  return {
    ...base,
    items: items.map((item) => buildPayoutItemView(item, ctx, isClaimSource)),
    decision,
    auditTimeline: audits.map(buildAuditView),
    linkedClaim,
  };
}

function latestDecision(
  audits: Awaited<ReturnType<SolvoRepository["listAuditEventsByWorkspace"]>>,
): ApproverSummary {
  const decisions = audits
    .filter((event) => event.event_type === "approval_granted" || event.event_type === "approval_rejected")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const latest = decisions[decisions.length - 1];
  if (!latest) return null;
  return { role: latest.actor_type, maskedId: maskIdentity(latest.actor_id) ?? "…" };
}
