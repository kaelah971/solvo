import type { PayoutItemRow, PayoutRow, WorkspaceRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { shortId } from "./community-messages.ts";

export const BATCH_MAX_ITEMS = 20;

export type BatchPreviewLine = {
  label: string;
  address: string;
  amountBaseUnits: string;
};

export function batchPreview(requesterId: string, payoutId: string, lines: BatchPreviewLine[]): string {
  const total = lines.reduce((sum, line) => sum + BigInt(line.amountBaseUnits), 0n);
  const body = [
    "BATCH PAYOUT",
    "",
    `RECIPIENTS    ${lines.length}`,
    `TOTAL         ${baseUnitsToUsdc(total)} USDC`,
    "NETWORK       BASE",
    `REQUESTED BY  ${requesterId}`,
    "APPROVAL      REQUIRED",
    `PAYOUT ID     ${shortId(payoutId)}`,
    "",
  ];
  for (const line of lines) {
    body.push(`- ${line.label} / ${line.address.slice(0, 10)}… / ${baseUnitsToUsdc(BigInt(line.amountBaseUnits))} USDC`);
  }
  return body.join("\n");
}

export function batchProgress(current: number, total: number, phase: "checking" | "executing"): string {
  return `BATCH APPROVED\n\n${phase.toUpperCase()} ${current}/${total}...`;
}

export type BatchReceiptLine = {
  label: string;
  status: string;
  transactionHash: string | null;
  amountBaseUnits: string;
};

export function batchReceipt(lines: BatchReceiptLine[], totalBaseUnits: string): string {
  const completed = lines.filter((line) => line.status === "completed");
  const transferred = completed.reduce((sum, line) => sum + BigInt(line.amountBaseUnits), 0n);

  const body = [
    completed.length === lines.length
      ? "BATCH COMPLETE"
      : "BATCH PARTIALLY COMPLETED",
    "",
    `${lines.length} recipients`,
    `${baseUnitsToUsdc(BigInt(totalBaseUnits))} USDC total`,
    "",
  ];
  for (const line of lines) {
    const mark = line.status === "completed" ? "✓" : "✕";
    const tx = line.transactionHash ? `  tx: ${line.transactionHash}` : "";
    body.push(`${mark} ${line.label} — ${line.status}${tx}`);
  }
  body.push("");
  body.push(`${completed.length}/${lines.length} completed`);
  body.push(`${baseUnitsToUsdc(transferred)} USDC successfully transferred`);
  body.push(`${baseUnitsToUsdc(BigInt(totalBaseUnits) - transferred)} USDC not transferred`);
  return body.join("\n");
}

export type BatchStatusItem = {
  item: PayoutItemRow;
  label: string;
};

export function batchStatusMessage(
  payout: PayoutRow,
  items: BatchStatusItem[],
  workspace: WorkspaceRow,
  requesterId: string | null,
): string {
  const completed = items.filter(({ item }) => item.status === "completed").length;
  const failed = items.filter(({ item }) => item.status !== "completed").length;
  const requestedTotal = items.reduce((sum, { item }) => sum + BigInt(item.amount_base_units), 0n);
  const transferred = items
    .filter(({ item }) => item.status === "completed")
    .reduce((sum, { item }) => sum + BigInt(item.amount_base_units), 0n);

  const body = [
    "PAYOUT STATUS",
    "",
    `WORKSPACE   ${workspace.name ?? workspace.id}`,
    `PAYOUT ID   ${payout.id}`,
    `STATE       ${payout.status.toUpperCase()}`,
    `REQUESTED   ${requesterId ?? "—"}`,
    `RECIPIENTS  ${items.length}`,
    `COMPLETED   ${completed}`,
    `NOT DONE    ${failed}`,
    `TOTAL       ${baseUnitsToUsdc(requestedTotal)} USDC`,
    `TRANSFERRED ${baseUnitsToUsdc(transferred)} USDC`,
    "",
  ];
  for (const { item, label } of items) {
    body.push(
      `- ${label} / ${item.recipient_address.slice(0, 10)}… / ${baseUnitsToUsdc(BigInt(item.amount_base_units))} USDC / ${item.status.toUpperCase()}` +
        (item.keeperhub_execution_id ? ` / exec ${item.keeperhub_execution_id}` : "") +
        (item.transaction_hash ? ` / tx ${item.transaction_hash}` : ""),
    );
  }
  body.push(`LAST UPDATE  ${(payout.updated_at ?? "").replace("T", " ").slice(0, 19)}`);
  return body.join("\n");
}
