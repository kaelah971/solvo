import type { SolvoRepository } from "../../db/repository.ts";
import { isValidEvmAddress, normalizeAddress } from "../../keeperhub/address.ts";
import { parseUsdcAmount } from "../../keeperhub/amount.ts";
import { usdcToBaseUnits } from "../../execution/money.ts";
import { batchPreview, BATCH_MAX_ITEMS } from "../batch-messages.ts";
import {
  approvalCallbackData,
  notAMemberMessage,
  recipientUnknownMessage,
  workspaceNotFoundForGroupMessage,
} from "../community-messages.ts";
import { evaluateBatchRequest } from "../policy.ts";
import { telegramIdempotencyKey } from "./pay-flow.ts";
import type { BatchInstruction, CommunityReply, TelegramUser } from "../types.ts";

export type CommunityBatchDeps = {
  repo: SolvoRepository;
};

export type BatchLine = {
  raw: string;
  recipient: string;
  amount: string;
  token: "USDC";
};

export type ValidatedBatchItem = {
  label: string;
  address: string;
  amountBaseUnits: string;
  line: BatchLine;
};

const ADDRESS = "(?:0x[0-9a-fA-F]{40})";
const AMOUNT = "(\\d+(?:\\.\\d+)?)";
const ALIAS = "(?:[a-z0-9][a-z0-9_-]{0,31})";
const RECIPIENT = `(${ADDRESS}|${ALIAS})`;

const SPACE_LINE = new RegExp(`^\\s*${RECIPIENT}\\s+${AMOUNT}\\s+usdc\\s*$`, "i");
const COMMA_LINE = new RegExp(`^\\s*${RECIPIENT}\\s*,\\s*${AMOUNT}(?:\\s+usdc)?\\s*$`, "i");

/** Deterministic per-line parsing: `<recipient> <amount> USDC` or `<recipient>,<amount>`. */
export function parseBatchLine(raw: string): BatchLine | { error: string } {
  const line = raw.trim();
  if (line.length === 0) return { error: "Empty line." };
  if (line.startsWith("@")) {
    return { error: `Usernames cannot authorize actions: "${line}". Use an alias or 0x address.` };
  }

  const space = SPACE_LINE.exec(line);
  if (space) {
    return { recipient: space[1], amount: space[2], token: "USDC", raw: line };
  }
  const comma = COMMA_LINE.exec(line);
  if (comma) {
    return { recipient: comma[1], amount: comma[2], token: "USDC", raw: line };
  }
  if (/[a-zA-Z]+/.test(line.split(/\s|,/)[0] ?? "")) {
    return { error: `Unknown token in line: "${line}". Solvo executes Base USDC only.` };
  }
  return {
    error: `Malformed line: "${line}". Use "<alias or 0x address> <amount> USDC" or "<alias or 0x address>,<amount>".`,
  };
}

export function parseBatchBody(body: string): { lines: BatchLine[]; errors: string[] } {
  const errors: string[] = [];
  const lines: BatchLine[] = [];
  for (const raw of body.split(/\r?\n/)) {
    if (raw.trim().length === 0) continue;
    const parsed = parseBatchLine(raw);
    if ("error" in parsed) {
      errors.push(parsed.error);
    } else {
      lines.push(parsed);
    }
  }
  return { lines, errors };
}

export async function handleCommunityBatchInstruction(
  input: { instruction: BatchInstruction; user: TelegramUser },
  deps: CommunityBatchDeps,
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

  const { lines, errors } = parseBatchBody(instruction.body);
  if (errors.length > 0) {
    return { text: ["BATCH REJECTED — INVALID LINES", "", ...errors].join("\n") };
  }
  if (lines.length === 0) {
    return { text: "The batch is empty. Add one recipient per line." };
  }
  if (lines.length > BATCH_MAX_ITEMS) {
    return {
      text: `BATCH REJECTED — too many recipients (${lines.length}). Maximum is ${BATCH_MAX_ITEMS} per batch.`,
    };
  }

  const validation = await validateBatchItems(lines, workspace.id, deps.repo);
  if (!validation.ok) {
    return { text: validation.reason };
  }

  const totalBaseUnits = validation.items.reduce((sum, item) => sum + BigInt(item.amountBaseUnits), 0n).toString();
  const dailySpend = await deps.repo.sumPayoutItemsByWorkspaceStates(
    workspace.id,
    DAILY_SPEND_STATES,
    utcDayStartIso(),
  );
  const policy = evaluateBatchRequest({
    workspaceActive: workspace.status === "active",
    isMember: true,
    chainId: workspace.chain_id,
    tokenAddress: workspace.token_address,
    items: validation.items.map((item) => ({
      amountBaseUnits: item.amountBaseUnits,
      perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
    })),
    totalBaseUnits,
    dailyLimitBaseUnits: workspace.daily_limit_base_units,
    currentDailySpendBaseUnits: dailySpend,
  });
  if (policy.decision === "blocked") {
    return { text: policy.reason };
  }

  const idempotencyKeys = validation.items.map((_, index) => batchItemIdempotencyKey(user, index));
  const existing = await deps.repo.getPayoutItemByIdempotencyKey(idempotencyKeys[0]);
  if (existing) {
    const loaded = await deps.repo.getPayoutItemForExecution(existing.id);
    const state = loaded?.item.status ?? "unknown";
    return {
      text: [
        `This batch instruction was already received.\nCurrent state: ${state.toUpperCase()}\nNo duplicate batch was created.`,
        "",
        batchPreview(user.userId, existing.payout_id, validation.items),
      ].join("\n"),
    };
  }

  const persisted = await deps.repo.transaction(async (tx) => {
    // Advisory lock on the batch's first idempotency key: concurrent duplicate
    // deliveries resolve to ONE batch intent, never a second payout.
    await tx.lockIdempotencyKey(idempotencyKeys[0]);
    const raced = await tx.getPayoutItemByIdempotencyKey(idempotencyKeys[0]);
    if (raced) {
      const loaded = await tx.getPayoutItemForExecution(raced.id);
      return {
        duplicate: true,
        payoutId: raced.payout_id,
        state: loaded?.item.status ?? "unknown",
      };
    }
    const payout = await tx.createPayout({
      workspaceId: workspace.id,
      requesterId: user.userId,
      sourceType: "telegram_batch",
      status: "pending_approval",
      totalAmountBaseUnits: totalBaseUnits,
      currencySymbol: "USDC",
      chainId: workspace.chain_id,
      tokenAddress: workspace.token_address,
    });
    for (let index = 0; index < validation.items.length; index += 1) {
      const item = validation.items[index];
      const { item: createdItem, created } = await tx.createPayoutItem({
        payoutId: payout.id,
        recipientAddress: item.address,
        amountBaseUnits: item.amountBaseUnits,
        memo: item.label,
        status: "pending_approval",
        idempotencyKey: idempotencyKeys[index],
      });
      if (!created) {
        const loaded = await tx.getPayoutItemForExecution(createdItem.id);
        return { duplicate: true, payoutId: createdItem.payout_id, state: loaded?.item.status ?? "unknown" };
      }
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: createdItem.id,
        eventType: "request_created",
        actorType: "member",
        actorId: user.userId,
        metadata: {
          source: "telegram_batch",
          channel: "telegram",
          alias: item.label,
          index,
        },
      });
    }
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: payout.id,
      payoutItemId: null,
      eventType: "approval_required",
      actorType: "member",
      actorId: user.userId,
      metadata: { reason: policy.reason, itemCount: validation.items.length, totalBaseUnits },
    });
    return { duplicate: false, payoutId: payout.id, state: null };
  });

  if (persisted.duplicate) {
    return {
      text: [
        `This batch instruction was already received.\nCurrent state: ${String(persisted.state).toUpperCase()}\nNo duplicate batch was created.`,
        "",
        batchPreview(user.userId, persisted.payoutId, validation.items),
      ].join("\n"),
    };
  }

  return {
    text: batchPreview(user.userId, persisted.payoutId, validation.items),
    buttons: [
      { text: "APPROVE BATCH", callbackData: approvalCallbackData("approve", persisted.payoutId) },
      { text: "REJECT", callbackData: approvalCallbackData("reject", persisted.payoutId) },
    ],
  };
}

export function batchItemIdempotencyKey(user: TelegramUser, index: number): string {
  return `${telegramIdempotencyKey(user)}:batch:${index}`;
}

const DAILY_SPEND_STATES = [
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "execution_unknown",
] as const;

function utcDayStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Resolves and validates every batch item. Duplicate resolved addresses are
 * rejected deterministically — money is never silently merged.
 */
export async function validateBatchItems(
  lines: BatchLine[],
  workspaceId: string,
  repo: SolvoRepository,
): Promise<{ ok: true; items: ValidatedBatchItem[] } | { ok: false; reason: string }> {
  const seenAddresses = new Map<string, string>();
  const items: ValidatedBatchItem[] = [];

  for (const line of lines) {
    const recipient = line.recipient;
    const address = /^0x/i.test(recipient)
      ? recipient
      : (await repo.getRecipientByAlias(workspaceId, recipient.toLowerCase()))?.wallet_address ?? null;

    if (!address) {
      return { ok: false, reason: recipientUnknownMessage(recipient) };
    }
    const validation = isValidEvmAddress(address);
    if (!validation.ok) {
      return { ok: false, reason: `Invalid recipient ${recipient}: ${validation.reason}` };
    }
    const amount = parseUsdcAmount(line.amount);
    if (!amount.ok) {
      return { ok: false, reason: `Invalid amount for ${recipient}: ${amount.reason}` };
    }
    const amountUnits = usdcToBaseUnits(amount.amount);
    if (!amountUnits.ok) {
      return { ok: false, reason: `Invalid amount for ${recipient}: ${amountUnits.reason}` };
    }

    const normalized = normalizeAddress(address);
    const previous = seenAddresses.get(normalized);
    if (previous) {
      return {
        ok: false,
        reason: `Duplicate recipient: "${previous}" and "${recipient}" resolve to the same address (${normalized}).`,
      };
    }
    seenAddresses.set(normalized, recipient);

    items.push({
      label: /^0x/i.test(recipient) ? recipient.slice(0, 10) + "…" : recipient.toLowerCase(),
      address: normalized,
      amountBaseUnits: amountUnits.value.toString(),
      line,
    });
  }

  return { ok: true, items };
}
