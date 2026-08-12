import type { SolvoRepository } from "../../db/repository.ts";
import { isValidEvmAddress, normalizeAddress } from "../../keeperhub/address.ts";
import {
  memberRoleNotOwnerMessage,
  notInGroupMessage,
  recipientAddMessage,
  recipientListMessage,
  workspaceNotFoundForGroupMessage,
} from "../community-messages.ts";
import type { CommunityCommandReply, TelegramUser } from "../types.ts";

export type RecipientFlowDeps = {
  repo: SolvoRepository;
};

export async function handleRecipientAdd(
  input: { user: TelegramUser; alias: string; address: string },
  deps: RecipientFlowDeps,
): Promise<CommunityCommandReply> {
  const gate = await membershipGate(input.user, deps.repo, ["owner", "approver"]);
  if (gate) return gate;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };

  const validation = isValidEvmAddress(input.address);
  if (!validation.ok) {
    return { text: `Invalid wallet address: ${validation.reason}`, outcome: "invalid" };
  }
  const alias = input.alias.toLowerCase();
  const walletAddress = normalizeAddress(input.address);

  const { created } = await deps.repo.transaction(async (tx) => {
    const result = await tx.addRecipient({
      workspaceId: workspace.id,
      alias,
      walletAddress,
      createdBy: input.user.userId,
    });
    if (result.created) {
      await tx.appendAuditEvent({
        workspaceId: workspace.id,
        payoutId: null,
        payoutItemId: null,
        eventType: "recipient_added",
        actorType: "approver",
        actorId: input.user.userId,
        metadata: { alias, walletAddress },
      });
    }
    return result;
  });

  return {
    text: recipientAddMessage(created ? "added" : "duplicate_alias", alias),
    outcome: created ? "ok" : "existing",
  };
}

export async function handleRecipientList(
  input: { user: TelegramUser },
  deps: RecipientFlowDeps,
): Promise<CommunityCommandReply> {
  if (input.user.chatType !== "group" && input.user.chatType !== "supergroup") {
    return { text: notInGroupMessage(), outcome: "wrong_context" };
  }
  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };
  const member = await deps.repo.getWorkspaceMember(workspace.id, input.user.userId);
  if (!member || member.status !== "active") {
    return { text: memberRoleNotOwnerMessage(), outcome: "unauthorized" };
  }
  const recipients = await deps.repo.listRecipients(workspace.id);
  return { text: recipientListMessage(recipients), outcome: "ok" };
}

async function membershipGate(
  user: TelegramUser,
  repo: SolvoRepository,
  roles: Array<"owner" | "approver">,
): Promise<CommunityCommandReply | null> {
  if (user.chatType !== "group" && user.chatType !== "supergroup") {
    return { text: notInGroupMessage(), outcome: "wrong_context" };
  }
  const workspace = await repo.getWorkspaceByTelegramChatId(user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };
  const member = await repo.getWorkspaceMember(workspace.id, user.userId);
  if (!member || member.status !== "active" || !(roles as readonly string[]).includes(member.role)) {
    return { text: memberRoleNotOwnerMessage(), outcome: "unauthorized" };
  }
  return null;
}
