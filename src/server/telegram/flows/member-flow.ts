import type { SolvoRepository } from "../../db/repository.ts";
import type { MemberRole } from "../../db/types.ts";
import {
  memberAddMessage,
  memberListMessage,
  memberRemoveMessage,
  memberRoleNotOwnerMessage,
  notInGroupMessage,
  workspaceNotFoundForGroupMessage,
} from "../community-messages.ts";
import type { CommunityCommandReply, TelegramUser } from "../types.ts";

export type MemberFlowDeps = {
  repo: SolvoRepository;
};

export async function handleMemberAdd(
  input: { user: TelegramUser; targetUserId: string; role: MemberRole },
  deps: MemberFlowDeps,
): Promise<CommunityCommandReply> {
  const gate = await ownerGate(input.user, deps.repo);
  if (gate) return gate;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };

  const { created, member } = await deps.repo.transaction(async (tx) => {
    const result = await tx.addWorkspaceMember({
      workspaceId: workspace.id,
      telegramUserId: input.targetUserId,
      role: input.role,
    });
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: null,
      payoutItemId: null,
      eventType: result.created ? "member_added" : "role_changed",
      actorType: "workspace_owner",
      actorId: input.user.userId,
      metadata: { telegramUserId: input.targetUserId, role: input.role },
    });
    return result;
  });

  if (!created && member.role === input.role && member.status === "active") {
    return {
      text: memberAddMessage("already_member", input.role, input.targetUserId),
      outcome: "existing",
    };
  }
  return {
    text: memberAddMessage(created ? "added" : "reactivated", input.role, input.targetUserId),
    outcome: created ? "ok" : "existing",
  };
}

export async function handleMemberRemove(
  input: { user: TelegramUser; targetUserId: string },
  deps: MemberFlowDeps,
): Promise<CommunityCommandReply> {
  const gate = await ownerGate(input.user, deps.repo);
  if (gate) return gate;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };

  const target = await deps.repo.getWorkspaceMember(workspace.id, input.targetUserId);
  if (!target || target.status !== "active") {
    return { text: memberRemoveMessage("not_found", input.targetUserId), outcome: "not_found" };
  }
  if (target.role === "owner") {
    const owners = await deps.repo.countActiveOwners(workspace.id);
    if (owners <= 1) {
      return { text: memberRemoveMessage("last_owner", input.targetUserId), outcome: "invalid" };
    }
  }

  await deps.repo.transaction(async (tx) => {
    await tx.removeWorkspaceMember(workspace.id, input.targetUserId);
    await tx.appendAuditEvent({
      workspaceId: workspace.id,
      payoutId: null,
      payoutItemId: null,
      eventType: "member_removed",
      actorType: "workspace_owner",
      actorId: input.user.userId,
      metadata: { telegramUserId: input.targetUserId, role: target.role },
    });
  });

  return { text: memberRemoveMessage("removed", input.targetUserId), outcome: "ok" };
}

export async function handleMemberList(
  input: { user: TelegramUser },
  deps: MemberFlowDeps,
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
  const members = await deps.repo.listWorkspaceMembers(workspace.id);
  return { text: memberListMessage(members), outcome: "ok" };
}

async function ownerGate(
  user: TelegramUser,
  repo: SolvoRepository,
): Promise<CommunityCommandReply | null> {
  if (user.chatType !== "group" && user.chatType !== "supergroup") {
    return { text: notInGroupMessage(), outcome: "wrong_context" };
  }
  const workspace = await repo.getWorkspaceByTelegramChatId(user.chatId);
  if (!workspace) return { text: workspaceNotFoundForGroupMessage(), outcome: "not_found" };
  const member = await repo.getWorkspaceMember(workspace.id, user.userId);
  if (!member || member.status !== "active" || member.role !== "owner") {
    return { text: memberRoleNotOwnerMessage(), outcome: "unauthorized" };
  }
  return null;
}
