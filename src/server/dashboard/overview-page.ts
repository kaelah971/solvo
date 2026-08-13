import type { SolvoRepository } from "../db/repository.ts";
import type { DashboardContext, OverviewView } from "./types.ts";
import { canViewDashboard } from "./access.ts";
import { buildWorkspaceOverview } from "./overview.ts";

/**
 * M12.3 — Overview page model (server side, no React).
 *
 * Maps the M12.2 overview read model onto the exact data the `/app` page
 * renders. The page component stays a thin renderer over this JSON-safe
 * model; every truthfulness rule lives below this seam (numbers from the
 * payout pipeline, claims via effective status, agent-run records are
 * observability only). Non-members / inactive members / missing workspace
 * collapse to the generic `unavailable` result — the page never sees partial
 * data.
 */

export type RoleLabel = "OWNER" | "APPROVER" | "MEMBER";
export type ModeLabel = "SANDBOX" | "DEVELOPMENT" | "PERSONAL" | "COMMUNITY" | "JUDGE";

export type OverviewPageModel =
  | {
      ok: true;
      workspaceLabel: string;
      modeLabel: ModeLabel | null;
      roleLabel: RoleLabel;
      overview: OverviewView;
    }
  | { ok: false };

export function roleLabel(role: DashboardContext["role"]): RoleLabel | null {
  switch (role) {
    case "owner":
      return "OWNER";
    case "approver":
      return "APPROVER";
    case "member":
      return "MEMBER";
    default:
      return null;
  }
}

export function modeLabel(mode: DashboardContext["mode"]): ModeLabel | null {
  switch (mode) {
    case "sandbox":
      return "SANDBOX";
    case "development":
      return "DEVELOPMENT";
    case "personal":
      return "PERSONAL";
    case "community":
      return "COMMUNITY";
    case "judge":
      return "JUDGE";
    default:
      return null;
  }
}

export async function buildOverviewPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<OverviewPageModel> {
  if (!canViewDashboard(ctx) || ctx.mode === null) return { ok: false };
  const overview = await buildWorkspaceOverview(repo, ctx);
  const role = roleLabel(ctx.role);
  if (role === null) return { ok: false };
  return {
    ok: true,
    workspaceLabel: overview.workspace?.name ?? "Workspace",
    modeLabel: modeLabel(overview.workspace?.mode ?? ctx.mode),
    roleLabel: role,
    overview,
  };
}

// ── Display labels (pure, user-safe; internal terms never reach copy) ──────

/** Friendly UTC display: "2026-08-13 12:00:00 UTC". */
export function formatUtc(iso: string): string {
  return `${iso.replace("T", " ").slice(0, 19)} UTC`;
}

export function agentRunStatusLabel(status: string): string {
  switch (status) {
    case "received":
      return "RECEIVED";
    case "interpreted":
      return "INTERPRETED";
    case "planned":
      return "PLANNED";
    case "needs_clarification":
      return "NEEDS CLARIFICATION";
    case "prepared":
      return "PREPARED";
    case "claim_created":
      return "CLAIM CREATED";
    case "blocked":
      return "BLOCKED";
    case "unknown":
      return "UNKNOWN";
    case "failed":
      return "FAILED";
    default:
      return "PROCESSED";
  }
}

export function agentRunDecisionLabel(decisionType: string | null): string {
  switch (decisionType) {
    case "prepared_payment":
      return "Payment prepared";
    case "prepared_batch_payment":
      return "Batch prepared";
    case "prepared_claim_link":
      return "Claim link created";
    case "status_visible":
      return "Status shown";
    case "status_not_found":
      return "Status not found";
    case "ask_clarifying_question":
      return "Clarification asked";
    case "blocked":
      return "Blocked";
    case "unsupported":
      return "Declined";
    default:
      return "Processed";
  }
}

export function auditEventLabel(eventType: string): string {
  switch (eventType) {
    case "request_created":
      return "Request created";
    case "approval_required":
      return "Approval required";
    case "approval_granted":
      return "Approved";
    case "approval_rejected":
      return "Rejected";
    case "claim_created":
      return "Claim link created";
    case "claim_claimed":
      return "Claimed by recipient";
    case "claim_approved":
      return "Claim approved";
    case "claim_rejected":
      return "Claim rejected";
    case "claim_executed":
      return "Claim completed";
    case "claim_reissued":
      return "Claim reissued";
    case "execution_completed":
      return "Execution completed";
    case "execution_failed":
      return "Execution failed";
    case "execution_unknown":
      return "Execution outcome unknown";
    case "simulation_failed":
      return "Simulation failed";
    case "payout_cancelled":
      return "Payout cancelled";
    case "member_added":
      return "Member added";
    case "member_removed":
      return "Member removed";
    case "role_changed":
      return "Role changed";
    case "recipient_added":
      return "Recipient added";
    case "workspace_initialized":
      return "Workspace created";
    case "agent_run_started":
      return "Agent request received";
    default:
      return "Event recorded";
  }
}
