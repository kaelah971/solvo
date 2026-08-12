import type { PayoutItemRow, PayoutRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { formatCommandLines, SOLVO_COMMANDS } from "./commands.ts";
import type { PayInstruction, TelegramMode } from "./types.ts";

export function startMessage(): string {
  return [
    "SOLVO — CONVERSATIONAL TREASURY EXECUTION",
    "",
    "Send a payment instruction. Solvo checks the details, applies policy, and returns proof when execution completes.",
    "",
    "Commands:",
    "  /pay <address> <amount> USDC",
    "  /status <payout_id>",
    "  /help",
    "",
    "You can also write it naturally, for example:",
    "  Send 0.01 USDC to 0x742d...",
    "",
    "Sandbox simulations never move funds. Real Base USDC execution is restricted to authorized development users.",
  ].join("\n");
}

export function helpMessage(): string {
  const commandLines = formatCommandLines(SOLVO_COMMANDS).map((line) => "  " + line);
  return [
    "SOLVO — HELP",
    "",
    "Solvo turns a payment instruction into a validated, simulated, executed and provable Base USDC transaction through KeeperHub.",
    "",
    "Commands:",
    ...commandLines,
    "",
    "Examples:",
    "  /pay <address> <amount> USDC",
    "  /status <payout_id>",
    "",
    "Natural language is supported in a limited deterministic form:",
    "  Send 0.01 USDC to 0x742d...",
    "",
    "Modes:",
    "  SANDBOX       Simulation only. NO FUNDS WERE MOVED.",
    "  DEVELOPMENT   Real Base USDC execution for allowlisted users only, capped at 0.10 USDC per transaction.",
    "  COMMUNITY     Group payouts require approval by an owner or approver; the requester can never approve their own payout.",
    "  JUDGE         Restricted real execution for authorized judges only via /judgepay, capped at 0.10 USDC per transaction and 1.00 USDC per day.",
  ].join("\n");
}

export function payPreview(instruction: PayInstruction, mode: TelegramMode, approval: string): string {
  return [
    "PAYMENT REQUEST",
    "",
    `TO        / ${instruction.address}`,
    `AMOUNT    / ${instruction.amount} USDC`,
    "NETWORK   / BASE",
    `MODE      / ${mode.toUpperCase()}`,
    `APPROVAL  / ${approval}`,
  ].join("\n");
}

export function requestReceived(payoutId: string): string {
  return `REQUEST RECEIVED\nPayment request ${payoutId} persisted.`;
}

export function checksPassed(): string {
  return [
    "CHECK",
    "",
    "✓ Destination validated",
    "✓ Base USDC supported",
    "✓ Amount within policy",
    "✓ User authorized for this mode",
  ].join("\n");
}

export function simulationComplete(): string {
  return [
    "SIMULATION COMPLETE",
    "",
    "NO FUNDS WERE MOVED",
  ].join("\n");
}

export function simulating(): string {
  return "KeeperHub simulation running…";
}

export function submitted(): string {
  return "→ Transaction submitted";
}

export function confirming(): string {
  return "→ Confirming";
}

export function proofMessage(executionId: string, transactionHash: string, explorerUrl: string | null): string {
  return [
    "Payment completed. Transaction proof available.",
    "",
    "EXECUTION ID   " + executionId,
    "TX HASH        " + transactionHash,
    explorerUrl ? "TRANSACTION   " + explorerUrl : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function validationFailure(reason: string): string {
  return `The destination address is invalid. Nothing was submitted.\n\n${reason}`;
}

export function policyFailure(reason: string): string {
  return `This payment is outside the execution policy. Nothing was submitted.\n\n${reason}`;
}

export function simulationFailure(): string {
  return "KeeperHub simulation failed. No transaction was broadcast.";
}

export function executionFailed(): string {
  return "The transaction was not completed. Review is required before retrying.";
}

export function executionUnknown(): string {
  return "KeeperHub accepted the request, but the final state could not be confirmed. Solvo will not automatically send another transaction.";
}

export function statusMessage(
  payout: PayoutRow,
  items: PayoutItemRow[],
  fundsMovedNote: string,
): string {
  const firstItem = items[0] ?? null;
  const lines = [
    "PAYOUT STATUS",
    "",
    `PAYOUT ID    ${payout.id}`,
    `AMOUNT       ${baseUnitsToUsdc(BigInt(payout.total_amount_base_units))} ${payout.currency_symbol}`,
    `STATE        ${payout.status.toUpperCase()}`,
    firstItem ? `RECIPIENT    ${firstItem.recipient_address}` : null,
    firstItem?.keeperhub_execution_id ? `EXECUTION ID ${firstItem.keeperhub_execution_id}` : null,
    firstItem?.transaction_hash ? `TX HASH      ${firstItem.transaction_hash}` : null,
    firstItem?.transaction_explorer_url ? `TRANSACTION  ${firstItem.transaction_explorer_url}` : null,
    `LAST UPDATE  ${(payout.updated_at ?? "").replace("T", " ").slice(0, 19)}`,
    "",
    fundsMovedNote,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

export function fundsMovedNote(payout: PayoutRow): string {
  if (payout.status === "execution_unknown") {
    return "Execution state is unknown. Solvo will not automatically retry this payment.";
  }
  if (payout.status === "completed") {
    return "Funds moved. Proof is available above.";
  }
  return "NO FUNDS WERE MOVED";
}

export function notFound(): string {
  return "Payout not found.";
}
