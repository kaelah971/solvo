import { createHash } from "node:crypto";

import { canonicalizeAmount } from "./amount.ts";

type IdempotencyInput = {
  taskId: string;
  chainId: string;
  recipientAddress: string;
  amount: string;
  tokenAddress: string;
  /** Optional KeeperHub integration id; scopes the key when present. */
  integrationId?: string;
};

function escapeTaskId(taskId: string): string {
  return taskId.trim().replace(/%/g, "%25").replace(/\|/g, "%7C");
}

function canonicalChainId(chainId: string): string {
  return String(Number(chainId));
}

function canonicalTokenAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function deriveIdempotencyKey(input: IdempotencyInput): string {
  const parts = [
    escapeTaskId(input.taskId),
    canonicalChainId(input.chainId),
    input.recipientAddress.trim().toLowerCase(),
    canonicalizeAmount(input.amount),
    canonicalTokenAddress(input.tokenAddress),
  ];
  if (input.integrationId !== undefined && input.integrationId.trim().length > 0) {
    parts.push(input.integrationId.trim());
  }
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}
