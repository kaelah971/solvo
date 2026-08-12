import type { SolvoRepository } from "../../db/repository.ts";
import { isValidEvmAddress, normalizeAddress } from "../../keeperhub/address.ts";
import { parseUsdcAmount } from "../../keeperhub/amount.ts";
import { usdcToBaseUnits } from "../../execution/money.ts";
import {
  approvalCallbackData,
  communityPayPreview,
  notAMemberMessage,
  recipientUnknownMessage,
  workspaceNotFoundForGroupMessage,
} from "../community-messages.ts";
import { evaluateCommunityRequest } from "../policy.ts";
import { telegramIdempotencyKey } from "./pay-flow.ts";
import type { CommunityReply, PayAliasInstruction, PayInstruction, TelegramUser } from "../types.ts";

export type CommunityPayDeps = {
  repo: SolvoRepository;
};

export async function handleCommunityPayInstruction(
  input: {
    instruction: PayInstruction | PayAliasInstruction;
    user: TelegramUser;
  },
  deps: CommunityPayDeps,
): Promise<CommunityReply> {
  const { instruction, user } = input;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(user.chatId);
  if (!workspace) {
    return { text: workspaceNotFoundForGroupMessage() };
  }

  const member = await deps.repo.getWorkspaceMember(workspace.id, user.userId);
  if (!member || member.status !== "active") {
    return { text: notAMemberMessage() };
  }

  const resolved = await resolveDestination(instruction, workspace.id, deps.repo);
  if (!resolved.ok) {
    return { text: resolved.reason };
  }

  const addressValidation = isValidEvmAddress(resolved.address);
  if (!addressValidation.ok) {
    return { text: `Invalid recipient: ${addressValidation.reason}` };
  }
  const amount = parseUsdcAmount(instruction.amount);
  if (!amount.ok) {
    return { text: `The amount is invalid.\n\n${amount.reason}` };
  }
  const amountUnits = usdcToBaseUnits(amount.amount);
  if (!amountUnits.ok) {
    return { text: `The amount is invalid.\n\n${amountUnits.reason}` };
  }

  const policy = evaluateCommunityRequest({
    workspaceActive: workspace.status === "active",
    isMember: true,
    amountBaseUnits: amountUnits.value.toString(),
    chainId: workspace.chain_id,
    tokenAddress: workspace.token_address,
    perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
  });

  if (policy.decision === "blocked") {
    return { text: policy.reason };
  }

  const idempotencyKey = telegramIdempotencyKey(user);
  const existing = await deps.repo.getPayoutItemByIdempotencyKey(idempotencyKey);
  if (existing) {
    const loaded = await deps.repo.getPayoutItemForExecution(existing.id);
    const state = loaded?.item.status ?? "unknown";
    return {
      text: [
        `This instruction was already received.\nCurrent state: ${state.toUpperCase()}\nNo duplicate request was created.`,
        "",
        communityPayPreview({
          alias: resolved.alias ?? null,
          address: resolved.address,
          amount: amount.amount,
          requesterId: user.userId,
          payoutId: existing.payout_id,
        }),
      ].join("\n"),
    };
  }

  const recipient = normalizeAddress(resolved.address);
  const persisted = await deps.repo.transaction(async (tx) => {
    const payout = await tx.createPayout({
      workspaceId: workspace.id,
      requesterId: user.userId,
      sourceType: instruction.sourceType,
      status: "pending_approval",
      totalAmountBaseUnits: amountUnits.value.toString(),
      currencySymbol: "USDC",
      chainId: workspace.chain_id,
      tokenAddress: workspace.token_address,
    });
    const { item } = await tx.createPayoutItem({
      payoutId: payout.id,
      recipientAddress: recipient,
      amountBaseUnits: amountUnits.value.toString(),
      memo: null,
      status: "pending_approval",
      idempotencyKey,
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "request_created",
      actorType: "member",
      actorId: user.userId,
      metadata: { source: instruction.sourceType, channel: "telegram", alias: resolved.alias ?? null },
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: item.id,
      eventType: "approval_required",
      actorType: "member",
      actorId: user.userId,
      metadata: { reason: policy.reason },
    });
    return { payoutId: payout.id, itemId: item.id };
  });

  const preview = communityPayPreview({
    alias: resolved.alias ?? null,
    address: recipient,
    amount: amount.amount,
    requesterId: user.userId,
    payoutId: persisted.payoutId,
  });

  return {
    text: preview,
    buttons: [
      { text: "APPROVE", callbackData: approvalCallbackData("approve", persisted.payoutId) },
      { text: "REJECT", callbackData: approvalCallbackData("reject", persisted.payoutId) },
    ],
  };
}

async function resolveDestination(
  instruction: PayInstruction | PayAliasInstruction,
  workspaceId: string,
  repo: SolvoRepository,
): Promise<{ ok: true; address: string; alias: string | null } | { ok: false; reason: string }> {
  if (instruction.kind === "pay") {
    return { ok: true, address: instruction.address, alias: null };
  }
  const recipient = await repo.getRecipientByAlias(workspaceId, instruction.alias.toLowerCase());
  if (!recipient) {
    return { ok: false, reason: recipientUnknownMessage(instruction.alias) };
  }
  return { ok: true, address: recipient.wallet_address, alias: recipient.alias };
}
