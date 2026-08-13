import type { SolvoRepository } from "../../db/repository.ts";
import {
  claimStatusFoundMessage,
  claimStatusUnavailableMessage,
  claimStatusUsageMessage,
} from "../../claim/messages.ts";
import { getClaimStatusForMember } from "../../claim/status.ts";
import type { TelegramUser } from "../types.ts";

/**
 * M11.3 — /claimstatus <claim-id> and NL claim-status routing.
 *
 * A read-only claim status lookup for the user's current chat workspace. The
 * same-workspace/no-leak gate lives in `getClaimStatusForMember`: unknown
 * claim ids, other-workspace claims, inactive members and non-members all
 * collapse to ONE generic "CLAIM STATUS UNAVAILABLE" reply.
 *
 * Invariants:
 *  - never creates payouts, claims, audits, executions, or agent runs;
 *  - never reads agent_runs (forged runs cannot inject completion/hash);
 *  - proof language only from the payout pipeline via the read-model view;
 *  - never exposes the raw claim token, its hash, or the idempotency key.
 */
export type ClaimStatusFlowDeps = {
  repo: SolvoRepository;
  /** Injectable clock for deterministic tests; defaults to the wall clock. */
  now?: () => Date;
};

export type ClaimStatusFlowReply = {
  text: string;
  outcome: "visible" | "unavailable" | "usage";
};

export async function handleClaimStatusInstruction(
  input: { claimId: string | null; user: TelegramUser },
  deps: ClaimStatusFlowDeps,
): Promise<ClaimStatusFlowReply> {
  if (input.claimId === null) {
    return { text: claimStatusUsageMessage(), outcome: "usage" };
  }

  const workspace = await deps.repo.getWorkspaceByTelegramChatId(input.user.chatId);
  if (!workspace) {
    return { text: claimStatusUnavailableMessage(), outcome: "unavailable" };
  }
  const member = await deps.repo.getWorkspaceMember(workspace.id, input.user.userId);
  const result = await getClaimStatusForMember({
    repo: deps.repo,
    workspaceId: workspace.id,
    member,
    claimId: input.claimId,
    nowIso: (deps.now ?? (() => new Date()))().toISOString(),
  });
  if (result.outcome === "not_found") {
    return { text: claimStatusUnavailableMessage(), outcome: "unavailable" };
  }
  return { text: claimStatusFoundMessage(result.view), outcome: "visible" };
}
