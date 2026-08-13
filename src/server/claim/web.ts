import type { ClaimStatusView } from "./status.ts";

/**
 * M11.4 — Web claim page state mapping (pure).
 *
 * Maps the M11.2 read-model view (pipeline-truthful) onto the web panel
 * states. Completion/proof reach the page ONLY through the view: a stored
 * `executed` claim without pipeline proof maps to `not-confirmed`, never to
 * `completed`, so the page can never invent a transaction hash.
 *
 * Web states:
 *   valid              pending — wallet form (submit records only)
 *   waiting-approval   claimed — masked wallet, immutable destination
 *   approved           approved — payment prepared, no proof yet
 *   completed          completed — proof only from the payout pipeline
 *   not-confirmed      stored executed without pipeline confirmation
 *   expired            computed expiry
 *   cancelled          rejected/cancelled claim
 *   unavailable        unknown token (page-level, no-leak)
 */

export type ClaimWebState =
  | "valid"
  | "waiting-approval"
  | "approved"
  | "completed"
  | "not-confirmed"
  | "expired"
  | "cancelled"
  | "unavailable";

export type ClaimWebPage = {
  state: ClaimWebState;
  amountUsdc: string;
  network: string;
  expiresAt: string;
  /** Masked destination wallet (first 6 + last 4 chars), never the full address. */
  claimedWallet: string | null;
  payoutId: string | null;
  /** Transaction proof ONLY when the payout pipeline confirms it. */
  txHash: string | null;
  txExplorerUrl: string | null;
};

export function claimWebStateFor(view: ClaimStatusView): ClaimWebState {
  switch (view.effectiveStatus) {
    case "pending":
      return "valid";
    case "claimed":
      return "waiting-approval";
    case "approved":
      return "approved";
    case "completed":
      return "completed";
    case "rejected":
      return "cancelled";
    case "expired":
      return "expired";
    case "unknown":
      return "not-confirmed";
  }
}

/** Build the safe, serializable web page data for a claim status view. */
export function buildClaimWebPage(view: ClaimStatusView): ClaimWebPage {
  return {
    state: claimWebStateFor(view),
    amountUsdc: view.amount,
    network: view.network,
    expiresAt: view.expiresAt,
    claimedWallet: view.claimedWallet,
    payoutId: view.payoutId,
    txHash: view.txHash,
    txExplorerUrl: view.txExplorerUrl,
  };
}
