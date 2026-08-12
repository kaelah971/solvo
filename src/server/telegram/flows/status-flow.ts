import type { SolvoRepository } from "../../db/repository.ts";
import { getJudgeConfig, isJudgeAdmin, type JudgeConfig } from "../../judge/config.ts";
import { judgeStatusMessage } from "../../judge/messages.ts";
import { claimStatusMessage } from "../../claim/messages.ts";
import { JUDGE_DAILY_SPEND_STATES, JUDGE_SUCCESSFUL_STATES, utcDayStartIso } from "./judge-flow.ts";
import { batchStatusMessage } from "../batch-messages.ts";
import { communityStatusMessage, notInWorkspaceStatusMessage } from "../community-messages.ts";
import { fundsMovedNote, notFound, statusMessage } from "../messages.ts";
import type { StatusReply } from "../types.ts";

export type StatusContext = {
  userId?: string;
  chatId?: string;
  /** injected for tests; default reads process env */
  judgeConfig?: JudgeConfig;
};

const JUDGE_LIFETIME_START_ISO = "1970-01-01T00:00:00.000Z";

export async function handleStatusInstruction(
  payoutId: string,
  repo: SolvoRepository,
  context: StatusContext = {},
): Promise<StatusReply> {
  const payout = await repo.getPayoutById(payoutId);
  if (!payout) {
    return { text: notFound(), found: false };
  }
  const items = await repo.getPayoutItemsByPayoutId(payoutId);

  if (context.userId !== undefined && context.chatId !== undefined) {
    const workspace = await repo.getWorkspaceById(payout.workspace_id);
    if (workspace?.mode === "community") {
      const member = await repo.getWorkspaceMember(payout.workspace_id, context.userId);
      if (!member || member.status !== "active" || workspace.telegram_chat_id !== context.chatId) {
        return { text: notInWorkspaceStatusMessage(), found: false };
      }
      const requesterId = payout.requester_id;
      const approvals = await repo.getPayoutApprovalNotes(payoutId);
      const claim = payout.source_type === "claim_link" ? await repo.getClaimLinkByPayoutId(payoutId) : null;
      const claimSection = claim ? `${claimStatusMessage(claim, workspace)}\n\n` : "";
      if (items.length > 1) {
        const labelled = items.map((item) => ({ item, label: item.memo ?? item.recipient_address.slice(0, 10) + "…" }));
        return {
          text: claimSection + batchStatusMessage(payout, labelled, workspace, requesterId),
          found: true,
        };
      }
      const item = items[0];
      return {
        text: item
          ? claimSection + communityStatusMessage(payout, item, requesterId, approvals, workspace)
          : claimSection + statusMessage(payout, items, fundsMovedNote(payout)),
        found: true,
      };
    }
    if (workspace?.mode === "judge") {
      const judgeConfig = context.judgeConfig ?? getJudgeConfig();
      const isOwner = payout.requester_id === context.userId;
      const isAdmin = isJudgeAdmin(context.userId, judgeConfig);
      if (!isOwner && !isAdmin) {
        // Do not leak payout existence to other users.
        return { text: notFound(), found: false };
      }
      const item = items[0];
      if (!item) {
        return { text: statusMessage(payout, items, fundsMovedNote(payout)), found: true };
      }
      const todaySpend = await repo.sumPayoutItemsByWorkspaceStates(
        workspace.id,
        JUDGE_DAILY_SPEND_STATES,
        utcDayStartIso(),
      );
      const lifetimeSpend = await repo.sumPayoutItemsByWorkspaceStates(
        workspace.id,
        JUDGE_DAILY_SPEND_STATES,
        JUDGE_LIFETIME_START_ISO,
      );
      const successfulByUser = await repo.countPayoutItemsByRequesterStates(
        workspace.id,
        payout.requester_id ?? "",
        JUDGE_SUCCESSFUL_STATES,
      );
      return {
        text: judgeStatusMessage(
          payout,
          item,
          workspace,
          todaySpend,
          judgeConfig.dailyLimitBaseUnits,
          lifetimeSpend,
          judgeConfig.lifetimeLimitBaseUnits,
          successfulByUser,
          judgeConfig.maxSuccessfulPaymentsPerUser,
        ),
        found: true,
      };
    }
  }

  return { text: statusMessage(payout, items, fundsMovedNote(payout)), found: true };
}
