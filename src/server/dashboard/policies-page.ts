import type { SolvoRepository } from "../db/repository.ts";
import { baseUnitsToUsdc } from "../execution/money.ts";
import { canViewDashboard } from "./access.ts";
import { modeLabel, roleLabel, type ModeLabel, type RoleLabel } from "./overview-page.ts";
import type { DashboardContext } from "./types.ts";

/**
 * M12.8 — Policies page model (server side, no React).
 *
 * Read-only workspace safety/policy view. Displays ONLY fields the current
 * schema actually stores (mode, chain/token, per-tx + daily limits, approval
 * policy, active status) plus a truthful spent/remaining-today budget using
 * the same window semantics as the approval-time checks. Nothing is
 * fabricated when a limit is missing, no env values or token addresses are
 * shown, and there is no edit surface anywhere in this module or its page.
 */

const BASE_CHAIN_ID = "8453";
/** Canonical Base USDC token address (case-insensitive match; never shown). */
const CANONICAL_USDC_TOKEN_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/**
 * Item states that count toward today's spend — the same window the
 * approval-time daily-limit checks use (in-flight states count
 * conservatively). Defined locally so this module never imports an
 * execution/flow surface.
 */
const DAILY_SPEND_STATES = [
  "approved",
  "simulating",
  "submitted",
  "confirming",
  "completed",
  "execution_unknown",
] as const;

/** UTC day start for the daily-spend window. */
export function utcDayStartIso(nowIso: string): string {
  return `${nowIso.slice(0, 10)}T00:00:00.000Z`;
}

/** Safe network label — never the raw token address. */
export function policyNetworkLabel(chainId: string, tokenAddress: string): string {
  const chain = chainId === BASE_CHAIN_ID ? "BASE" : chainId.length > 0 ? chainId : "UNKNOWN";
  const token = tokenAddress.toLowerCase() === CANONICAL_USDC_TOKEN_ADDRESS ? "USDC" : "TOKEN";
  return `${chain} · ${token}`;
}

/** Safe approval-requirement label for the stored approval_policy. */
export function policyApprovalLabel(approvalPolicy: string): string {
  switch (approvalPolicy) {
    case "requires_approval":
    case "approval_required":
      return "REQUIRED";
    case "auto_approve_within_judge_policy":
      return "JUDGE POLICY";
    default:
      return "NOT CONFIGURED";
  }
}

/** Mode-specific note; null when the mode needs no special note. */
export function policyModeNote(mode: DashboardContext["mode"]): string | null {
  switch (mode) {
    case "judge":
      return "Judge Mode runs /judgepay-only execution with its own caps. The dashboard is display-only there.";
    case "sandbox":
      return "Sandbox simulation means no funds move.";
    case "development":
      return "Development execution is limited to authorized users and small caps.";
    default:
      return null;
  }
}

/** Role-based capability summary (display only). */
export function policyCapabilitySummary(role: "owner" | "approver" | "member"): string {
  switch (role) {
    case "owner":
      return "Owners may manage policies later. Editing limits is not enabled yet.";
    case "approver":
      return "Approvers can view policies but cannot manage them.";
    case "member":
      return "Members are view-only here.";
  }
}

export type PolicyPageModel =
  | {
      ok: true;
      workspaceLabel: string;
      modeLabel: ModeLabel | "UNKNOWN";
      statusLabel: "ACTIVE" | "NOT ACTIVE";
      networkLabel: string;
      perTransactionLimitUsdc: string | null;
      dailyLimitUsdc: string | null;
      spentTodayUsdc: string;
      remainingTodayUsdc: string | null;
      approvalPolicyLabel: string;
      modeNote: string | null;
      capability: { roleLabel: RoleLabel; summary: string };
    }
  | { ok: false };

export async function buildPolicyPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<PolicyPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const workspace = await repo.getWorkspaceById(ctx.workspaceId);
  if (workspace === null) return { ok: false };
  const role = roleLabel(ctx.role);
  if (role === null) return { ok: false };

  const spentToday = await repo.sumPayoutItemsByWorkspaceStates(
    ctx.workspaceId,
    DAILY_SPEND_STATES,
    utcDayStartIso(ctx.nowIso),
  );
  const spentTodayUsdc = baseUnitsToUsdc(BigInt(spentToday));
  const dailyLimitUsdc =
    workspace.daily_limit_base_units !== null ? baseUnitsToUsdc(BigInt(workspace.daily_limit_base_units)) : null;
  let remainingTodayUsdc: string | null = null;
  if (dailyLimitUsdc !== null) {
    const remaining = BigInt(workspace.daily_limit_base_units as string) - BigInt(spentToday);
    remainingTodayUsdc = baseUnitsToUsdc(remaining < 0n ? 0n : remaining);
  }

  return {
    ok: true,
    workspaceLabel: workspace.name ?? "Workspace",
    modeLabel: modeLabel(workspace.mode) ?? "UNKNOWN",
    statusLabel: workspace.status === "active" ? "ACTIVE" : "NOT ACTIVE",
    networkLabel: policyNetworkLabel(workspace.chain_id, workspace.token_address),
    perTransactionLimitUsdc:
      workspace.per_transaction_limit_base_units !== null
        ? baseUnitsToUsdc(BigInt(workspace.per_transaction_limit_base_units))
        : null,
    dailyLimitUsdc,
    spentTodayUsdc,
    remainingTodayUsdc,
    approvalPolicyLabel: policyApprovalLabel(workspace.approval_policy),
    modeNote: policyModeNote(workspace.mode),
    capability: { roleLabel: role, summary: policyCapabilitySummary(ctx.role ?? "member") },
  };
}
