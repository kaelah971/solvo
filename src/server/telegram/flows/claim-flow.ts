import type { SolvoRepository } from "../../db/repository.ts";
import { parseUsdcAmount } from "../../keeperhub/amount.ts";
import { usdcToBaseUnits } from "../../execution/money.ts";
import { evaluateCommunityRequest } from "../policy.ts";
import {
  claimAlreadyReceivedMessage,
  claimBlockedMessage,
  claimCreatedMessage,
  claimInvalidMessage,
} from "../../claim/messages.ts";
import { createClaim, claimExpiryHours, claimExpiresAtIso } from "../../claim/service.ts";
import { appUrl } from "../../../lib/config.ts";
import type { ClaimPayInstruction, CommunityReply, TelegramUser } from "../types.ts";

export type ClaimFlowDeps = {
  repo: SolvoRepository;
};

export type ClaimReply = CommunityReply & {
  outcome: "created" | "existing" | "unauthorized" | "wrong_context" | "invalid" | "blocked";
  claimId: string | null;
};

export function claimIdempotencyKey(user: TelegramUser): string {
  const messagePart = user.messageId !== null ? `m${user.messageId}` : `u${user.updateId}`;
  return `tg:${user.chatId}:${messagePart}:claimpay`;
}

/**
 * /claimpay <amount> USDC — creates a one-time claim link in a COMMUNITY
 * workspace. A claim is an INTENT: the recipient later submits a wallet via
 * the link, and execution only happens after an owner/approver approves the
 * claimed destination (separation of duty preserved). Judge Mode is not
 * affected; /claimpay is never a public execution surface.
 */
export async function handleClaimPayInstruction(
  input: { instruction: ClaimPayInstruction; user: TelegramUser },
  deps: ClaimFlowDeps,
): Promise<ClaimReply> {
  const { instruction, user } = input;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(user.chatId);
  if (!workspace) {
    return {
      text: "This group is not a Solvo workspace yet. An authorized operator must run /workspace init.",
      outcome: "wrong_context",
      claimId: null,
    };
  }
  if (workspace.mode !== "community") {
    return {
      text: "Claim links are only available inside a community workspace.",
      outcome: "wrong_context",
      claimId: null,
    };
  }
  const member = await deps.repo.getWorkspaceMember(workspace.id, user.userId);
  if (!member || member.status !== "active") {
    return {
      text: "You are not a member of this workspace.",
      outcome: "unauthorized",
      claimId: null,
    };
  }

  const amount = parseUsdcAmount(instruction.amount);
  if (!amount.ok) {
    return {
      text: claimInvalidMessage(amount.reason),
      outcome: "invalid",
      claimId: null,
    };
  }
  const amountUnits = usdcToBaseUnits(amount.amount);
  if (!amountUnits.ok || amountUnits.value <= 0n) {
    return {
      text: claimInvalidMessage("Amount must be greater than zero."),
      outcome: "invalid",
      claimId: null,
    };
  }
  const amountBaseUnits = amountUnits.value.toString();

  const policy = evaluateCommunityRequest({
    workspaceActive: workspace.status === "active",
    isMember: true,
    amountBaseUnits,
    chainId: workspace.chain_id,
    tokenAddress: workspace.token_address,
    perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
  });
  if (policy.decision === "blocked") {
    return {
      text: claimBlockedMessage(policy.reason),
      outcome: "blocked",
      claimId: null,
    };
  }

  const idempotencyKey = claimIdempotencyKey(user);
  const existing = await deps.repo.getClaimLinkByIdempotencyKey(idempotencyKey);
  if (existing) {
    return {
      text: claimAlreadyReceivedMessage(existing),
      outcome: "existing",
      claimId: existing.id,
    };
  }

  const expiryHours = claimExpiryHours();
  const expiresAt = claimExpiresAtIso(expiryHours);
  const persisted = await deps.repo.transaction(async (tx) => {
    // Advisory lock: concurrent duplicate /claimpay deliveries resolve to ONE
    // claim link, never a second intent.
    await tx.lockIdempotencyKey(idempotencyKey);
    const raced = await tx.getClaimLinkByIdempotencyKey(idempotencyKey);
    if (raced) {
      return { duplicate: true, claim: raced, rawToken: null, link: null };
    }
    const result = await createClaim(tx, {
      workspace,
      requesterId: user.userId,
      amountBaseUnits,
      idempotencyKey,
      expiresAt,
      appUrl,
    });
    if (!result.ok) {
      return { duplicate: false, claim: null, rawToken: null, link: null, blockedReason: result.reason };
    }
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_created",
      actorType: "member",
      actorId: user.userId,
      metadata: {
        claimId: result.claim.id,
        amountBaseUnits,
        tokenPrefix: result.claim.token_prefix,
        expiresAt: result.claim.expires_at,
      },
    });
    return { duplicate: false, claim: result.claim, rawToken: result.rawToken, link: result.link, blockedReason: null };
  });

  if (persisted.duplicate && persisted.claim) {
    return {
      text: claimAlreadyReceivedMessage(persisted.claim),
      outcome: "existing",
      claimId: persisted.claim.id,
    };
  }
  if (!persisted.claim || !persisted.rawToken || !persisted.link) {
    return {
      text: claimBlockedMessage(persisted.blockedReason ?? "The claim could not be created."),
      outcome: "blocked",
      claimId: null,
    };
  }

  return {
    text: claimCreatedMessage(persisted.claim, persisted.link, persisted.claim.expires_at),
    outcome: "created",
    claimId: persisted.claim.id,
  };
}
