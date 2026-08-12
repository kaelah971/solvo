import type { SolvoRepository } from "../../db/repository.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT } from "../../keeperhub/config.ts";
import {
  notInGroupMessage,
  unauthorizedInitializerMessage,
  workspaceInitMessage,
  workspaceNotFoundForGroupMessage,
} from "../community-messages.ts";
import type { CommunityCommandReply, TelegramUser } from "../types.ts";

export const COMMUNITY_PER_TRANSACTION_LIMIT = "100000";
export const COMMUNITY_DAILY_LIMIT = "1000000";

export type WorkspaceFlowDeps = {
  repo: SolvoRepository;
};

export async function handleWorkspaceInit(
  input: { user: TelegramUser; allowedDevUserIds: ReadonlySet<string> },
  deps: WorkspaceFlowDeps,
): Promise<CommunityCommandReply> {
  const { user, allowedDevUserIds } = input;
  if (user.chatType !== "group" && user.chatType !== "supergroup") {
    return { text: notInGroupMessage(), outcome: "wrong_context" };
  }
  if (!allowedDevUserIds.has(user.userId)) {
    return { text: unauthorizedInitializerMessage(), outcome: "unauthorized" };
  }

  const existing = await deps.repo.getWorkspaceByTelegramChatId(user.chatId);
  if (existing) {
    if (existing.mode !== "community") {
      return { text: workspaceNotFoundForGroupMessage(), outcome: "invalid" };
    }
    return { text: workspaceInitMessage("existing", existing, "owner"), outcome: "existing" };
  }

  const workspace = await deps.repo.transaction(async (tx) => {
    const created = await tx.createWorkspace({
      mode: "community",
      name: "Community",
      telegramChatId: user.chatId,
      chainId: KEEPERHUB_CHAIN_ID,
      tokenAddress: KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase(),
      perTransactionLimitBaseUnits: COMMUNITY_PER_TRANSACTION_LIMIT,
      dailyLimitBaseUnits: COMMUNITY_DAILY_LIMIT,
      approvalPolicy: "requires_approval",
    });
    const { member } = await tx.addWorkspaceMember({
      workspaceId: created.id,
      telegramUserId: user.userId,
      role: "owner",
    });
    await tx.appendAuditEvent({
      workspaceId: created.id,
      payoutId: null,
      payoutItemId: null,
      eventType: "workspace_initialized",
      actorType: "workspace_owner",
      actorId: user.userId,
      metadata: { chatId: user.chatId, memberId: member.id },
    });
    await tx.appendAuditEvent({
      workspaceId: created.id,
      payoutId: null,
      payoutItemId: null,
      eventType: "member_added",
      actorType: "workspace_owner",
      actorId: user.userId,
      metadata: { telegramUserId: user.userId, role: "owner" },
    });
    return created;
  });

  return { text: workspaceInitMessage("created", workspace, "owner"), outcome: "created" };
}
