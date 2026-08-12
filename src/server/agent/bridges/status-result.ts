import type { AgentPlannerDecision } from "../planner.ts";

/**
 * M8 — Safe, non-mutating conversion of planner status decisions into a
 * bridge-facing result shape for later UX. Never touches the repository,
 * never retries, never queries KeeperHub. Forbidden status lookups stay
 * generic (the planner already collapses them to `blocked` with no details).
 */
export type AgentStatusResult =
  | { outcome: "visible"; payoutId: string; state: string; itemCount: number; completedAt: string | null }
  | { outcome: "not_found"; payoutId: string }
  | { outcome: "blocked"; reason: string };

export function agentStatusResult(decision: AgentPlannerDecision): AgentStatusResult | null {
  switch (decision.decision) {
    case "status_visible":
      return {
        outcome: "visible",
        payoutId: decision.status.payoutId,
        state: decision.status.state,
        itemCount: decision.status.itemCount,
        completedAt: decision.status.completedAt,
      };
    case "status_not_found":
      return { outcome: "not_found", payoutId: decision.payoutId };
    case "blocked":
      return { outcome: "blocked", reason: decision.reason };
    default:
      return null;
  }
}
