import type { SolvoRepository } from "../db/repository.ts";
import type { RecipientRow } from "../db/types.ts";
import { canViewSensitiveDestinations, maskIdentity } from "./access.ts";
import { maskWallet } from "./payouts.ts";
import type { DashboardContext, RecipientListItemView } from "./types.ts";

/**
 * M12.2 — Recipients read model.
 *
 * Workspace-scoped alias directory. Full wallets are owner/approver-only;
 * members see masked addresses (the agent already resolves aliases for them —
 * the dashboard does not widen exposure).
 */
export async function listRecipientViews(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<RecipientListItemView[]> {
  const recipients = await repo.listRecipients(ctx.workspaceId);
  const members = await repo.listWorkspaceMembers(ctx.workspaceId);
  const labelById = new Map(members.map((member) => [member.telegram_user_id, maskIdentity(member.telegram_user_id) ?? "…"]));
  const showFull = canViewSensitiveDestinations(ctx);
  return recipients.map((recipient) => buildRecipientListItemView(recipient, showFull, labelById));
}

export function buildRecipientListItemView(
  recipient: RecipientRow,
  showFullWallet: boolean,
  memberLabels: ReadonlyMap<string, string>,
): RecipientListItemView {
  return {
    recipientId: recipient.id,
    alias: recipient.alias,
    wallet: showFullWallet ? recipient.wallet_address : maskWallet(recipient.wallet_address),
    createdByLabel: recipient.created_by !== null ? memberLabels.get(recipient.created_by) ?? null : null,
    createdAt: recipient.created_at,
    updatedAt: recipient.updated_at,
  };
}
