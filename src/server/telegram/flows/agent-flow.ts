import type { SolvoRepository } from "../../db/repository.ts";
import { getAgentConfig, type AgentConfig } from "../../agent/config.ts";
import { extractCandidates } from "../../agent/extraction.ts";
import type { IntentInterpreter } from "../../agent/interpreter.ts";
import { formatAgentServiceResult } from "../../agent/messages.ts";
import { redactAgentRawText } from "../../agent/redact.ts";
import { runAgentOrchestration, type AgentServiceResult } from "../../agent/service.ts";
import { StaticIntentInterpreter } from "../../agent/static-interpreter.ts";
import { appUrl as defaultAppUrl } from "../../../lib/config.ts";
import type { TelegramUser } from "../types.ts";

/**
 * M8 — Telegram entry for the agent orchestration flow.
 *
 * Routes eligible NON-COMMAND group text to `runAgentOrchestration` behind
 * SOLVO_AGENT_ENABLED. Conservative by construction:
 *  - slash text never reaches the agent (callers route commands first);
 *  - only chat-bound COMMUNITY workspaces with an active member are eligible
 *    (the judge workspace is not chat-bound and mode judge, so Judge Mode
 *    cannot enter this flow);
 *  - disabled config returns null → the caller keeps the existing reply;
 *  - the service/bridges decide money outcomes: pending-approval payouts and
 *    claim links only, never execution.
 */
export type AgentFlowDeps = {
  repo: SolvoRepository;
  /** Injectable for tests; defaults to env config. */
  config?: AgentConfig;
  /** Injectable for tests; defaults to the static interpreter. */
  interpreter?: IntentInterpreter;
  appUrl?: string;
  claimExpiryHours?: number;
  now?: () => Date;
};

export type AgentFlowReply = {
  text: string;
  buttons?: Array<{ text: string; callbackData: string }>;
};

export async function handleAgentGroupText(
  input: { user: TelegramUser; text: string },
  deps: AgentFlowDeps,
): Promise<AgentFlowReply | null> {
  const text = input.text.trim();
  if (text.length === 0 || text.startsWith("/")) return null;

  const config = deps.config ?? getAgentConfig();
  if (!config.enabled) return null;

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace || workspace.mode !== "community") return null;

  const member = await deps.repo.getWorkspaceMember(workspace.id, input.user.userId);
  if (!member || member.status !== "active") return null;

  const aliases = (await deps.repo.listRecipients(workspace.id)).map((recipient) => recipient.alias);
  const extraction = extractCandidates(text, aliases);

  let result: AgentServiceResult;
  try {
    result = await runAgentOrchestration(
      {
        agentInput: {
          surface: "telegram",
          chatId: input.user.chatId,
          userId: input.user.userId,
          messageId: input.user.messageId,
          rawText: text,
          timestampIso: (deps.now?.() ?? new Date()).toISOString(),
          workspace: {
            id: workspace.id,
            mode: workspace.mode,
            chainId: workspace.chain_id,
            tokenAddress: workspace.token_address,
            aliases,
            perTransactionLimitUsdc: workspace.per_transaction_limit_base_units !== null ? baseUnitsToUsdc(workspace.per_transaction_limit_base_units) : null,
            dailyLimitUsdc: workspace.daily_limit_base_units !== null ? baseUnitsToUsdc(workspace.daily_limit_base_units) : null,
            workspaceActive: workspace.status === "active",
          },
          flags: { workspaceMode: workspace.mode, isMember: true },
          candidates: extraction.candidates,
        },
        workspace,
        member,
      },
      {
        repo: deps.repo,
        interpreter: deps.interpreter ?? new StaticIntentInterpreter(),
        config,
        appUrl: deps.appUrl ?? defaultAppUrl,
        claimExpiryHours: deps.claimExpiryHours,
        now: deps.now,
      },
    );
  } catch (error) {
    console.error("[solvo] agent flow failure", {
      chatId: input.user.chatId,
      userId: input.user.userId,
      error: redactAgentRawText(error instanceof Error ? error.message : String(error)),
    });
    const formatted = formatAgentServiceResult({ outcome: "failed", reason: "internal" });
    return { text: formatted.text };
  }

  const formatted = formatAgentServiceResult(result);
  return { text: formatted.text, buttons: formatted.buttons };
}

/** Integer base units → USDC decimal for the sanitized workspace context. */
function baseUnitsToUsdc(value: string): string {
  const v = BigInt(value);
  const whole = v / 1000000n;
  const fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}
