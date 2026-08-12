import type { SolvoRepository } from "../db/repository.ts";
import type { ClaimLinkRow, ClaimStatus, PayoutItemRow, PayoutRow, WorkspaceMemberRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";

/**
 * M11.2 — Claim status read model (read-only).
 *
 * A pure, no-mutation summary of a claim link's CURRENT effective state. It
 * never creates payouts, claims, audits, or execution rows, never calls
 * KeeperHub or any provider, and never reads agent_runs. Completion/proof
 * language comes ONLY from the payout pipeline (payout + payout_items):
 * the claim row itself can never manufacture a transaction hash.
 *
 * Effective vocabulary (design doc §5):
 *   pending    claim created, not expired, no wallet yet
 *   claimed    wallet recorded, awaiting approval; wallet entry moved nothing
 *   approved   payout/payment-prepared exists; no proof yet
 *   rejected   claim cancelled; nothing moved
 *   expired    computed only (created claim past expires_at), never persisted
 *   completed  payout pipeline confirms completion AND a completed item holds
 *              a transaction hash
 *   unknown    the claim row cannot be truthfully summarized (e.g. a stored
 *              `executed` claim whose pipeline does not confirm completion)
 *
 * Expiry follows the existing claim contract (`effectiveClaimStatus` in
 * claim/service.ts): only a `created` claim past its deadline reads as
 * expired; an already claimed/approved/executed/cancelled claim keeps its
 * state.
 */

export type ClaimEffectiveStatus =
  | "pending"
  | "claimed"
  | "approved"
  | "rejected"
  | "expired"
  | "completed"
  | "unknown";

export type ClaimStatusView = {
  claimId: string;
  effectiveStatus: ClaimEffectiveStatus;
  /** Honest stored claim row status (`created|claimed|approved|executed|cancelled`). */
  storedStatus: ClaimStatus;
  /** Display amount in whole/decimal token units, e.g. "0.005". */
  amount: string;
  amountBaseUnits: string;
  currency: string;
  chainId: string;
  /** Display network label; Solvo claims are Base USDC only. */
  network: string;
  expiresAt: string;
  claimedAt: string | null;
  /** Masked destination wallet (first 6 + last 4 chars). */
  claimedWallet: string | null;
  payoutId: string | null;
  /** Raw payout pipeline state when a payout is linked, else null. */
  payoutState: string | null;
  /** Number of payout items under the linked payout, else null. */
  itemCount: number | null;
  /**
   * Transaction hash ONLY when effectiveStatus is `completed`, and ONLY from
   * the payout item row. Never from the claim row or agent_runs.
   */
  txHash: string | null;
  txExplorerUrl: string | null;
  /** Truthful no-funds-moved / next-step copy hint. */
  safetyNote: string;
};

export type BuildClaimStatusViewInput = {
  claim: ClaimLinkRow;
  nowIso: string;
  payout: PayoutRow | null;
  items: PayoutItemRow[];
};

export type GetClaimStatusForMemberInput = {
  repo: SolvoRepository;
  workspaceId: string;
  member: WorkspaceMemberRow | null;
  claimId: string;
  nowIso: string;
};

export type ClaimStatusLookupResult =
  | { outcome: "visible"; view: ClaimStatusView }
  | { outcome: "not_found" };

/**
 * The single generic no-leak outcome. Claim-not-found, wrong-workspace,
 * inactive member, and non-member all return this EXACT object so a caller
 * cannot distinguish claim existence across workspaces or members.
 */
export const CLAIM_STATUS_NOT_FOUND: { outcome: "not_found" } = Object.freeze({ outcome: "not_found" });

/**
 * Effective claim status from the claim row alone. Expiry is computed: only a
 * `created` claim past its deadline reads as `expired` (matches the existing
 * claim contract; claimed/approved/executed/cancelled claims keep their
 * state). A stored `executed` claim reads as `unknown` until the payout
 * pipeline confirms completion — the view builder upgrades it to `completed`.
 */
export function getEffectiveClaimStatus(claim: ClaimLinkRow, nowIso: string): ClaimEffectiveStatus {
  switch (claim.status) {
    case "created":
      return claim.expires_at <= nowIso ? "expired" : "pending";
    case "claimed":
      return "claimed";
    case "approved":
      return "approved";
    case "executed":
      return "unknown";
    case "cancelled":
      return "rejected";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

/** Mask a wallet for user-facing display: `0x76d7…7486`. */
export function maskClaimWallet(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function completedPipelineItem(payout: PayoutRow | null, items: PayoutItemRow[]): PayoutItemRow | null {
  if (payout === null || payout.status !== "completed") return null;
  return (
    items.find(
      (item) => item.status === "completed" && item.transaction_hash !== null && item.transaction_hash.length > 0,
    ) ?? null
  );
}

function networkLabel(chainId: string): string {
  return chainId === "8453" ? "BASE" : chainId;
}

function safetyNoteFor(status: ClaimEffectiveStatus): string {
  switch (status) {
    case "pending":
      return "Awaiting the recipient's wallet address. No funds move from the claim link.";
    case "claimed":
      return "The wallet entry moved no funds. An owner or approver must approve the exact claimed destination before anything moves.";
    case "approved":
      return "Payment prepared. No proof exists until the payout pipeline confirms completion.";
    case "rejected":
      return "No funds moved. The claim link was cancelled.";
    case "expired":
      return "The claim link expired. Nothing moved.";
    case "completed":
      return "Payment completed per the payout pipeline.";
    case "unknown":
      return "The claim row says executed, but the payout pipeline does not confirm completion.";
  }
}

/**
 * Build the safe serializable status view. Pure: reads only the claim row and
 * the linked payout pipeline rows. `completed` + tx proof require a completed
 * payout whose item carries a transaction hash; nothing else can produce a
 * hash or completion claim.
 */
export function buildClaimStatusView(input: BuildClaimStatusViewInput): ClaimStatusView {
  const { claim } = input;
  let effective = getEffectiveClaimStatus(claim, input.nowIso);
  const proofItem = completedPipelineItem(input.payout, input.items);
  if (proofItem !== null) effective = "completed";

  const hasPayout = claim.payout_id !== null && input.payout !== null;

  return {
    claimId: claim.id,
    effectiveStatus: effective,
    storedStatus: claim.status,
    amount: baseUnitsToUsdc(BigInt(claim.amount_base_units)),
    amountBaseUnits: claim.amount_base_units,
    currency: claim.currency_symbol,
    chainId: claim.chain_id,
    network: networkLabel(claim.chain_id),
    expiresAt: claim.expires_at,
    claimedAt: claim.claimed_at,
    claimedWallet: claim.claimed_recipient !== null ? maskClaimWallet(claim.claimed_recipient) : null,
    payoutId: claim.payout_id,
    payoutState: input.payout !== null ? input.payout.status : null,
    itemCount: hasPayout ? input.items.length : null,
    txHash: proofItem !== null ? proofItem.transaction_hash : null,
    txExplorerUrl: proofItem !== null ? proofItem.transaction_explorer_url : null,
    safetyNote: safetyNoteFor(effective),
  };
}

/**
 * Same-workspace claim status lookup for an ACTIVE member of that workspace.
 *
 * Gate: the member must be active in the given workspace, and the claim must
 * belong to that same workspace. Every failure — unknown claim id, claim from
 * another workspace, inactive member, non-member — collapses to the exact
 * same generic `not_found` result so claim existence never leaks across
 * workspaces or members. Read-only: no rows are created or mutated.
 */
export async function getClaimStatusForMember(input: GetClaimStatusForMemberInput): Promise<ClaimStatusLookupResult> {
  if (input.member === null || input.member.status !== "active") return CLAIM_STATUS_NOT_FOUND;
  const memberRow = await input.repo.getWorkspaceMember(input.workspaceId, input.member.telegram_user_id);
  if (memberRow === null || memberRow.status !== "active" || memberRow.workspace_id !== input.workspaceId) {
    return CLAIM_STATUS_NOT_FOUND;
  }

  const claim = await input.repo.getClaimLinkById(input.claimId);
  if (claim === null) return CLAIM_STATUS_NOT_FOUND;
  if (claim.workspace_id !== input.workspaceId) return CLAIM_STATUS_NOT_FOUND;

  let payout: PayoutRow | null = null;
  let items: PayoutItemRow[] = [];
  if (claim.payout_id !== null) {
    payout = await input.repo.getPayoutById(claim.payout_id);
    items = await input.repo.getPayoutItemsByPayoutId(claim.payout_id);
  }

  return {
    outcome: "visible",
    view: buildClaimStatusView({ claim, nowIso: input.nowIso, payout, items }),
  };
}
