import { StatePanel } from "@/components/StatePanel";
import type { StatusTone } from "@/components/StatusLabel";

export type ClaimState =
  | "unavailable"
  | "valid"
  | "expired"
  | "waiting-approval"
  | "approved"
  | "completed"
  | "not-confirmed"
  | "cancelled";

type ClaimPanelConfig = {
  badge: string;
  tone: StatusTone;
  headline: string;
  body: string;
};

/**
 * M11.4 — truthful per-state web copy. Completion claims ("completed",
 * "executed", "paid", "sent", hashes, proof) appear ONLY in the `completed`
 * config, which the page renders solely when the M11.2 read model supplies
 * pipeline-confirmed proof. Every other state describes what has NOT happened.
 */
const claimStates: Record<ClaimState, ClaimPanelConfig> = {
  unavailable: {
    badge: "CLAIM UNAVAILABLE",
    tone: "pending",
    headline: "This claim does not exist or is no longer accessible.",
    body: "Claim links are single-use and expire after a fixed period. This link may never have been issued, may have expired, or may already have been used.",
  },
  valid: {
    badge: "CLAIM VALID",
    tone: "pending",
    headline: "Awaiting your destination address.",
    body: "No funds move when a wallet is entered. An owner or approver must approve the exact claimed destination before KeeperHub execution.",
  },
  expired: {
    badge: "CLAIM EXPIRED",
    tone: "error",
    headline: "This claim link has expired.",
    body: "The claim link can no longer be used. No funds moved from this expired claim.",
  },
  "waiting-approval": {
    badge: "WAITING FOR SENDER APPROVAL",
    tone: "pending",
    headline: "The sender must approve the destination.",
    body: "The claimed wallet cannot be changed after submission. An owner or approver must approve the exact destination before anything moves.",
  },
  approved: {
    badge: "CLAIM APPROVED · PAYMENT PREPARED",
    tone: "pending",
    headline: "Approval has prepared the payment.",
    body: "KeeperHub execution/proof only appears after the execution pipeline completes.",
  },
  completed: {
    badge: "PAYMENT COMPLETED",
    tone: "complete",
    headline: "Payment completed.",
    body: "Payment completed per the payout pipeline. The transaction hash is shown above.",
  },
  "not-confirmed": {
    badge: "CLAIM NOT CONFIRMED",
    tone: "pending",
    headline: "Completion is not confirmed.",
    body: "This claim cannot be confirmed yet. The payout pipeline holds no completion record.",
  },
  cancelled: {
    badge: "CLAIM REJECTED",
    tone: "error",
    headline: "This claim was rejected.",
    body: "The sender or an approver cancelled this claim before execution. No funds moved from this rejected claim, and the link cannot be reused.",
  },
};

type ClaimPanelProps = {
  state: ClaimState;
  children?: React.ReactNode;
};

/**
 * Reusable claim-state panel. Every state is a truthful written status with a
 * fixed headline and explanation; no state is ever invented from the token.
 * The "valid" state exposes a children slot for the destination input,
 * rendered by the page.
 */
export function ClaimPanel({ state, children }: ClaimPanelProps) {
  const config = claimStates[state];

  return (
    <StatePanel badge={config.badge} tone={config.tone} headline={config.headline} body={config.body}>
      {state === "valid" && children}
    </StatePanel>
  );
}
