import { isValidEvmAddress, normalizeAddress } from "./address.ts";
import { parseUsdcAmount } from "./amount.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_CHAIN_NAME, KEEPERHUB_USDC_SYMBOL } from "./config.ts";
import { deriveIdempotencyKey } from "./idempotency.ts";
import type { SolvoTransferRequest } from "./types.ts";

export const DEFAULT_TASK_ID = "solvo-dev-proof";

export type ProofOptions = {
  to: string;
  amount: string;
  confirmed: boolean;
  taskId?: string;
  usdcTokenAddress: string;
};

export type ProofValidationResult =
  | { ok: true; request: SolvoTransferRequest; taskId: string; amount: string; recipient: string }
  | { ok: false; reason: string };

export function buildProofRequest(options: ProofOptions): ProofValidationResult {
  const address = isValidEvmAddress(options.to);
  if (!address.ok) {
    return { ok: false, reason: `Invalid recipient: ${address.reason}` };
  }
  const amount = parseUsdcAmount(options.amount);
  if (!amount.ok) {
    return { ok: false, reason: `Invalid amount: ${amount.reason}` };
  }
  const taskId = options.taskId?.trim() || DEFAULT_TASK_ID;
  const recipient = normalizeAddress(options.to);
  return {
    ok: true,
    amount: amount.amount,
    recipient,
    taskId,
    request: {
      chainId: KEEPERHUB_CHAIN_ID,
      recipientAddress: recipient,
      amount: amount.amount,
      tokenAddress: options.usdcTokenAddress.trim().toLowerCase(),
      idempotencyKey: deriveIdempotencyKey({
        taskId,
        chainId: KEEPERHUB_CHAIN_ID,
        recipientAddress: recipient,
        amount: amount.amount,
        tokenAddress: options.usdcTokenAddress.trim().toLowerCase(),
      }),
    },
  };
}

export function proofWarningBlock(request: SolvoTransferRequest, taskId: string): string {
  return [
    "TARGET         " + KEEPERHUB_CHAIN_NAME + " / " + KEEPERHUB_CHAIN_ID,
    "ASSET          " + KEEPERHUB_USDC_SYMBOL,
    "RECIPIENT      " + request.recipientAddress,
    "AMOUNT         " + request.amount + " " + KEEPERHUB_USDC_SYMBOL,
    "TASK ID        " + taskId,
    "IDEMPOTENCY    " + request.idempotencyKey.slice(0, 16) + "…",
    "",
    "THIS WILL MOVE REAL FUNDS ON " + KEEPERHUB_CHAIN_NAME.toUpperCase() + " MAINNET.",
    "Rerun the command with --confirm-real-transfer to broadcast.",
  ].join("\n");
}
