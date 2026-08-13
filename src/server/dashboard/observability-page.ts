import type { SolvoRepository } from "../db/repository.ts";
import { DASHBOARD_MAX_LIMIT } from "../db/repository.ts";
import { canViewDashboard } from "./access.ts";
import { getAgentRunView, listAgentRunViews } from "./agent-runs.ts";
import { buildAuditView } from "./audit.ts";
import {
  agentRunDecisionLabel,
  agentRunStatusLabel,
  auditEventLabel,
} from "./overview-page.ts";
import type { AgentRunView, AuditView, DashboardContext } from "./types.ts";

export { AGENT_RUNS_TRUTH_NOTE } from "./agent-runs.ts";

/**
 * M12.9 — Observability page models (agent runs + audit; server side, no
 * React).
 *
 * Read-only. Every builder returns the single generic `{ ok: false }` for
 * non-members / inactive members / missing workspace, and every read is
 * scoped to the operator's workspace. Agent runs are observability only —
 * never payment truth, never provider/interpretation/decision JSON, never
 * execution ids. Audit rows are safe whitelisted summaries — never raw
 * metadata blobs. Cross-workspace or unknown run ids collapse to null (the
 * pages render the generic not-found panel).
 */

// ── Display labels (operator-safe) ─────────────────────────────────────────

/** Short display id (first 8 chars). */
export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

/** Surface label for an agent run. */
export function agentRunSurfaceLabel(surface: string): string {
  switch (surface) {
    case "telegram":
      return "TELEGRAM";
    case "web":
      return "WEB";
    default:
      return "OTHER";
  }
}

/** Interpreted-kind label (observability vocabulary). */
export function agentRunIntentLabel(intentKind: string | null): string {
  switch (intentKind) {
    case "prepare_payment":
      return "Prepare payment";
    case "prepare_batch_payment":
      return "Prepare batch";
    case "create_claim_link":
      return "Create claim link";
    case "inspect_payment_status":
      return "Payment status";
    case "clarify_missing_fields":
      return "Needs clarification";
    case "unsupported":
      return "Unsupported";
    default:
      return "Other";
  }
}

/** Source-family label for an audit event. */
export function auditSourceLabel(source: AuditView["source"]): string {
  switch (source) {
    case "payout":
      return "PAYOUT";
    case "claim":
      return "CLAIM";
    case "agent":
      return "AGENT";
    case "workspace":
      return "WORKSPACE";
    case "system":
      return "SYSTEM";
  }
}

/** Safe short entity reference for an audit row (payout/claim id). */
export function auditEntityLabel(view: AuditView): string | null {
  if (view.payoutId !== null) return `Payout ${view.payoutId.slice(0, 8)}`;
  if (view.claimId !== null) return `Claim ${view.claimId.slice(0, 8)}`;
  return null;
}

/** One-line whitelisted metadata summary (never a raw blob). */
export function auditSummaryLabel(summary: AuditView["summary"]): string | null {
  if (summary === null) return null;
  const parts: string[] = [];
  if (summary.amountUsdc !== undefined) parts.push(`${summary.amountUsdc} USDC`);
  if (summary.totalUsdc !== undefined) parts.push(`${summary.totalUsdc} USDC total`);
  if (summary.itemCount !== undefined) parts.push(`${summary.itemCount} items`);
  if (summary.maskedRecipient !== undefined) parts.push(summary.maskedRecipient);
  if (summary.reason !== undefined) parts.push(summary.reason);
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Agent runs list ────────────────────────────────────────────────────────

export type AgentRunListPageItem = {
  view: AgentRunView;
  shortId: string;
  statusLabel: string;
  decisionLabel: string;
  intentLabel: string;
  surfaceLabel: string;
};

export type AgentRunListPageModel =
  | { ok: true; items: AgentRunListPageItem[]; empty: boolean }
  | { ok: false };

export async function buildAgentRunListPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<AgentRunListPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const views = await listAgentRunViews(repo, ctx);
  if (views.length === 0) return { ok: true, items: [], empty: true };
  const items: AgentRunListPageItem[] = views.map((view) => ({
    view,
    shortId: shortRunId(view.runId),
    statusLabel: agentRunStatusLabel(view.status),
    decisionLabel: agentRunDecisionLabel(view.decisionType),
    intentLabel: agentRunIntentLabel(view.intentKind),
    surfaceLabel: agentRunSurfaceLabel(view.surface),
  }));
  return { ok: true, items, empty: false };
}

// ── Agent runs detail ──────────────────────────────────────────────────────

export type AgentRunDetailPageModel =
  | {
      ok: true;
      run: AgentRunView;
      shortId: string;
      statusLabel: string;
      decisionLabel: string;
      intentLabel: string;
      surfaceLabel: string;
      /** Same-workspace verified payout id to link to, else null. */
      payoutLink: string | null;
      /** Same-workspace verified claim id to link to, else null. */
      claimLink: string | null;
    }
  | { ok: false };

/**
 * One run's detail. The run view is already workspace-scoped; linked
 * payout/claim ids are additionally verified against the workspace before a
 * page link is offered, so a stale/foreign reference never links anywhere.
 */
export async function buildAgentRunDetailPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
  runId: string,
): Promise<AgentRunDetailPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const run = await getAgentRunView(repo, ctx, runId);
  if (run === null) return { ok: false };

  let payoutLink: string | null = null;
  if (run.linkedPayoutId !== null) {
    const payout = await repo.getPayoutById(run.linkedPayoutId);
    if (payout !== null && payout.workspace_id === ctx.workspaceId) payoutLink = payout.id;
  }
  let claimLink: string | null = null;
  if (run.linkedClaimId !== null) {
    const claim = await repo.getClaimLinkById(run.linkedClaimId);
    if (claim !== null && claim.workspace_id === ctx.workspaceId) claimLink = claim.id;
  }

  return {
    ok: true,
    run,
    shortId: shortRunId(run.runId),
    statusLabel: agentRunStatusLabel(run.status),
    decisionLabel: agentRunDecisionLabel(run.decisionType),
    intentLabel: agentRunIntentLabel(run.intentKind),
    surfaceLabel: agentRunSurfaceLabel(run.surface),
    payoutLink,
    claimLink,
  };
}

// ── Audit timeline ─────────────────────────────────────────────────────────

export type AuditPageItem = {
  view: AuditView;
  eventLabel: string;
  sourceLabel: string;
  entityLabel: string | null;
  summaryLabel: string | null;
};

export type AuditPageModel =
  | { ok: true; items: AuditPageItem[]; empty: boolean }
  | { ok: false };

export async function buildAuditPageModel(
  repo: SolvoRepository,
  ctx: DashboardContext,
): Promise<AuditPageModel> {
  if (!canViewDashboard(ctx)) return { ok: false };
  const events = await repo.listAuditEventsByWorkspace(ctx.workspaceId, { limit: DASHBOARD_MAX_LIMIT });
  if (events.length === 0) return { ok: true, items: [], empty: true };
  const items: AuditPageItem[] = events.map((event) => {
    const view = buildAuditView(event);
    return {
      view,
      eventLabel: auditEventLabel(view.eventType),
      sourceLabel: auditSourceLabel(view.source),
      entityLabel: auditEntityLabel(view),
      summaryLabel: auditSummaryLabel(view.summary),
    };
  });
  return { ok: true, items, empty: false };
}
