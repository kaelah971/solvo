import type { ClaimLinkRow, WorkspaceRow } from "../db/types.ts";
import type { ClaimEffectiveStatus, ClaimStatusView } from "./status.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";

export function claimCreatedMessage(
  claim: ClaimLinkRow,
  link: string,
  expiresAtIso: string,
): string {
  return [
    "CLAIM LINK CREATED",
    "",
    `AMOUNT     ${baseUnitsToUsdc(BigInt(claim.amount_base_units))} USDC`,
    "NETWORK    BASE / USDC",
    `STATUS     awaiting recipient`,
    `EXPIRES    ${expiresAtIso.replace("T", " ").slice(0, 19)} UTC`,
    "",
    "Share this ONE-TIME link with the recipient:",
    link,
    "",
    "The recipient will submit a wallet address. NO funds move from the link.",
    "You (or an approver) must approve the claimed destination before Solvo executes.",
  ].join("\n");
}

export function claimAlreadyReceivedMessage(claim: ClaimLinkRow): string {
  return [
    "CLAIM LINK ALREADY EXISTS",
    "",
    `AMOUNT     ${baseUnitsToUsdc(BigInt(claim.amount_base_units))} USDC`,
    `STATUS     ${claim.status.toUpperCase()}`,
    "No duplicate claim was created.",
    "",
    "The one-time link was shown when the claim was created. It is not stored",
    "again here: claim tokens are single-use by design.",
    `Claim: ${claim.token_prefix}…`,
  ].join("\n");
}

export function claimBlockedMessage(reason: string): string {
  return ["CLAIM BLOCKED", "", `Reason: ${reason}`, "", "No claim link was created."].join("\n");
}

export function claimInvalidMessage(reason: string): string {
  return `The claim is invalid. No claim link was created.\n\n${reason}`;
}

export function claimClaimedNotificationMessage(claim: ClaimLinkRow): string {
  return [
    "CLAIM DESTINATION SUBMITTED",
    "",
    `AMOUNT       ${baseUnitsToUsdc(BigInt(claim.amount_base_units))} USDC`,
    `NETWORK      BASE`,
    `CLAIMED BY   ${claim.claimed_by ?? "—"}`,
    `DESTINATION  ${claim.claimed_recipient ?? ""}`,
    "",
    "Approve the final destination to continue with KeeperHub execution.",
    "The claimed wallet will NEVER move funds automatically.",
  ].join("\n");
}

export function claimStatusMessage(claim: ClaimLinkRow, workspace: WorkspaceRow): string {
  const lines = [
    "CLAIM STATUS",
    "",
    `CLAIM ID    ${claim.id}`,
    `WORKSPACE   ${workspace.name ?? workspace.id}`,
    `AMOUNT      ${baseUnitsToUsdc(BigInt(claim.amount_base_units))} USDC`,
    "NETWORK     BASE",
    `STATE       ${claim.status.toUpperCase()}`,
    `REQUESTED   ${claim.requester_id}`,
  ];
  if (claim.claimed_recipient) {
    lines.push(`DESTINATION ${claim.claimed_recipient}`);
  }
  lines.push(`EXPIRES     ${claim.expires_at.replace("T", " ").slice(0, 19)} UTC`);
  if (claim.payout_id) {
    lines.push(`PAYOUT      ${claim.payout_id}`);
  }
  if (claim.status === "created") {
    lines.push("");
    lines.push("Awaiting the recipient's wallet address. Nothing moves from the link.");
  }
  if (claim.status === "claimed") {
    lines.push("");
    lines.push("Awaiting approval of the claimed destination before execution.");
  }
  if (claim.status === "executed") {
    lines.push("FUNDS       MOVED ON BASE");
  }
  return lines.join("\n");
}

export function claimCommunityProofMessage(
  executionId: string,
  transactionHash: string,
  amountBaseUnits: string,
  recipient: string,
): string {
  return [
    "CLAIM APPROVED — PAYMENT COMPLETED",
    "",
    `EXECUTION ID  ${executionId}`,
    `TX HASH       ${transactionHash}`,
    `BASESCAN      https://basescan.org/tx/${transactionHash}`,
    `AMOUNT        ${baseUnitsToUsdc(BigInt(amountBaseUnits))} USDC`,
    `RECIPIENT     ${recipient}`,
    "STATUS        completed",
  ].join("\n");
}

export function claimApprovedExecutingMessage(): string {
  return [
    "CLAIM APPROVED",
    "",
    "Payment submitted through KeeperHub.",
    "Check /status <payout_id> for the proof.",
  ].join("\n");
}

export function claimCallbackAlreadyHandledMessage(): { answer: string } {
  return { answer: "This claim has already been handled." };
}

export function claimCallbackUnauthorizedMessage(): { answer: string } {
  return { answer: "Only an owner or approver may decide this claim." };
}

export function claimCallbackSelfApprovalMessage(): { answer: string } {
  return { answer: "The requester cannot approve their own claim (separation of duty)." };
}

export function claimCallbackWrongChatMessage(): { answer: string } {
  return { answer: "This claim belongs to a different chat." };
}

// ── M11.3 claim status replies ─────────────────────────────────────────────

const CLAIM_STATUS_HEADERS: Record<ClaimEffectiveStatus, string> = {
  pending: "CLAIM STATUS FOUND",
  claimed: "CLAIM CLAIMED — APPROVAL REQUIRED",
  approved: "CLAIM APPROVED — PAYMENT PREPARED",
  rejected: "CLAIM REJECTED",
  expired: "CLAIM EXPIRED",
  completed: "CLAIM COMPLETED",
  unknown: "CLAIM STATUS NOT CONFIRMED",
};

const CLAIM_STATUS_LABELS: Record<ClaimEffectiveStatus, string> = {
  pending: "PENDING",
  claimed: "CLAIMED",
  approved: "APPROVED",
  rejected: "REJECTED",
  expired: "EXPIRED",
  completed: "COMPLETED",
  unknown: "NOT CONFIRMED",
};

const CLAIM_STATUS_COPY: Record<ClaimEffectiveStatus, string[]> = {
  pending: ["No wallet has been entered yet.", "No funds have moved."],
  claimed: [
    "No funds move when a wallet is entered.",
    "An owner or approver must approve the exact claimed destination before KeeperHub execution.",
  ],
  approved: [
    "Approval has prepared the payment.",
    "KeeperHub execution/proof only appears after the execution pipeline completes.",
  ],
  rejected: ["No funds moved from this rejected claim."],
  expired: ["The claim link can no longer be used.", "No funds moved from this expired claim."],
  completed: ["Payment completed per the payout pipeline."],
  unknown: [
    "The claim row says executed, but the payout pipeline does not confirm completion.",
    "No proof is available.",
  ],
};

function formatExpiry(expiresAtIso: string): string {
  return `${expiresAtIso.replace("T", " ").slice(0, 19)} UTC`;
}

/** /claimstatus without a claim id. */
export function claimStatusUsageMessage(): string {
  return [
    "CLAIM STATUS COMMAND",
    "",
    "I need a claim id to check.",
    "Usage: /claimstatus <claim-id>",
  ].join("\n");
}

/**
 * Generic no-leak reply: claim not found, wrong workspace, inactive member,
 * non-member, or a chat without an eligible workspace all get the SAME text
 * so claim existence never leaks across workspaces or members.
 */
export function claimStatusUnavailableMessage(): string {
  return [
    "CLAIM STATUS UNAVAILABLE",
    "",
    "I couldn't find a claim status available to this workspace.",
  ].join("\n");
}

/**
 * Per-state claim status reply built ONLY from the read-model view
 * (`ClaimStatusView`). The view itself is pipeline-truthful: tx proof appears
 * only when the payout pipeline confirms completion; nothing here can invent
 * a hash. Raw token, token hash, prefix and idempotency keys are never shown.
 */
export function claimStatusFoundMessage(view: ClaimStatusView): string {
  const lines = [
    CLAIM_STATUS_HEADERS[view.effectiveStatus],
    "",
    `CLAIM ID     ${view.claimId}`,
    `AMOUNT       ${view.amount} ${view.currency}`,
    `STATE        ${CLAIM_STATUS_LABELS[view.effectiveStatus]}`,
    `EXPIRES      ${formatExpiry(view.expiresAt)}`,
  ];
  if (view.claimedWallet !== null) {
    lines.push(`WALLET       ${view.claimedWallet}`);
  }
  if (view.payoutId !== null) {
    lines.push(`PAYOUT       ${view.payoutId}`);
  }
  if (view.effectiveStatus === "completed" && view.txHash !== null) {
    lines.push(`TX HASH      ${view.txHash}`);
    if (view.txExplorerUrl !== null) {
      lines.push(`BASESCAN     ${view.txExplorerUrl}`);
    }
  }
  lines.push("", ...CLAIM_STATUS_COPY[view.effectiveStatus]);
  return lines.join("\n");
}
