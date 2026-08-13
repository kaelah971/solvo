import { randomUUID } from "node:crypto";

import type { SolvoRepository } from "../db/repository.ts";
import type { ClaimLinkRow, WorkspaceMemberRow } from "../db/types.ts";
import { generateClaimTokenPair } from "./token.ts";

/**
 * M11.5 — Claim reissue (service only; no Telegram/web wiring yet).
 *
 * Reissue means: create a NEW claim link (new row, new 192-bit token, new
 * expiry) for the same amount/currency/network/workspace/requester. The old
 * claim is NEVER mutated or resurrected: it stays `created` (reading as
 * `expired`) or `cancelled`, its token stays unusable, and its raw token is
 * never re-exposed.
 *
 * Gate (mirrors the M11.2 status gate + role system):
 *  - actor must be an ACTIVE owner or approver of the SAME workspace;
 *  - unknown claim id, wrong workspace, inactive member, non-member, and
 *    plain members all collapse to ONE generic "denied" result (no leak);
 *  - eligibility: only `created` (pending/expired) or `cancelled` claims may
 *    be reissued; claimed/approved/executed claims cannot.
 *
 * Reissue creates NO payout, NO payout item, NO approval, NO execution, and
 * makes no KeeperHub call. Each explicit call creates a distinct new claim.
 */
export const REISSUE_DEFAULT_EXPIRY_HOURS = 168;

export type ReissueClaimLinkInput = {
  repo: SolvoRepository;
  workspaceId: string;
  member: WorkspaceMemberRow | null;
  claimId: string;
  nowIso: string;
  claimExpiryHours?: number;
  /** When provided, produces the public one-time link (shown exactly once). */
  appUrl?: string;
};

export type ReissueClaimLinkResult =
  | {
      ok: true;
      claimId: string;
      /** One-time raw token, returned exactly once (never stored). */
      rawToken: string;
      link: string | null;
      amountBaseUnits: string;
      currency: string;
      chainId: string;
      expiresAt: string;
      workspaceId: string;
      requesterId: string;
    }
  | { ok: false; kind: "denied" | "ineligible"; reason: string };

const DENIED_REASON = "You cannot reissue this claim link.";

export async function reissueClaimLink(input: ReissueClaimLinkInput): Promise<ReissueClaimLinkResult> {
  if (input.member === null || input.member.status !== "active" || input.member.role === "member") {
    return { ok: false, kind: "denied", reason: DENIED_REASON };
  }
  const memberRow = await input.repo.getWorkspaceMember(input.workspaceId, input.member.telegram_user_id);
  if (memberRow === null || memberRow.status !== "active" || memberRow.workspace_id !== input.workspaceId) {
    return { ok: false, kind: "denied", reason: DENIED_REASON };
  }
  if (memberRow.role === "member") {
    return { ok: false, kind: "denied", reason: DENIED_REASON };
  }

  const claim = await input.repo.getClaimLinkById(input.claimId);
  if (claim === null) return { ok: false, kind: "denied", reason: DENIED_REASON };
  if (claim.workspace_id !== input.workspaceId) return { ok: false, kind: "denied", reason: DENIED_REASON };

  // Eligibility: only created (pending, incl. computed expired) or cancelled
  // claims may be reissued. A claimed/approved/executed claim is immutable.
  if (claim.status !== "created" && claim.status !== "cancelled") {
    return {
      ok: false,
      kind: "ineligible",
      reason: "This claim cannot be reissued because it was already claimed or approved.",
    };
  }

  const token = generateClaimTokenPair();
  const hours = input.claimExpiryHours ?? REISSUE_DEFAULT_EXPIRY_HOURS;
  const expiresAt = new Date(new Date(input.nowIso).getTime() + hours * 60 * 60 * 1000).toISOString();

  let created: ClaimLinkRow;
  try {
    created = await input.repo.createClaimLink({
      workspaceId: input.workspaceId,
      requesterId: claim.requester_id,
      amountBaseUnits: claim.amount_base_units,
      currencySymbol: claim.currency_symbol,
      chainId: claim.chain_id,
      tokenAddress: claim.token_address,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt,
      idempotencyKey: `reissue:${claim.id}:${randomUUID()}`,
    });
  } catch (error) {
    // Unique idempotency-key collision: a concurrent delivery won the reissue.
    if (String(error).toLowerCase().includes("unique")) {
      return { ok: false, kind: "ineligible", reason: "This claim was already reissued." };
    }
    throw error;
  }

  await input.repo.appendAuditEvent({
    workspaceId: input.workspaceId,
    payoutId: null,
    payoutItemId: null,
    eventType: "claim_reissued",
    actorType: memberRow.role === "owner" ? "workspace_owner" : "approver",
    actorId: memberRow.telegram_user_id,
    metadata: {
      oldClaimId: claim.id,
      newClaimId: created.id,
      amountBaseUnits: created.amount_base_units,
      tokenPrefix: created.token_prefix,
      expiresAt: created.expires_at,
    },
  });

  return {
    ok: true,
    claimId: created.id,
    rawToken: token.raw,
    link: input.appUrl !== undefined ? `${input.appUrl}/claim/${token.raw}` : null,
    amountBaseUnits: created.amount_base_units,
    currency: created.currency_symbol,
    chainId: created.chain_id,
    expiresAt: created.expires_at,
    workspaceId: created.workspace_id,
    requesterId: created.requester_id,
  };
}
