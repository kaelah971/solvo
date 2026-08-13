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
 * appears exactly once, inside an inline keyboard URL button, and is never
 * printed in the plain message text, logged, or stored.
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
  /** One-time auth URL rendered ONLY as an inline keyboard button. */
  buttonUrl: string | null;
  outcome: "link_issued" | "unavailable";
};

export function dashboardUnavailableMessage(): string {
  return "Dashboard unavailable. Ask a workspace owner to add you, then try /dashboard again.";
}

export function dashboardLoginLinkMessage(expiresAt: string): string {
  const expiry = `${expiresAt.replace("T", " ").slice(0, 19)} UTC`;
  return [
    "Open your Solvo dashboard.",
    "",
    `This link expires in ${DASHBOARD_LOGIN_EXPIRY_MINUTES} minutes and can be used once.`,
    `Valid until ${expiry}.`,
  ].join("\n");
}

function safeHost(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * Safe /dashboard flow diagnostic. Logs ONLY hostnames and booleans — never
 * the token, the full link (which carries the token), user ids, chat ids,
 * workspace ids, or secrets.
 */
function logDashboardLoginLinkDebug(input: {
  appUrl: string;
  workspaceMemberFound: boolean;
  memberStatus: string | null;
  role: string | null;
  tokenCreated: boolean;
  linkHost: string | null;
  buttonSent: boolean;
}): void {
  // Tag must stay on this line so source contracts only ever see it here.
  console.log(`dashboard_login_link_debug ${JSON.stringify({ appUrlHost: safeHost(input.appUrl), tokenCreated: input.tokenCreated, expiresInMinutes: DASHBOARD_LOGIN_EXPIRY_MINUTES, workspaceMemberFound: input.workspaceMemberFound, memberStatus: input.memberStatus, role: input.role, linkHost: input.linkHost, buttonSent: input.buttonSent })}`);
}

export async function handleDashboardInstruction(
  input: { user: TelegramUser },
  deps: DashboardFlowDeps,
): Promise<DashboardFlowReply> {
  const unavailable = (): DashboardFlowReply => ({
    text: dashboardUnavailableMessage(),
    buttonUrl: null,
    outcome: "unavailable",
  });

  if (input.user.chatType !== "group" && input.user.chatType !== "supergroup") {
    logDashboardLoginLinkDebug({
      appUrl: deps.appUrl ?? defaultAppUrl,
      workspaceMemberFound: false,
      memberStatus: null,
      role: null,
      tokenCreated: false,
      linkHost: null,
      buttonSent: false,
    });
    return unavailable();
  }

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace || workspace.mode !== "community") {
    logDashboardLoginLinkDebug({
      appUrl: deps.appUrl ?? defaultAppUrl,
      workspaceMemberFound: false,
      memberStatus: null,
      role: null,
      tokenCreated: false,
      linkHost: null,
      buttonSent: false,
    });
    return unavailable();
  }

  const member = await deps.repo.getWorkspaceMember(workspace.id, input.user.userId);
  if (!member || member.status !== "active") {
    logDashboardLoginLinkDebug({
      appUrl: deps.appUrl ?? defaultAppUrl,
      workspaceMemberFound: member !== null,
      memberStatus: member?.status ?? null,
      role: member?.role ?? null,
      tokenCreated: false,
      linkHost: null,
      buttonSent: false,
    });
    return unavailable();
  }

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
  if (!created.ok) {
    logDashboardLoginLinkDebug({
      appUrl: deps.appUrl ?? defaultAppUrl,
      workspaceMemberFound: true,
      memberStatus: member.status,
      role: member.role,
      tokenCreated: false,
      linkHost: null,
      buttonSent: false,
    });
    return unavailable();
  }

  logDashboardLoginLinkDebug({
    appUrl: deps.appUrl ?? defaultAppUrl,
    workspaceMemberFound: true,
    memberStatus: member.status,
    role: member.role,
    tokenCreated: true,
    linkHost: safeHost(created.link),
    buttonSent: true,
  });

  return {
    text: dashboardLoginLinkMessage(created.expiresAt),
    buttonUrl: created.link,
    outcome: "link_issued",
  };
}
