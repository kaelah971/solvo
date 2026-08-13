import type { AuditEventRow } from "../db/types.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { maskClaimWallet } from "../claim/status.ts";
import { maskIdentity } from "./access.ts";
import type { AuditEventSource, AuditView } from "./types.ts";

/**
 * M12.2 — Audit read model.
 *
 * Safe event summaries for the dashboard. Every event maps to a whitelisted
 * view: no raw metadata JSON, no token hashes/prefixes, no execution ids, no
 * transaction hashes (pipeline proof appears only on the payout detail view),
 * no secrets.
 */

const MAX_REASON_CHARS = 140;

/** Event family → source of truth. Agent events never look like payment truth. */
export function auditEventSource(eventType: string): AuditEventSource {
  // Reissue creates a NEW claim row — still a claim-scoped event.
  if (eventType.startsWith("claim_")) return "claim";
  if (eventType.startsWith("agent_")) return "agent";
  if (
    eventType.startsWith("member_") ||
    eventType.startsWith("recipient_") ||
    eventType === "role_changed" ||
    eventType === "workspace_initialized" ||
    eventType === "policy_blocked"
  ) {
    return "workspace";
  }
  return "payout";
}

/** Read a string/number from metadata, else null. */
function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function metaNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000) {
    return value;
  }
  return null;
}

/** Whitelisted metadata summary. Keys outside this list are never surfaced. */
export function summarizeAuditMetadata(metadata: Record<string, unknown>): AuditView["summary"] {
  const summary: NonNullable<AuditView["summary"]> = {};
  let hasContent = false;

  const amount = metaString(metadata, "amountBaseUnits");
  if (amount !== null) {
    summary.amountUsdc = baseUnitsToUsdc(BigInt(amount));
    hasContent = true;
  }
  const total = metaString(metadata, "totalBaseUnits");
  if (total !== null) {
    summary.totalUsdc = baseUnitsToUsdc(BigInt(total));
    hasContent = true;
  }
  const itemCount = metaNumber(metadata, "itemCount");
  if (itemCount !== null) {
    summary.itemCount = itemCount;
    hasContent = true;
  }
  const reason = metaString(metadata, "reason");
  if (reason !== null) {
    summary.reason = reason.length > MAX_REASON_CHARS ? `${reason.slice(0, MAX_REASON_CHARS)}…` : reason;
    hasContent = true;
  }
  const batchId = metaString(metadata, "batchId");
  if (batchId !== null) {
    summary.batchId = batchId;
    hasContent = true;
  }
  const oldClaimId = metaString(metadata, "oldClaimId");
  if (oldClaimId !== null) {
    summary.oldClaimId = oldClaimId;
    hasContent = true;
  }
  const newClaimId = metaString(metadata, "newClaimId");
  if (newClaimId !== null) {
    summary.newClaimId = newClaimId;
    hasContent = true;
  }
  const claimedRecipient = metaString(metadata, "claimedRecipient");
  if (claimedRecipient !== null) {
    summary.maskedRecipient = maskClaimWallet(claimedRecipient);
    hasContent = true;
  }

  return hasContent ? summary : null;
}

/** Build the safe audit view for one event. */
export function buildAuditView(event: AuditEventRow): AuditView {
  return {
    eventId: event.id,
    eventType: event.event_type,
    actorType: event.actor_type,
    actorMaskedId: maskIdentity(event.actor_id),
    createdAt: event.created_at,
    payoutId: event.payout_id,
    payoutItemId: event.payout_item_id,
    claimId: metaString(event.metadata, "claimId"),
    source: auditEventSource(event.event_type),
    summary: summarizeAuditMetadata(event.metadata),
  };
}
