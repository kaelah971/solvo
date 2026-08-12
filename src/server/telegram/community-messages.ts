import type { MemberRole, PayoutItemRow, PayoutRow, RecipientRow, WorkspaceMemberRow, WorkspaceRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import type { ApprovalCallbackResult } from "./types.ts";

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function roleLabel(role: MemberRole): string {
  return role.toUpperCase();
}

export function workspaceInitMessage(
  outcome: "created" | "existing",
  workspace: WorkspaceRow,
  ownerRole: MemberRole,
): string {
  const head = outcome === "created" ? "COMMUNITY WORKSPACE INITIALIZED" : "WORKSPACE ALREADY EXISTS";
  return [
    head,
    "",
    `WORKSPACE    ${workspace.name ?? workspace.id}`,
    `MODE         COMMUNITY`,
    `CHAT         ${workspace.telegram_chat_id ?? "—"}`,
    `NETWORK      BASE / ${workspace.chain_id}`,
    `TOKEN        ${workspace.token_address}`,
    `PER-TX LIMIT ${workspace.per_transaction_limit_base_units !== null ? baseUnitsToUsdc(BigInt(workspace.per_transaction_limit_base_units)) + " USDC" : "none"}`,
    outcome === "created" ? `ROLE         ${roleLabel(ownerRole)} (you)` : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function notInGroupMessage(): string {
  return "This command only works inside a Telegram group chat.";
}

export function unauthorizedInitializerMessage(): string {
  return "This account is not authorized to initialize a Solvo workspace. Only configured development operators can.";
}

export function workspaceNotFoundForGroupMessage(): string {
  return "This group is not a Solvo workspace yet. An authorized operator must run /workspace init.";
}

export function memberRoleNotOwnerMessage(): string {
  return "Only the workspace owner can manage membership.";
}

export function memberAddMessage(result: "added" | "already_member" | "reactivated", role: MemberRole, userId: string): string {
  const line =
    result === "already_member"
      ? `User ${userId} is already an active member (${roleLabel(role)}).`
      : result === "reactivated"
        ? `User ${userId} was re-added as ${roleLabel(role)}.`
        : `User ${userId} added as ${roleLabel(role)}.`;
  return line;
}

export function memberRemoveMessage(
  result: "removed" | "not_found" | "last_owner",
  userId: string,
): string {
  switch (result) {
    case "removed":
      return `User ${userId} removed from the workspace.`;
    case "not_found":
      return `User ${userId} is not an active member of this workspace.`;
    case "last_owner":
      return "Cannot remove the final owner. Assign another owner first.";
  }
}

export function memberListMessage(members: WorkspaceMemberRow[]): string {
  if (members.length === 0) return "No members yet.";
  const lines = members.map((member) => `${roleLabel(member.role).padEnd(9)} ${member.telegram_user_id}`);
  return ["MEMBERS", "", ...lines].join("\n");
}

export function recipientAddMessage(result: "added" | "duplicate_alias", alias: string): string {
  return result === "added"
    ? `Recipient alias "${alias}" added.`
    : `A recipient alias "${alias}" already exists in this workspace.`;
}

export function recipientListMessage(recipients: RecipientRow[]): string {
  if (recipients.length === 0) return "No recipient aliases yet.";
  const lines = recipients.map((recipient) => `${recipient.alias.padEnd(20)} ${recipient.wallet_address}`);
  return ["RECIPIENTS", "", ...lines].join("\n");
}

export function notAMemberMessage(): string {
  return "You are not a member of this workspace. Ask the workspace owner to add you.";
}

export function recipientUnknownMessage(alias: string): string {
  return `Unknown recipient "${alias}". Add it with /recipient add ${alias} <0x...> or use an explicit address.`;
}

export type PreviewInput = {
  alias: string | null;
  address: string;
  amount: string;
  requesterId: string;
  payoutId: string;
};

export function communityPayPreview(input: PreviewInput): string {
  return [
    "PAYMENT REQUEST",
    "",
    `TO          ${input.alias ?? "—"}`,
    `ADDRESS     ${input.address}`,
    `AMOUNT      ${input.amount} USDC`,
    "NETWORK     BASE",
    `REQUESTED   ${input.requesterId}`,
    "APPROVAL    REQUIRED",
    `PAYOUT ID   ${shortId(input.payoutId)}`,
  ].join("\n");
}

export function approvalCallbackData(action: "approve" | "reject", payoutId: string): string {
  return `solvo:${action}:${payoutId}`;
}

export function claimCallbackData(action: "claim_approve" | "claim_reject", claimId: string): string {
  return `solvo:${action === "claim_approve" ? "claimapprove" : "claimreject"}:${claimId}`;
}

export type ParsedCallbackData =
  | { action: "approve" | "reject"; payoutId: string }
  | { action: "claim_approve" | "claim_reject"; claimId: string };

export function parseCallbackData(data: string): ParsedCallbackData | null {
  const payout = /^solvo:(approve|reject):([0-9a-f-]{36})$/.exec(data);
  if (payout) {
    return { action: payout[1] as "approve" | "reject", payoutId: payout[2] };
  }
  const claim = /^solvo:(claimapprove|claimreject):([0-9a-f-]{36})$/.exec(data);
  if (claim) {
    return {
      action: claim[1] === "claimapprove" ? "claim_approve" : "claim_reject",
      claimId: claim[2],
    };
  }
  return null;
}

export function callbackAlreadyHandledMessage(): ApprovalCallbackResult {
  return { answer: "This request has already been handled." };
}

export function callbackUnauthorizedMessage(): ApprovalCallbackResult {
  return { answer: "You are not authorized to approve this request." };
}

export function callbackWrongChatMessage(): ApprovalCallbackResult {
  return { answer: "This request does not belong to this chat." };
}

export function callbackSelfApprovalMessage(): ApprovalCallbackResult {
  return { answer: "A different treasury approver must approve this request." };
}

export function callbackInvalidMessage(): ApprovalCallbackResult {
  return { answer: "This action is no longer valid." };
}

export function approvedProgressBlock(approverId: string, role: MemberRole): string {
  return [
    "APPROVED BY TREASURY ROLE",
    "",
    "CHECK",
    "✓ Destination validated",
    "✓ Approval authority verified",
    "✓ Base USDC policy passed",
    "",
    `APPROVER    ${roleLabel(role)} (${approverId})`,
  ].join("\n");
}

export function paymentNotApprovedMessage(): string {
  return ["PAYMENT NOT APPROVED", "", "No transaction was submitted."].join("\n");
}

export function paymentApprovedExecutingMessage(): string {
  return ["PAYMENT APPROVED", "", "EXECUTE", "✓ KeeperHub simulation passed", "→ Submitted"].join("\n");
}

export function communityProofMessage(executionId: string, transactionHash: string): string {
  return [
    "PROVE",
    "Payment completed.",
    "",
    "EXECUTION ID",
    executionId,
    "",
    "TX HASH",
    transactionHash,
  ].join("\n");
}

export function communityStatusMessage(
  payout: PayoutRow,
  item: PayoutItemRow,
  requesterId: string | null,
  approvalNote: string | null,
  workspace: WorkspaceRow,
): string {
  const lines = [
    "PAYOUT STATUS",
    "",
    `WORKSPACE   ${workspace.name ?? workspace.id}`,
    `PAYOUT ID   ${payout.id}`,
    `AMOUNT      ${baseUnitsToUsdc(BigInt(payout.total_amount_base_units))} ${payout.currency_symbol}`,
    `STATE       ${payout.status.toUpperCase()}`,
    `RECIPIENT   ${item.recipient_address}`,
    `REQUESTED   ${requesterId ?? "—"}`,
  ];
  if (approvalNote) lines.push(approvalNote);
  if (item.keeperhub_execution_id) lines.push(`EXECUTION ID ${item.keeperhub_execution_id}`);
  if (item.transaction_hash) lines.push(`TX HASH      ${item.transaction_hash}`);
  if (item.transaction_explorer_url) lines.push(`TRANSACTION  ${item.transaction_explorer_url}`);
  lines.push(`LAST UPDATE  ${(payout.updated_at ?? "").replace("T", " ").slice(0, 19)}`);
  return lines.join("\n");
}

export function notInWorkspaceStatusMessage(): string {
  return "You are not a member of the workspace that owns this payout.";
}
