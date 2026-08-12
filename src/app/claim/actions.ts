"use server";

import { getDbRepository } from "@/server/db/accessor";
import { submitClaimRecipient } from "@/server/claim/service";
import { claimClaimedNotificationMessage } from "@/server/claim/messages";
import { claimCallbackData } from "@/server/telegram/community-messages";
import { getTelegramBot } from "@/server/telegram/bot";
import { serializeBotError } from "@/server/telegram/safe-logging";

export type ClaimSubmitResult = {
  ok: boolean;
  state: "claimed" | "expired" | "already_claimed" | "cancelled" | "not_found" | "invalid_address" | "error";
  message: string;
  recipient?: string;
};

/**
 * Records the recipient's wallet address for a claim link. This NEVER moves
 * funds and never creates a payout: execution requires the original sender/
 * workspace to approve the claimed destination afterwards.
 */
export async function submitClaimDestination(rawToken: string, address: string): Promise<ClaimSubmitResult> {
  const repo = getDbRepository();
  if (!repo) {
    return { ok: false, state: "error", message: "The claim service is not available right now." };
  }

  const trimmed = address.trim();
  const result = await submitClaimRecipient(repo, rawToken, trimmed, "web", new Date().toISOString());

  if (!result.ok) {
    const state =
      result.kind === "expired"
        ? "expired"
        : result.kind === "already_claimed"
          ? "already_claimed"
          : result.kind === "cancelled"
            ? "cancelled"
            : result.kind === "invalid_address"
              ? "invalid_address"
              : "not_found";
    return { ok: false, state, message: result.reason };
  }

  // Best-effort notification to the original Telegram chat with APPROVE /
  // REJECT buttons. Never throws into the page response.
  try {
    const claim = result.claim;
    const workspace = await repo.getWorkspaceById(claim.workspace_id);
    if (workspace?.telegram_chat_id) {
      const bot = getTelegramBot();
      if (bot) {
        await bot.api.sendMessage(workspace.telegram_chat_id, claimClaimedNotificationMessage(claim), {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "APPROVE CLAIM", callback_data: claimCallbackData("claim_approve", claim.id) },
                { text: "REJECT", callback_data: claimCallbackData("claim_reject", claim.id) },
              ],
            ],
          },
        });
      }
    }
  } catch (error) {
    console.error(serializeBotError(error, { action: "claimNotified", claimId: result.claim.id }));
  }

  return {
    ok: true,
    state: "claimed",
    recipient: result.claim.claimed_recipient ?? undefined,
    message: "Destination address recorded. The sender must approve it before anything moves.",
  };
}
