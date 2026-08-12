import { extractMemo } from "./extraction.ts";
import type { ExtractionResult } from "./extraction.ts";
import type { IntentInterpreter } from "./interpreter.ts";
import type {
  AgentAction,
  AgentInput,
  AgentInterpretation,
  AgentIntentKind,
  CandidateAmount,
  MissingFieldKey,
  PaymentCandidates,
  PaymentRecipient,
} from "./types.ts";

/**
 * M8 — Deterministic intent interpreters.
 *
 * `StaticIntentInterpreter` / `interpretStatically`: a conservative,
 * rule-based interpreter that consumes extraction output and selects ONE
 * bounded intent kind. It is the S1 production-safe interpreter (no model,
 * no keys) and the fallback when no provider is configured in S2.
 *
 * `HostileInterpreter` / `HOSTILE_PAYLOADS`: TEST SUPPORT ONLY. A dummy
 * interpreter that intentionally returns malicious/unsafe outputs so the
 * schema-hardening tests can prove fail-closed behavior. Never wired into
 * production routing.
 */

const BASE_CHAIN_ID = "8453";
const TOKEN_USDC = "USDC";

// ── StaticIntentInterpreter ────────────────────────────────────────────────

export class StaticIntentInterpreter implements IntentInterpreter {
  async interpret(input: AgentInput, extraction: ExtractionResult): Promise<AgentInterpretation> {
    return interpretStatically(input, extraction);
  }
}

/**
 * Pure, deterministic interpretation. Same input + same extraction always
 * yields a deep-equal result. Never produces execution, KeeperHub, SQL, HTTP
 * or arbitrary tool outcomes — the bounded enums make those unrepresentable.
 */
export function interpretStatically(input: AgentInput, extraction: ExtractionResult): AgentInterpretation {
  const { candidates, intentHints, unsafeFlags } = extraction;

  if (unsafeFlags.length > 0) {
    return unsupportedInterpretation(candidates, "Instruction contains unsafe text.");
  }

  const invalidToken = candidates.tokens.some((candidate) => candidate.validationStatus === "invalid");
  const invalidChain = candidates.chains.some((candidate) => candidate.validationStatus === "invalid");
  if (invalidToken || invalidChain) {
    return unsupportedInterpretation(candidates, "Unsupported token or chain.");
  }

  const hints = [...new Set(intentHints)];
  if (hints.length > 1) {
    return unsupportedInterpretation(candidates, "Multiple actions in one instruction.");
  }
  const hint = hints[0];

  switch (hint) {
    case "pay":
      return payInterpretation(input, candidates);
    case "claim_pay":
      return claimInterpretation(input, candidates);
    case "status":
      return statusInterpretation(candidates);
    default:
      return unsupportedInterpretation(candidates, "I could not interpret that instruction.");
  }
}

// ── Intent builders ────────────────────────────────────────────────────────

type IntentParts = {
  amount: CandidateAmount | null;
  currency: "USDC" | null;
  recipient: PaymentRecipient | null;
};

function baseIntent(
  action: AgentAction,
  parts: IntentParts,
  missingFields: MissingFieldKey[],
  candidates: PaymentCandidates,
  memo: string | null = null,
): AgentInterpretation["intent"] {
  return {
    action,
    amount: parts.amount?.raw ?? null,
    currency: parts.currency,
    recipient: parts.recipient,
    memo,
    missingFields,
    candidates,
    source: "natural_language",
  };
}

function payInterpretation(input: AgentInput, candidates: PaymentCandidates): AgentInterpretation {
  const amount = firstValidAmount(candidates.amounts);
  const currency = resolveCurrency(candidates, input);
  const recipient = resolveRecipient(candidates);
  const missing: MissingFieldKey[] = [];
  if (amount === null) missing.push("amount");
  if (currency === null) missing.push("currency");
  if (recipient === null) missing.push("recipient");

  // Display-only reason phrase: redacted and capped by extractMemo; never
  // authoritative over amount, recipient, policy, approval, or execution.
  const memo = extractMemo(input.rawText);

  if (missing.length > 0) {
    return {
      intent: baseIntent("pay", { amount, currency, recipient }, missing, candidates, memo),
      intentKind: "clarify_missing_fields",
      summary: `Payment needs: ${missing.join(", ")}.`,
      provider: "static",
    };
  }
  const parts = { amount: amount as CandidateAmount, currency: currency as "USDC", recipient };
  return {
    intent: baseIntent("pay", parts, [], candidates, memo),
    intentKind: "prepare_payment",
    summary: `Send ${parts.amount.raw} USDC to ${parts.recipient?.raw ?? "recipient"}.`,
    provider: "static",
  };
}

function claimInterpretation(input: AgentInput, candidates: PaymentCandidates): AgentInterpretation {
  const amount = firstValidAmount(candidates.claimAmounts.length > 0 ? candidates.claimAmounts : candidates.amounts);
  const currency = resolveCurrency(candidates, input);
  const missing: MissingFieldKey[] = [];
  if (amount === null) missing.push("amount");
  if (currency === null) missing.push("currency");

  if (missing.length > 0) {
    return {
      intent: baseIntent("claim_pay", { amount, currency, recipient: null }, missing, candidates),
      intentKind: "clarify_missing_fields",
      summary: `Claim needs: ${missing.join(", ")}.`,
      provider: "static",
    };
  }
  const parts = { amount: amount as CandidateAmount, currency: currency as "USDC", recipient: null };
  return {
    intent: baseIntent("claim_pay", parts, [], candidates),
    intentKind: "create_claim_link",
    summary: `Create claim link for ${parts.amount.raw} USDC.`,
    provider: "static",
  };
}

function statusInterpretation(candidates: PaymentCandidates): AgentInterpretation {
  const payoutId = candidates.payoutIds.find((candidate) => candidate.validationStatus === "valid") ?? null;
  if (payoutId === null) {
    return {
      intent: baseIntent("status", { amount: null, currency: null, recipient: null }, ["payout_id"], candidates),
      intentKind: "clarify_missing_fields",
      summary: "Status needs: payout_id.",
      provider: "static",
    };
  }
  return {
    intent: baseIntent("status", { amount: null, currency: null, recipient: null }, [], candidates),
    intentKind: "inspect_payment_status",
    summary: `Check payment ${payoutId.raw}.`,
    provider: "static",
  };
}

function unsupportedInterpretation(candidates: PaymentCandidates, reason: string): AgentInterpretation {
  return {
    intent: baseIntent("unknown", { amount: null, currency: null, recipient: null }, [], candidates),
    intentKind: "unsupported",
    summary: reason,
    provider: "static",
  };
}

// ── Deterministic helpers ──────────────────────────────────────────────────

function firstValidAmount(candidates: ReadonlyArray<{ validationStatus: string; raw: string }>): CandidateAmount | null {
  const valid = candidates.find((candidate) => candidate.validationStatus === "valid");
  return (valid as CandidateAmount | undefined) ?? null;
}

/**
 * The single allowed deterministic currency default: when no token was
 * mentioned and the input carries a Base workspace context (chain 8453),
 * the token defaults to USDC. Any other absence means clarification.
 */
function resolveCurrency(candidates: PaymentCandidates, input: AgentInput): "USDC" | null {
  const validTokens = candidates.tokens.filter((candidate) => candidate.validationStatus === "valid");
  if (validTokens.length > 0) return TOKEN_USDC;
  if (input.workspace !== null && input.workspace.chainId === BASE_CHAIN_ID) return TOKEN_USDC;
  return null;
}

/**
 * Recipient resolution is a SELECTION from extracted candidates only. One
 * address or one alias resolves; zero is unresolved; two or more (or a mix)
 * is ambiguous and stays unresolved for clarification.
 */
function resolveRecipient(candidates: PaymentCandidates): PaymentRecipient | null {
  const addresses = candidates.addresses.filter((candidate) => candidate.validationStatus === "valid");
  const aliases = candidates.aliases.filter((candidate) => candidate.validationStatus === "valid");
  if (addresses.length === 1 && aliases.length === 0) {
    const address = addresses[0];
    return {
      raw: address.raw,
      kind: "address",
      address: address.normalized ?? address.raw.toLowerCase(),
      alias: null,
    };
  }
  if (aliases.length === 1 && addresses.length === 0) {
    const alias = aliases[0];
    return {
      raw: alias.raw,
      kind: "alias",
      address: null,
      alias: alias.normalized ?? alias.raw.toLowerCase(),
    };
  }
  return null;
}

// ── HostileInterpreter (TEST SUPPORT ONLY) ─────────────────────────────────

export type HostilePayloadFactory = (extraction: ExtractionResult) => unknown;

/**
 * TEST SUPPORT ONLY. Deliberately returns malicious/unsafe outputs; the
 * schema validators and `safeInterpretation` must reject every one of them.
 * Never used in production routing.
 */
export class HostileInterpreter implements IntentInterpreter {
  private readonly payloadFactory: HostilePayloadFactory;

  constructor(payloadFactory: HostilePayloadFactory) {
    this.payloadFactory = payloadFactory;
  }

  async interpret(_input: AgentInput, extraction: ExtractionResult): Promise<AgentInterpretation> {
    return this.payloadFactory(extraction) as unknown as AgentInterpretation;
  }
}

function hostileIntent(
  extraction: ExtractionResult,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    intent: {
      action: "unknown",
      amount: null,
      currency: null,
      recipient: null,
      memo: null,
      missingFields: [],
      candidates: extraction.candidates,
      source: "natural_language",
      ...overrides,
    },
    intentKind: "unsupported",
    summary: "hostile",
    provider: "hostile",
  };
}

export const HOSTILE_PAYLOADS: Record<string, HostilePayloadFactory> = {
  execute_transfer: () =>
    hostileIntent(
      { candidates: { amounts: [], tokens: [], chains: [], addresses: [], aliases: [], payoutIds: [], claimAmounts: [] } } as unknown as ExtractionResult,
      { action: "execute_transfer" },
    ),
  call_keeperhub: (extraction) => ({
    ...hostileIntent(extraction, {}),
    plan: { action: "direct_keeperhub_call" },
  }),
  raw_sql: (extraction) => ({
    ...hostileIntent(extraction, {}),
    plan: { action: "raw_sql", query: "SELECT * FROM payouts" },
  }),
  arbitrary_http_request: (extraction) => ({
    ...hostileIntent(extraction, {}),
    plan: { action: "arbitrary_http_request", url: "https://evil.example/drain" },
  }),
  skip_approval: (extraction) => ({
    ...hostileIntent(extraction, {}),
    plan: { action: "prepare_payment", skipApproval: true },
  }),
  unknown_action: (extraction) => hostileIntent(extraction, { action: "refund" }),
  fabricated_amount: (extraction) => hostileIntent(extraction, { action: "pay", amount: "999", currency: "USDC" }),
  fabricated_address: (extraction) =>
    hostileIntent(extraction, {
      action: "pay",
      amount: "1",
      currency: "USDC",
      recipient: { raw: "0xEVIL000000000000000000000000000000000000", kind: "address", address: "0xEVIL000000000000000000000000000000000000", alias: null },
    }),
  wrong_intent_kind: (extraction) => hostileIntent(extraction, { action: "pay", amount: "1", currency: "USDC" }),
  smuggled_secret: (extraction) => ({
    ...hostileIntent(extraction, {}),
    apiKey: "sk-secret",
  }),
};

// Referenced so type-level intent kinds stay explicit in this module.
export type { AgentIntentKind };
