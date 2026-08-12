import { StatePanel } from "@/components/StatePanel";
import type { StatusTone } from "@/components/StatusLabel";

export type ClaimState =
  | "unavailable"
  | "valid"
  | "expired"
  | "used"
  | "waiting-approval"
  | "executing"
  | "completed"
  | "cancelled"
  | "review-required";

type ClaimPanelConfig = {
  badge: string;
  tone: StatusTone;
  headline: string;
  body: string;
};

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
    body: "",
  },
  expired: {
    badge: "CLAIM EXPIRED",
    tone: "error",
    headline: "This claim link has expired.",
    body: "The link expired before a destination was approved. Nothing was moved, and the link cannot be extended.",
  },
  used: {
    badge: "CLAIM ALREADY USED",
    tone: "error",
    headline: "This claim has already been claimed.",
    body: "A claim link is single-use. It cannot be reused, redirected or claimed a second time.",
  },
  "waiting-approval": {
    badge: "WAITING FOR SENDER APPROVAL",
    tone: "pending",
    headline: "The sender must approve the destination.",
    body: "The sender sees the exact address before anything moves. Execution begins only after that approval is given.",
  },
  executing: {
    badge: "APPROVED · PENDING EXECUTION",
    tone: "pending",
    headline: "Execution is confirming.",
    body: "Execution is still confirming. Solvo will update this page when the state changes.",
  },
  completed: {
    badge: "PAYMENT COMPLETED",
    tone: "complete",
    headline: "Payment completed.",
    body: "Proof is the success state. The transaction hash and audit record outrank any celebration.",
  },
  cancelled: {
    badge: "CLAIM CANCELLED",
    tone: "error",
    headline: "This claim was cancelled.",
    body: "The sender or an approver cancelled this claim before execution. Nothing was moved and the link cannot be reused.",
  },
  "review-required": {
    badge: "REVIEW REQUIRED",
    tone: "error",
    headline: "This payment requires review.",
    body: "The transaction was not completed. No automatic retry was attempted because the failure requires review.",
  },
};

type ClaimPanelProps = {
  state: ClaimState;
  token?: string;
  children?: React.ReactNode;
};

/**
 * Reusable claim-state panel. Every state is a truthful written status with a
 * fixed headline and explanation; no state is ever invented from the token.
 * The token, when present, is shown in full with data-break so it can never
 * break the layout or hide the reference. The "valid" state exposes a children
 * slot for the destination input and approval controls, rendered by the page.
 */
export function ClaimPanel({ state, token, children }: ClaimPanelProps) {
  const config = claimStates[state];

  return (
    <StatePanel
      badge={config.badge}
      tone={config.tone}
      headline={config.headline}
      body={config.body}
    >
      {token && (
        <div className="hairline-top pt-4">
          <p className="text-[11px] font-semibold uppercase leading-[1.2] tracking-[0.15em] text-muted">
            Claim
          </p>
          <p className="data-break mt-2 font-data text-[11px] leading-[1.5] tracking-[0.04em] text-secondary">
            {token}
          </p>
        </div>
      )}
      {state === "valid" && children}
    </StatePanel>
  );
}
