import type { SolvoRepository } from "../db/repository.ts";
import type { AgentRunRow } from "../db/types.ts";
import type { AgentRunView, DashboardContext } from "./types.ts";
import { AGENT_RUNS_TRUTH_NOTE } from "./types.ts";

export { AGENT_RUNS_TRUTH_NOTE };

/**
 * M12.2 — Agent runs read model (observability ONLY).
 *
 * Agent runs are orchestration records, never payment truth. This view
 * exposes only the bounded summary fields: run status, intent kind, decision
 * type, provider label, redacted input text, and entity links. It never
 * exposes raw provider output blobs (candidate/interpretation/decision
 * JSON), secrets, execution ids, or transaction hashes. Completion/proof
 * language lives exclusively in the payout/claim views.
 */
export function buildAgentRunView(run: AgentRunRow): AgentRunView {
  return {
    runId: run.id,
    surface: run.surface,
    provider: run.provider,
    status: run.status,
    intentKind: run.intent_kind,
    planAction: run.plan_action,
    decisionType: run.decision_type,
    linkedPayoutId: run.payout_id,
    linkedClaimId: run.claim_id,
    rawTextRedacted: run.raw_text_redacted,
    errorCode: run.error_code,
    errorMessageRedacted: run.error_message_redacted,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    createdAt: run.created_at,
  };
}

export type ListAgentRunViewsOptions = {
  before?: string;
  beforeId?: string;
  limit?: number;
};

/**
 * Read service: workspace-scoped run list, newest first. Returns views only —
 * raw rows never leave this module.
 */
export async function listAgentRunViews(
  repo: SolvoRepository,
  ctx: DashboardContext,
  options: ListAgentRunViewsOptions = {},
): Promise<AgentRunView[]> {
  const runs = await repo.listAgentRunsByWorkspace(ctx.workspaceId, options);
  return runs.map(buildAgentRunView);
}

/**
 * Read service: one run's observability view. Returns null for unknown or
 * cross-workspace run ids (no existence leak).
 */
export async function getAgentRunView(
  repo: SolvoRepository,
  ctx: DashboardContext,
  runId: string,
): Promise<AgentRunView | null> {
  const run = await repo.getAgentRunById(runId);
  if (run === null || run.workspace_id !== ctx.workspaceId) return null;
  return buildAgentRunView(run);
}
