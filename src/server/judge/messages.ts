import type { PayoutItemRow, PayoutRow, WorkspaceRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";

export function judgePaymentPreview(
  address: string,
  amount: string,
  perTxLimitBaseUnits: string,
): string {
  return [
    "JUDGE PAYMENT REQUEST",
    "",
    `TO        / ${address}`,
    `AMOUNT    / ${amount} USDC`,
    "NETWORK   / BASE",
    "POLICY    / JUDGE AUTO-APPROVED",
    `CAP       / ${baseUnitsToUsdc(BigInt(perTxLimitBaseUnits))} USDC PER TX`,
    "",
    "CHECK",
    "",
    "✓ Judge authorized",
    "✓ Amount within judge policy",
    "✓ Daily cap available",
    "✓ Base USDC supported",
  ].join("\n");
}

export function judgeExecuteProgress(): string {
  return [
    "EXECUTE",
    "",
    "✓ KeeperHub simulation passed",
    "→ Submitted through KeeperHub",
  ].join("\n");
}

export function judgeBlockedMessage(reason: string): string {
  return ["JUDGE PAYMENT BLOCKED", "", `Reason: ${reason}`, "", "Nothing was submitted."].join("\n");
}

export function judgeValidationMessage(reason: string): string {
  return `The judge payment is invalid. Nothing was submitted.\n\n${reason}`;
}

export function judgeProofMessage(
  executionId: string,
  transactionHash: string,
  amount: string,
  recipient: string,
): string {
  return [
    "PROVE",
    "",
    "Payment completed.",
    `Execution ID: ${executionId}`,
    `TX hash: ${transactionHash}`,
    `BaseScan: https://basescan.org/tx/${transactionHash}`,
    `Amount: ${amount} USDC`,
    `Recipient: ${recipient}`,
    "Status: completed",
  ].join("\n");
}

export function judgeUnknownMessage(): string {
  return [
    "The payment was submitted but the outcome is not yet known.",
    "Solvo will NOT automatically retry it.",
    "Use /status <payout_id> to inspect the payout.",
  ].join("\n");
}

export function judgeFailureMessage(state: string): string {
  return [
    "The judge payment did not complete.",
    `State: ${state.toUpperCase()}`,
    "Nothing further was submitted.",
    "Use /status <payout_id> to inspect the payout.",
  ].join("\n");
}

export function judgeDuplicateMessage(state: string, payoutId: string): string {
  return [
    "This judge payment was already received.",
    `Current state: ${state.toUpperCase()}`,
    "No duplicate execution was started and no funds moved twice.",
    `Payout: ${payoutId}`,
  ].join("\n");
}

export function judgeStatusMessage(
  payout: PayoutRow,
  item: PayoutItemRow,
  workspace: WorkspaceRow,
  todaySpendBaseUnits: string,
  dailyLimitBaseUnits: string,
  lifetimeSpendBaseUnits: string,
  lifetimeLimitBaseUnits: string,
  successfulByUser: number,
  maxSuccessfulPerUser: number,
): string {
  const executed = payout.status === "completed";
  const body = [
    "PAYOUT STATUS — JUDGE MODE",
    "",
    `MODE        judge`,
    `WORKSPACE   ${workspace.name ?? workspace.id}`,
    `PAYOUT ID   ${payout.id}`,
    `STATE       ${payout.status.toUpperCase()}`,
    `AMOUNT      ${baseUnitsToUsdc(BigInt(item.amount_base_units))} USDC`,
    `RECIPIENT   ${item.recipient_address}`,
    `DAILY SPEND ${baseUnitsToUsdc(BigInt(todaySpendBaseUnits))} / ${baseUnitsToUsdc(BigInt(dailyLimitBaseUnits))} USDC`,
    `LIFETIME    ${baseUnitsToUsdc(BigInt(lifetimeSpendBaseUnits))} / ${baseUnitsToUsdc(BigInt(lifetimeLimitBaseUnits))} USDC`,
    `MY PAYMENTS ${successfulByUser} / ${maxSuccessfulPerUser} completed`,
    executed ? "FUNDS       MOVED ON BASE" : "FUNDS       NO FUNDS MOVED",
  ];
  if (item.keeperhub_execution_id) {
    body.push(`EXECUTION ID ${item.keeperhub_execution_id}`);
  }
  if (item.transaction_hash) {
    body.push(`TX HASH     ${item.transaction_hash}`);
    body.push(`BASESCAN    https://basescan.org/tx/${item.transaction_hash}`);
  }
  if (payout.status === "execution_unknown") {
    body.push("");
    body.push("Solvo will NOT automatically retry this payment.");
  }
  return body.join("\n");
}
