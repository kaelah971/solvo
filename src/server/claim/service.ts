import type { SolvoRepository } from "../db/repository.ts";
import type { ClaimLinkRow, WorkspaceRow } from "../db/types.ts";
import { isValidEvmAddress, normalizeAddress } from "../keeperhub/address.ts";
import { ExecutionService, type KeeperHubExecutionGateway } from "../execution/execution-service.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../keeperhub/config.ts";
import { evaluateCommunityApproval } from "../telegram/policy.ts";
import {
  claimApprovedExecutingMessage,
  claimCallbackAlreadyHandledMessage,
  claimCallbackSelfApprovalMessage,
  claimCallbackUnauthorizedMessage,
  claimCallbackWrongChatMessage,
  claimCommunityProofMessage,
} from "./messages.ts";
import { claimTokenIsWellFormed, generateClaimTokenPair, hashClaimToken } from "./token.ts";

export const CLAIM_EXPIRY_HOURS_DEFAULT = 168; // 7 days
export const CLAIM_PAYOUT_ITEM_KEY_PREFIX = "cl:";

export function claimExpiryHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CLAIM_EXPIRY_HOURS?.trim();
  if (!raw) return CLAIM_EXPIRY_HOURS_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24 * 365) {
    throw new Error(`Invalid CLAIM_EXPIRY_HOURS "${raw}": must be an integer between 1 and 8760`);
  }
  return parsed;
}

export function claimExpiresAtIso(hours: number, now = new Date()): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export type CreateClaimResult =
  | { ok: true; claim: ClaimLinkRow; rawToken: string; link: string; appUrl: string }
  | { ok: false; reason: string };

export function createClaim(
  repo: SolvoRepository,
  input: {
    workspace: WorkspaceRow;
    requesterId: string;
    amountBaseUnits: string;
    idempotencyKey: string;
    expiresAt: string;
    appUrl: string;
  },
): Promise<CreateClaimResult>;

export async function createClaim(
  repo: SolvoRepository,
  input: {
    workspace: WorkspaceRow;
    requesterId: string;
    amountBaseUnits: string;
    idempotencyKey: string;
    expiresAt: string;
    appUrl: string;
  },
): Promise<CreateClaimResult> {
  const token = generateClaimTokenPair();
  try {
    const claim = await repo.createClaimLink({
      workspaceId: input.workspace.id,
      requesterId: input.requesterId,
      amountBaseUnits: input.amountBaseUnits,
      currencySymbol: "USDC",
      chainId: input.workspace.chain_id,
      tokenAddress: input.workspace.token_address,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: input.expiresAt,
      idempotencyKey: input.idempotencyKey,
    });
    const link = `${input.appUrl}/claim/${token.raw}`;
    return { ok: true, claim, rawToken: token.raw, link, appUrl: input.appUrl };
  } catch (error) {
    // Unique idempotency-key collision: a duplicate delivery won.
    if (String(error).toLowerCase().includes("unique")) {
      return { ok: false, reason: "This claim instruction was already received." };
    }
    throw error;
  }
}

export type ClaimLookup = { claim: ClaimLinkRow; workspace: WorkspaceRow };

export async function getClaimByRawToken(
  repo: SolvoRepository,
  rawToken: string,
): Promise<ClaimLookup | null> {
  if (!claimTokenIsWellFormed(rawToken)) return null;
  const claim = await repo.getClaimLinkByTokenHash(hashClaimToken(rawToken));
  if (!claim) return null;
  const workspace = await repo.getWorkspaceById(claim.workspace_id);
  if (!workspace) return null;
  return { claim, workspace };
}

/** Effective status: an unclaimed claim past its deadline reads as expired. */
export function effectiveClaimStatus(claim: ClaimLinkRow, nowIso: string): ClaimLinkRow["status"] {
  if (claim.status === "created" && claim.expires_at <= nowIso) return "expired";
  return claim.status;
}

export type SubmitClaimResult =
  | { ok: true; claim: ClaimLinkRow }
  | { ok: false; reason: string; kind: "not_found" | "expired" | "already_claimed" | "invalid_address" | "cancelled" };

/**
 * Records the claimed recipient. NEVER moves funds and never creates a
 * payout — a claimed wallet can never cause automatic execution.
 */
export async function submitClaimRecipient(
  repo: SolvoRepository,
  rawToken: string,
  address: string,
  claimedBy: string,
  nowIso: string,
): Promise<SubmitClaimResult> {
  if (!claimTokenIsWellFormed(rawToken)) {
    return { ok: false, kind: "not_found", reason: "Claim link not found." };
  }
  const claim = await repo.getClaimLinkByTokenHash(hashClaimToken(rawToken));
  if (!claim) {
    return { ok: false, kind: "not_found", reason: "Claim link not found." };
  }
  const effective = effectiveClaimStatus(claim, nowIso);
  if (effective === "expired") {
    return { ok: false, kind: "expired", reason: "This claim link has expired." };
  }
  if (effective !== "created") {
    if (effective === "claimed" || effective === "approved" || effective === "executed") {
      return {
        ok: false,
        kind: "already_claimed",
        reason: "This claim link has already been claimed.",
        ...(claim.claimed_recipient ? { claim } : {}),
      };
    }
    return { ok: false, kind: "cancelled", reason: "This claim link was cancelled." };
  }
  const validation = isValidEvmAddress(address);
  if (!validation.ok) {
    return { ok: false, kind: "invalid_address", reason: validation.reason };
  }
  const claimed = await repo.claimClaimLink({
    claimId: claim.id,
    recipientAddress: normalizeAddress(address),
    claimedBy,
    nowIso,
  });
  if (!claimed) {
    // Lost a race or the deadline passed mid-flight: never mutate twice.
    return { ok: false, kind: "already_claimed", reason: "This claim link has already been claimed." };
  }
  return { ok: true, claim: claimed };
}

// ── Approval (mirrors M4 semantics: owner/approver only, no self-approval) ──

export type ClaimApprovalCallbackInput = {
  claimId: string;
  action: "claim_approve" | "claim_reject";
  actorUserId: string;
  chatId: string;
};

export type ClaimApprovalCallbackResult = {
  answer: string;
  edited?: string;
  executed?: boolean;
};

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

export type ClaimApprovalValidation =
  | { ok: true; context: { claim: ClaimLinkRow; workspace: WorkspaceRow; actorRole: "owner" | "approver"; actorUserId: string; action: "claim_approve" | "claim_reject" } }
  | { ok: false; result: ClaimApprovalCallbackResult };

export async function validateClaimApprovalCallback(
  input: ClaimApprovalCallbackInput,
  repo: SolvoRepository,
): Promise<ClaimApprovalValidation> {
  const claim = await repo.getClaimLinkById(input.claimId);
  if (!claim) return { ok: false, result: claimCallbackAlreadyHandledMessage() };

  const workspace = await repo.getWorkspaceById(claim.workspace_id);
  if (!workspace) return { ok: false, result: claimCallbackAlreadyHandledMessage() };
  if (workspace.mode !== "community" || workspace.telegram_chat_id !== input.chatId) {
    return { ok: false, result: claimCallbackWrongChatMessage() };
  }

  const member = await repo.getWorkspaceMember(workspace.id, input.actorUserId);
  if (!member || member.status !== "active" || member.role === "member") {
    return { ok: false, result: claimCallbackUnauthorizedMessage() };
  }
  const actorRole: "owner" | "approver" = member.role === "owner" ? "owner" : "approver";

  if (claim.status !== "claimed") {
    return { ok: false, result: claimCallbackAlreadyHandledMessage() };
  }

  if (input.action === "claim_approve" && claim.requester_id === input.actorUserId) {
    return { ok: false, result: claimCallbackSelfApprovalMessage() };
  }

  return { ok: true, context: { claim, workspace, actorRole, actorUserId: input.actorUserId, action: input.action } };
}

export async function applyClaimApprovalCallback(
  context: Extract<ClaimApprovalValidation, { ok: true }>["context"],
  deps: { repo: SolvoRepository; gateway?: KeeperHubExecutionGateway },
): Promise<ClaimApprovalCallbackResult> {
  const { claim, workspace, actorRole, actorUserId, action } = context;

  if (action === "claim_reject") {
    try {
      await deps.repo.transaction(async (tx) => {
        await tx.transitionClaimStatus(claim.id, ["claimed"], "cancelled");
        await tx.appendAuditEvent({
          workspaceId: workspace.id,
          payoutId: null,
          payoutItemId: null,
          eventType: "claim_rejected",
          actorType: actorRole === "owner" ? "workspace_owner" : "approver",
          actorId: actorUserId,
          metadata: { claimId: claim.id, amountBaseUnits: claim.amount_base_units },
        });
      });
    } catch {
      return claimCallbackAlreadyHandledMessage();
    }
    return {
      answer: "Claim rejected. No funds moved and nothing was submitted.",
      edited: "CLAIM REJECTED\n\nNo funds moved. The claim link is cancelled.",
    };
  }

  // Approve: atomic claimed → approved + payout creation, then execute.
  try {
    const created = await deps.repo.transaction(async (tx) => {
      // Serialize capacity accounting per workspace: concurrent approvals of
      // different claims (or claim vs /pay) cannot jointly overspend the
      // daily cap.
      await tx.lockWorkspaceForUpdate(workspace.id);
      const dailySpend = await tx.sumPayoutItemsByWorkspaceStates(
        workspace.id,
        DAILY_SPEND_STATES,
        utcDayStartIso(),
      );
      const policy = evaluateCommunityApproval({
        workspaceActive: workspace.status === "active",
        actorRole,
        actorIsRequester: claim.requester_id === actorUserId,
        perTransactionLimitBaseUnits: workspace.per_transaction_limit_base_units,
        dailyLimitBaseUnits: workspace.daily_limit_base_units,
        currentDailySpendBaseUnits: dailySpend,
        amountBaseUnits: claim.amount_base_units,
      });
      if (policy.decision === "blocked") {
        throw new ClaimApprovalBlockedError(policy.reason);
      }
      const approved = await tx.transitionClaimStatus(claim.id, ["claimed"], "approved");
      const payout = await tx.createPayout({
        workspaceId: workspace.id,
        requesterId: claim.requester_id,
        sourceType: "claim_link",
        status: "approved",
        totalAmountBaseUnits: claim.amount_base_units,
        currencySymbol: claim.currency_symbol,
        chainId: claim.chain_id,
        tokenAddress: claim.token_address,
      });
      const { item } = await tx.createPayoutItem({
        payoutId: payout.id,
        recipientAddress: approved.claimed_recipient as string,
        amountBaseUnits: claim.amount_base_units,
        memo: `claim ${claim.token_prefix}`,
        status: "approved",
        idempotencyKey: `${CLAIM_PAYOUT_ITEM_KEY_PREFIX}${claim.id}`,
      });
      await tx.setClaimPayoutId(claim.id, payout.id);
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: payout.id,
        payoutItemId: item.id,
        eventType: "claim_approved",
        actorType: actorRole === "owner" ? "workspace_owner" : "approver",
        actorId: actorUserId,
        metadata: { claimId: claim.id, claimedRecipient: approved.claimed_recipient, amountBaseUnits: claim.amount_base_units },
      });
      return { payoutId: payout.id, itemId: item.id };
    });

    let gateway: KeeperHubExecutionGateway;
    try {
      gateway = deps.gateway ?? (await import("../telegram/flows/execution-gateway.ts")).getRealExecutionGateway();
    } catch {
      return {
        answer: "Approved, but KeeperHub execution is not configured on this server. Nothing was submitted.",
      };
    }
    const execution = new ExecutionService(deps.repo, gateway, {
      chainId: KEEPERHUB_CHAIN_ID,
      tokenAddress: KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase(),
    });
    const outcome = await execution.executePayoutItem(created.itemId);

    if (outcome.kind === "completed") {
      try {
        await deps.repo.transaction(async (tx) => {
          await tx.transitionClaimStatus(claim.id, ["approved"], "executed");
          await tx.appendAuditEvent({
            workspaceId: workspace.id,
            payoutId: created.payoutId,
            payoutItemId: null,
            eventType: "claim_executed",
            actorType: "system",
            actorId: null,
            metadata: { claimId: claim.id, executionId: outcome.executionId, transactionHash: outcome.transactionHash },
          });
        });
      } catch {
        // claim status is best-effort after the payout itself completed
      }
      return {
        answer: "Claim approved and payment completed.",
        edited: claimCommunityProofMessage(
          outcome.executionId ?? "",
          outcome.transactionHash ?? "",
          claim.amount_base_units,
          (await deps.repo.getClaimLinkById(claim.id))?.claimed_recipient ?? "",
        ),
        executed: true,
      };
    }

    if (outcome.kind === "unknown") {
      return {
        answer: "Claim approved. Payment submitted; outcome unknown — Solvo will not retry automatically.",
        edited: "CLAIM APPROVED\n\nPayment submitted but outcome is not yet known. Use /status to inspect. No automatic retry.",
        executed: true,
      };
    }

    return {
      answer: "Claim approved but the payment did not complete.",
      edited: claimApprovedExecutingMessage(),
      executed: true,
    };
  } catch (error) {
    if (error instanceof ClaimApprovalBlockedError) {
      return { answer: error.reason };
    }
    return claimCallbackAlreadyHandledMessage();
  }
}

class ClaimApprovalBlockedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "ClaimApprovalBlockedError";
    this.reason = reason;
  }
}
