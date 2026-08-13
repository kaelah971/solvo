import type { SolvoRepository } from "../../db/repository.ts";
import { appUrl as defaultAppUrl } from "../../../lib/config.ts";
import { createDashboardLoginLink, DASHBOARD_LOGIN_EXPIRY_MINUTES } from "../../dashboard/login-links.ts";
import type { TelegramUser } from "../types.ts";

/**
 * M12.4 — /dashboard command flow.
 *
 * Issues a one-time dashboard login link to an ACTIVE community workspace
 * member. Every denied shape — private chat, unknown chat workspace, non-
 * community mode, non-member, inactive member — returns the SAME generic
 * unavailable copy (no workspace/member existence leak). The raw login token
 * appears exactly once in the reply and is never logged or stored.
 */
export type DashboardFlowDeps = {
  repo: SolvoRepository;
  /** Injectable clock for deterministic tests; defaults to the wall clock. */
  now?: () => Date;
  /** Public base URL for the auth link; defaults to the app config. */
  appUrl?: string;
};

export type DashboardFlowReply = {
  text: string;
  outcome: "link_issued" | "unavailable";
};

export function dashboardUnavailableMessage(): string {
  return "Dashboard unavailable. Ask a workspace owner to add you, then try /dashboard again.";
}

export function dashboardLoginLinkMessage(link: string, expiresAt: string): string {
  const expiry = `${expiresAt.replace("T", " ").slice(0, 19)} UTC`;
  return [
    "OPEN YOUR DASHBOARD",
    "",
    link,
    "",
    `This link expires in ${DASHBOARD_LOGIN_EXPIRY_MINUTES} minutes and can be used once.`,
    `Valid until ${expiry}.`,
  ].join("\n");
}

export async function handleDashboardInstruction(
  input: { user: TelegramUser },
  deps: DashboardFlowDeps,
): Promise<DashboardFlowReply> {
  const unavailable = (): DashboardFlowReply => ({
    text: dashboardUnavailableMessage(),
    outcome: "unavailable",
  });

  if (input.user.chatType !== "group" && input.user.chatType !== "supergroup") {
    return unavailable();
  }

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace || workspace.mode !== "community") return unavailable();

  const member = await deps.repo.getWorkspaceMember(workspace.id, input.user.userId);
  if (!member || member.status !== "active") return unavailable();

  const nowIso = (deps.now ?? (() => new Date()))().toISOString();
  const created = await createDashboardLoginLink({
    repo: deps.repo,
    workspaceId: workspace.id,
    telegramUserId: member.telegram_user_id,
    memberId: member.id,
    role: member.role,
    nowIso,
    appUrl: deps.appUrl ?? defaultAppUrl,
  });
  if (!created.ok) return unavailable();

  return {
    text: dashboardLoginLinkMessage(created.link, created.expiresAt),
    outcome: "link_issued",
  };
}
