import type { SolvoRepository } from "../db/repository.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../db/types.ts";
import type { AgentConfig } from "./config.ts";
import { extractCandidates, type ExtractionResult } from "./extraction.ts";
import type { IntentInterpreter } from "./interpreter.ts";
import { safeInterpretation } from "./interpreter.ts";
import { AgentPlanner, type AgentPlannerDecision } from "./planner.ts";
import { createIntentInterpreter } from "./providers/factory.ts";
import { hashAgentInput, redactAgentRawText } from "./redact.ts";
import { validateAgentInput } from "./schema.ts";
import { agentStatusResult } from "./bridges/status-result.ts";
import { bridgePreparedClaimLink, CreateClaimLinkBridgeError } from "./bridges/create-claim-link.ts";
import { bridgePreparedPayment, PreparePaymentBridgeError } from "./bridges/prepare-payment.ts";
import type { AgentInput, AgentInterpretation, MissingFieldKey } from "./types.ts";

/**
 * M8 — Agent orchestration service.
 *
 * The single application-owned flow that composes S1: config gate → input
 * validation → rate limit → idempotency → agent_run lifecycle (create →
 * extract → interpret → plan) → application bridges (prepare payment /
 * claim link / status) → terminal agent-run record → typed result.
 *
 * The service is DEFAULT-OFF (SOLVO_AGENT_ENABLED=false → `disabled` and no
 * side effects) and never executes: no KeeperHub, no simulation, no approval,
 * no execution service. It only creates/updates agent_runs and routes money
 * intents through the non-executing bridges.
 */

export type AgentServiceInput = {
  agentInput: AgentInput;
  workspace: WorkspaceRow | null;
  member: WorkspaceMemberRow | null;
};

export type AgentServiceDeps = {
  repo: SolvoRepository;
  interpreter: IntentInterpreter;
  config: AgentConfig;
  appUrl: string;
  claimExpiryHours?: number;
  /** Injectable clock for deterministic rate-limit windows. */
  now?: () => Date;
};

export type AgentServiceResult =
  | { outcome: "disabled" }
  | { outcome: "rate_limited"; reason: string }
  | { outcome: "duplicate"; payoutId: string | null; claimId: string | null }
  | { outcome: "needs_clarification"; missingFields: MissingFieldKey[]; question: string }
  | { outcome: "prepared_payment"; prepared: Awaited<ReturnType<typeof bridgePreparedPayment>> }
  | { outcome: "claim_link_created"; claim: Awaited<ReturnType<typeof bridgePreparedClaimLink>> }
  | { outcome: "status_visible"; status: Extract<ReturnType<typeof agentStatusResult>, { outcome: "visible" }> }
  | { outcome: "status_not_found"; payoutId: string }
  | { outcome: "blocked"; reason: string }
  | { outcome: "unsupported"; reason: string }
  | { outcome: "failed"; reason: string };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_CLAIM_EXPIRY_HOURS = 168;

export function agentIdempotencyKey(agentInput: AgentInput): string {
  return `tg:${agentInput.chatId}:m${agentInput.messageId ?? "0"}:agent`;
}

export async function runAgentOrchestration(input: AgentServiceInput, deps: AgentServiceDeps): Promise<AgentServiceResult> {
  const { agentInput, workspace, member } = input;
  const now = deps.now?.() ?? new Date();

  // 1. Config gate: disabled → inert.
  if (!deps.config.enabled) {
    return { outcome: "disabled" };
  }

  // 2. Input validation (identity/idempotency fields, length cap).
  const inputValidation = validateAgentInput(agentInput);
  if (!inputValidation.ok) {
    return { outcome: "failed", reason: inputValidation.reason };
  }
  if (agentInput.rawText.length > deps.config.maxInputChars) {
    return { outcome: "failed", reason: `Input exceeds the maximum of ${deps.config.maxInputChars} characters.` };
  }

  const idempotencyKey = agentIdempotencyKey(agentInput);

  // 3. Rate limit: hourly and daily per-user caps, enforced before anything
  // is created or bridged. Runs ARE recorded so abuse is observable and
  // repeat deliveries short-circuit.
  const hourlySince = new Date(now.getTime() - HOUR_MS).toISOString();
  const dailySince = new Date(now.getTime() - DAY_MS).toISOString();
  const hourlyCount = await deps.repo.countAgentRunsSince({ telegramUserId: agentInput.userId, sinceIso: hourlySince });
  const dailyCount = await deps.repo.countAgentRunsSince({ telegramUserId: agentInput.userId, sinceIso: dailySince });
  if (hourlyCount >= deps.config.maxHourlyRunsPerUser || dailyCount >= deps.config.maxDailyRunsPerUser) {
    const limited = await createOrReuseRun(
      deps,
      agentInput,
      idempotencyKey,
      workspace,
      "blocked",
      "rate_limited",
      "Agent-run limit reached for this hour or day.",
    );
    if (limited.existing) {
      return { outcome: "duplicate", payoutId: limited.run.payout_id, claimId: limited.run.claim_id };
    }
    return {
      outcome: "rate_limited",
      reason: "Agent-run limit reached for this hour or day. Try again later.",
    };
  }

  // 4+5. Serialized run creation: the advisory lock makes concurrent
  // duplicate deliveries resolve to ONE run (and therefore one payout/claim
  // downstream). A previously recorded run for this message wins and the
  // bridges are never re-run.
  const created = await createOrReuseRun(deps, agentInput, idempotencyKey, workspace, "received");
  if (created.existing) {
    return { outcome: "duplicate", payoutId: created.run.payout_id, claimId: created.run.claim_id };
  }
  const run = created.run;
  await appendAudit(deps, workspace, "agent_run_started", { agentRunId: run.id, provider: run.provider });

  try {
    // 6. Extract (deterministic candidates).
    const extraction = extractCandidates(agentInput.rawText, agentInput.workspace?.aliases ?? []);

    // 7. Interpret (fail-closed through the schema gate).
    let interpretation: AgentInterpretation;
    try {
      interpretation = safeInterpretation(await deps.interpreter.interpret(agentInput, extraction));
    } catch (error) {
      await failRun(deps, run.id, "interpreter_error", error);
      return { outcome: "failed", reason: "The interpreter could not produce a result." };
    }
    await deps.repo.updateAgentRun(run.id, {
      status: "interpreted",
      intentKind: interpretation.intentKind,
      interpretationJson: interpretation as unknown as Record<string, unknown>,
    });
    await appendAudit(deps, workspace, "agent_run_interpreted", {
      agentRunId: run.id,
      intentKind: interpretation.intentKind,
    });

    // 8. Plan (deterministic).
    let decision: AgentPlannerDecision;
    try {
      const planner = new AgentPlanner({
        repo: deps.repo,
        workspace,
        member,
        userId: agentInput.userId,
        claimExpiryHours: deps.claimExpiryHours ?? DEFAULT_CLAIM_EXPIRY_HOURS,
      });
      decision = await planner.plan(extraction, interpretation);
    } catch (error) {
      await failRun(deps, run.id, "planner_error", error);
      return { outcome: "failed", reason: "Planning failed; nothing was created." };
    }
    await deps.repo.updateAgentRun(run.id, {
      status: "planned",
      planAction: decision.planAction,
      decisionType: decision.decision,
      decisionJson: decision as unknown as Record<string, unknown>,
    });
    await appendAudit(deps, workspace, "agent_run_decision", {
      agentRunId: run.id,
      decision: decision.decision,
    });

    // 9. Bridge / terminal mapping.
    switch (decision.decision) {
      case "prepared_payment": {
        try {
          const prepared = await bridgePreparedPayment(
            { decision, run, workspace: workspace as WorkspaceRow, member: member as WorkspaceMemberRow, userId: agentInput.userId },
            { repo: deps.repo },
          );
          return { outcome: "prepared_payment", prepared };
        } catch (error) {
          if (error instanceof PreparePaymentBridgeError) {
            await terminalRun(deps, run.id, "blocked", "blocked", error.message);
            return { outcome: "blocked", reason: error.message };
          }
          await failRun(deps, run.id, "bridge_error", error);
          return { outcome: "failed", reason: "The payment could not be prepared." };
        }
      }
      case "prepared_claim_link": {
        try {
          const claim = await bridgePreparedClaimLink(
            { decision, run, workspace: workspace as WorkspaceRow, member: member as WorkspaceMemberRow, userId: agentInput.userId, claimExpiryHours: deps.claimExpiryHours ?? DEFAULT_CLAIM_EXPIRY_HOURS },
            { repo: deps.repo, appUrl: deps.appUrl },
          );
          return { outcome: "claim_link_created", claim };
        } catch (error) {
          if (error instanceof CreateClaimLinkBridgeError) {
            await terminalRun(deps, run.id, "blocked", "blocked", error.message);
            return { outcome: "blocked", reason: error.message };
          }
          await failRun(deps, run.id, "bridge_error", error);
          return { outcome: "failed", reason: "The claim link could not be created." };
        }
      }
      case "status_visible": {
        const status = agentStatusResult(decision);
        if (status === null || status.outcome !== "visible") {
          await terminalRun(deps, run.id, "unknown", "status_visible", "The status result could not be converted.");
          return { outcome: "failed", reason: "The status result could not be converted." };
        }
        await terminalRun(deps, run.id, "unknown", "status_visible", null);
        return { outcome: "status_visible", status };
      }
      case "status_not_found": {
        await terminalRun(deps, run.id, "unknown", "status_not_found", null);
        return { outcome: "status_not_found", payoutId: decision.payoutId };
      }
      case "ask_clarifying_question": {
        await terminalRun(deps, run.id, "needs_clarification", "ask_clarifying_question", null);
        return {
          outcome: "needs_clarification",
          missingFields: decision.missingFields,
          question: decision.question,
        };
      }
      case "blocked": {
        await terminalRun(deps, run.id, "blocked", "blocked", decision.reason);
        return { outcome: "blocked", reason: decision.reason };
      }
      case "unsupported": {
        await terminalRun(deps, run.id, "unknown", "unsupported", decision.reason);
        return { outcome: "unsupported", reason: decision.reason };
      }
    }
  } catch (error) {
    await failRun(deps, run.id, "orchestration_error", error);
    return { outcome: "failed", reason: "The agent run failed; nothing was executed." };
  }
}

// ── Run helpers ────────────────────────────────────────────────────────────

/**
 * Serialized run creation: takes the advisory idempotency lock and re-checks
 * inside the transaction, so concurrent duplicate deliveries (or a delivery
 * racing a rate-limited attempt) resolve to ONE run row — mirroring the
 * community-pay-flow / claim-flow patterns.
 */
async function createOrReuseRun(
  deps: AgentServiceDeps,
  agentInput: AgentInput,
  idempotencyKey: string,
  workspace: WorkspaceRow | null,
  status: "received" | "blocked",
  errorCode?: string,
  errorMessageRedacted?: string,
): Promise<{ existing: boolean; run: AgentRunRow }> {
  const persisted = await deps.repo.transaction(async (tx) => {
    await tx.lockIdempotencyKey(idempotencyKey);
    const raced = await tx.getAgentRunByIdempotencyKey(idempotencyKey);
    if (raced) return { existing: true, run: raced };
    const run = await tx.createAgentRun({
      workspaceId: workspace?.id ?? null,
      surface: agentInput.surface,
      telegramChatId: agentInput.chatId,
      telegramUserId: agentInput.userId,
      telegramMessageId: agentInput.messageId !== null ? String(agentInput.messageId) : null,
      idempotencyKey,
      provider: deps.config.provider,
      status,
      inputHash: hashAgentInput(agentInput.rawText),
      rawTextRedacted: redactAgentRawText(agentInput.rawText),
      candidatesJson: {},
      errorCode,
      errorMessageRedacted,
    });
    return { existing: false, run };
  });
  return persisted;
}

async function terminalRun(
  deps: AgentServiceDeps,
  runId: string,
  status: "needs_clarification" | "blocked" | "unknown",
  decisionType: string,
  reason: string | null,
): Promise<void> {
  await deps.repo.updateAgentRun(runId, {
    status,
    decisionType,
    ...(reason !== null ? { errorMessageRedacted: redactAgentRawText(reason) } : {}),
  });
}

async function failRun(deps: AgentServiceDeps, runId: string, errorCode: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await deps.repo.updateAgentRun(runId, {
    status: "failed",
    errorCode,
    errorMessageRedacted: redactAgentRawText(message),
  });
}

async function appendAudit(
  deps: AgentServiceDeps,
  workspace: WorkspaceRow | null,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (workspace === null) return;
  await deps.repo.appendAuditEvent({
    workspaceId: workspace.id,
    payoutId: null,
    payoutItemId: null,
    eventType,
    actorType: "system",
    actorId: null,
    metadata,
  });
}

// Default interpreter fallback for callers that did not inject one: the
// provider factory selects the implementation from config (static by
// default; the real adapter only when provider=openai_compatible AND a key
// exists — an openai_compatible config without a key fails closed here).
export function defaultAgentDeps(repo: SolvoRepository, config: AgentConfig, appUrl: string): AgentServiceDeps {
  return { repo, interpreter: createIntentInterpreter(config), config, appUrl };
}

export type { ExtractionResult };
