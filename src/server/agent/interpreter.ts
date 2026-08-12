import { validateAgentInterpretation } from "./schema.ts";
import type { AgentInput, AgentInterpretation, PaymentCandidates } from "./types.ts";
import type { ExtractionResult } from "./extraction.ts";

/**
 * M8 — IntentInterpreter contract.
 *
 * A bounded interpreter turns a sanitized AgentInput + deterministic
 * extraction into a schema-validated AgentInterpretation. Real model
 * providers (S2) implement this interface; deterministic interpreters
 * (static, hostile) implement it today.
 *
 * The interpreter is a PROPOSAL engine: it may classify, select candidates,
 * and note missing fields. It has no execution authority and no access to
 * repositories, KeeperHub, or payment state.
 */
export interface IntentInterpreter {
  interpret(input: AgentInput, extraction: ExtractionResult): Promise<AgentInterpretation>;
}

const EMPTY_CANDIDATES: PaymentCandidates = {
  amounts: [],
  tokens: [],
  chains: [],
  addresses: [],
  aliases: [],
  payoutIds: [],
  claimAmounts: [],
};

/**
 * Fail-closed gate for interpreter output. Any result that fails the Task
 * 1.1 schema validators — hostile actions, fabricated candidates, unknown
 * plan actions, malformed shapes, smuggled keys — is replaced by a safe
 * unsupported/decline interpretation. Never throws, never executes.
 */
export function safeInterpretation(raw: unknown): AgentInterpretation {
  const validated = validateAgentInterpretation(raw);
  if (validated.ok) return validated.value;
  return {
    intent: {
      action: "unknown",
      amount: null,
      currency: null,
      recipient: null,
      memo: null,
      missingFields: [],
      candidates: EMPTY_CANDIDATES,
      source: "natural_language",
      batch: null,
    },
    intentKind: "unsupported",
    summary: "The interpreter returned an invalid result.",
    provider: "safe_fallback",
  };
}
