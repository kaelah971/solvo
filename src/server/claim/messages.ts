import type { ClaimLinkRow, WorkspaceRow } from "../db/types.ts";
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
