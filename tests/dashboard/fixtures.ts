import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";
import type { ExecutionState } from "../../src/server/execution/state-machine.ts";

export const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const OWNER = "111222333";
export const APPROVER = "444555666";
export const MEMBER = "777888999";
export const OUTSIDER = "999888777";
export const NOW = "2026-08-13T12:00:00.000Z";
export const DAY_START = "2026-08-13T00:00:00.000Z";
export const TX_HASH = "0x" + "ab".repeat(32);
export const BASE_SCAN = `https://basescan.org/tx/${TX_HASH}`;

export type Fixture = {
  repo: MemoryRepository;
  workspaceId: string;
  otherWorkspaceId: string;
};

/** Seed a workspace with an owner, an approver, and a member. */
export async function makeWorkspace(
  repo: MemoryRepository,
  overrides: { mode?: "community" | "sandbox" | "judge" } = {},
): Promise<string> {
  const workspace = await repo.createWorkspace({
    mode: overrides.mode ?? "community",
    name: "Test WS",
    telegramChatId: "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: OWNER, role: "owner" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
  return workspace.id;
}

export async function makeFixture(): Promise<Fixture> {
  const repo = new MemoryRepository();
  const workspaceId = await makeWorkspace(repo);
  const otherWorkspaceId = await makeWorkspace(repo);
  return { repo, workspaceId, otherWorkspaceId };
}

export async function addPayout(
  repo: MemoryRepository,
  workspaceId: string,
  input: {
    status?: ExecutionState;
    sourceType?: "direct" | "telegram_batch" | "telegram_natural_language" | "claim_link" | "batch_csv" | "telegram_command";
    requesterId?: string | null;
    totalBaseUnits?: string;
  } = {},
): Promise<{ payoutId: string; itemId: string }> {
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: input.requesterId ?? MEMBER,
    sourceType: input.sourceType ?? "direct",
    status: input.status ?? "pending_approval",
    totalAmountBaseUnits: input.totalBaseUnits ?? "50000",
    currencySymbol: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    amountBaseUnits: input.totalBaseUnits ?? "50000",
    memo: "blossom",
    status: input.status ?? "pending_approval",
    idempotencyKey: `payout:${payout.id}:item`,
  });
  return { payoutId: payout.id, itemId: item.id };
}

export async function addCompletedPayout(
  repo: MemoryRepository,
  workspaceId: string,
  input: { requesterId?: string; totalBaseUnits?: string; withHash?: boolean } = {},
): Promise<{ payoutId: string; itemId: string }> {
  const { payoutId, itemId } = await addPayout(repo, workspaceId, {
    status: "completed",
    sourceType: "telegram_command",
    requesterId: input.requesterId ?? MEMBER,
    totalBaseUnits: input.totalBaseUnits ?? "50000",
  });
  // completePayoutItem stamps completed_at (pipeline truth) and, when
  // withHash is true, the tx proof. Without a hash the item is completed but
  // provable only by pipeline state — exactly what the read models must
  // distinguish.
  await repo.completePayoutItem(itemId, input.withHash === false ? "" : TX_HASH, input.withHash === false ? "" : BASE_SCAN);
  return { payoutId, itemId };
}

export async function addClaim(
  repo: MemoryRepository,
  workspaceId: string,
  input: {
    status?: "created" | "claimed" | "approved" | "cancelled" | "executed";
    expiresAt?: string;
    requesterId?: string;
    claimedRecipient?: string | null;
  } = {},
): Promise<{ claimId: string; tokenHash: string; tokenPrefix: string }> {
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId,
    requesterId: input.requesterId ?? MEMBER,
    amountBaseUnits: "50000",
    currencySymbol: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt: input.expiresAt ?? "2026-08-20T00:00:00.000Z",
    idempotencyKey: `claim:${workspaceId}:${token.prefix}`,
  });
  if (input.status === "claimed") {
    await repo.claimClaimLink({
      claimId: claim.id,
      recipientAddress: input.claimedRecipient ?? "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      claimedBy: "123456789",
      nowIso: NOW,
    });
  }
  if (input.status === "cancelled") {
    await repo.transitionClaimStatus(claim.id, ["created"], "cancelled");
  }
  return { claimId: claim.id, tokenHash: token.hash, tokenPrefix: token.prefix };
}

export async function addAgentRun(
  repo: MemoryRepository,
  workspaceId: string,
  input: {
    status?: string;
    provider?: string;
    withJson?: boolean;
    rawText?: string;
  } = {},
): Promise<string> {
  const run = await repo.createAgentRun({
    workspaceId,
    surface: "telegram",
    telegramChatId: "-100777",
    telegramUserId: MEMBER,
    telegramMessageId: "42",
    idempotencyKey: `run:${workspaceId}:${input.rawText ?? "x"}`,
    provider: input.provider ?? "static",
    status: (input.status as never) ?? "received",
    inputHash: "hash",
    rawTextRedacted: input.rawText ?? "pay blossom 0.01 USDC [REDACTED]",
    candidatesJson: input.withJson ? { amounts: [{ raw: "0.01", normalized: "0.01" }] } : {},
  });
  if (input.withJson) {
    await repo.updateAgentRun(run.id, {
      interpretationJson: { intent: { action: "pay" }, intentKind: "prepare_payment" },
      decisionJson: { decision: "prepared_payment" },
      intentKind: "prepare_payment",
      decisionType: "prepared_payment",
    });
  }
  return run.id;
}
