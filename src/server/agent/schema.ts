import {
  classifyAgentAction,
  isAgentAction,
  isAgentIntentKind,
  isAgentPlanAction,
  MISSING_FIELD_KEYS,
  type AgentInput,
  type AgentInterpretation,
  type AgentPlan,
  type AgentResult,
  type CandidateSourceField,
  type CandidateValidationStatus,
  type PaymentCandidates,
  type PaymentIntent,
} from "./types.ts";

/**
 * M8 — Lightweight, dependency-free runtime validators for the agent
 * contract layer.
 *
 * Rules:
 *  - strict: unknown keys are rejected (a hostile payload cannot smuggle
 *    secrets or extra instructions in);
 *  - provenance-bound: intent amounts/addresses/aliases must be selections
 *    from the deterministic candidates;
 *  - deterministic: no timestamps, ids, randomness, or I/O anywhere here;
 *  - fail closed: anything malformed yields { ok: false, reason }.
 *
 * The amount grammar below mirrors keeperhub/amount.ts (positive decimal,
 * no signs/exponents, ≤ 6 decimals) WITHOUT importing keeperhub — the agent
 * layer must stay import-clean from KeeperHub modules. The authoritative
 * money parse still happens later in the deterministic planner/tools.
 */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const MEMO_MAX_LENGTH = 140;
const SUMMARY_MAX_LENGTH = 200;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS_PATTERN = /^\d+$/;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function hasOnlyKeys(record: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function fail(reason: string): ValidationResult<never> {
  return { ok: false, reason };
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

/**
 * Positive USDC decimal grammar mirror (see header note). Also used for
 * claim amounts: same money grammar.
 */
export function isWellFormedUsdcAmount(value: unknown): value is string {
  if (!isString(value) || value.length === 0) return false;
  if (value.startsWith("+") || value.startsWith("-")) return false;
  if (value.includes("e") || value.includes("E")) return false;
  const dot = value.indexOf(".");
  const whole = dot >= 0 ? value.slice(0, dot) : value;
  const fraction = dot >= 0 ? value.slice(dot + 1) : "";
  if (!/^\d+$/.test(whole) || (dot >= 0 && !/^\d*$/.test(fraction))) return false;
  if (fraction.length > 6) return false;
  const canonical = fraction.length === 0 ? whole : `${whole}.${fraction}`.replace(/0+$/, "").replace(/\.$/, "");
  if (canonical === "0" || canonical === "") return false;
  return true;
}

export function isWellFormedBaseUnits(value: unknown): value is string {
  if (!isString(value) || !BASE_UNITS_PATTERN.test(value)) return false;
  return BigInt(value) > 0n;
}

export function isIsoTimestamp(value: unknown): value is string {
  return isString(value) && ISO_TIMESTAMP_PATTERN.test(value);
}

// ── Candidates ─────────────────────────────────────────────────────────────

const CANDIDATE_KEYS = ["sourceField", "raw", "normalized", "validationStatus"] as const;
const VALIDATION_STATUSES: readonly CandidateValidationStatus[] = ["valid", "invalid", "pending"];

function isCandidateSourceField(value: unknown, allowed: readonly CandidateSourceField[]): value is CandidateSourceField {
  return (allowed as readonly unknown[]).includes(value);
}

function validateCandidate(
  raw: unknown,
  allowedSourceFields: readonly CandidateSourceField[],
  label: string,
): ValidationResult<unknown> {
  if (!isRecord(raw)) return fail(`${label}: candidate must be an object`);
  if (!hasOnlyKeys(raw, CANDIDATE_KEYS)) return fail(`${label}: candidate has unknown keys`);
  if (!isCandidateSourceField(raw.sourceField, allowedSourceFields)) {
    return fail(`${label}: candidate sourceField must be one of ${allowedSourceFields.join(", ")}`);
  }
  if (!isString(raw.raw) || raw.raw.length === 0) return fail(`${label}: candidate raw must be a non-empty string`);
  if (raw.normalized !== null && !isString(raw.normalized)) return fail(`${label}: candidate normalized must be a string or null`);
  if (!(VALIDATION_STATUSES as readonly unknown[]).includes(raw.validationStatus)) {
    return fail(`${label}: candidate validationStatus must be valid, invalid or pending`);
  }
  return ok(raw);
}

function validateCandidateArray(raw: unknown, allowedSourceFields: readonly CandidateSourceField[], label: string): ValidationResult<unknown> {
  if (!Array.isArray(raw)) return fail(`${label}: must be an array`);
  for (const entry of raw) {
    const result = validateCandidate(entry, allowedSourceFields, label);
    if (!result.ok) return result;
  }
  return ok(raw);
}

export function validatePaymentCandidates(raw: unknown): ValidationResult<PaymentCandidates> {
  if (!isRecord(raw)) return fail("candidates: must be an object");
  if (!hasOnlyKeys(raw, ["amounts", "tokens", "chains", "addresses", "aliases", "payoutIds", "claimAmounts"])) {
    return fail("candidates: has unknown keys");
  }
  const checks: Array<{ key: string; fields: readonly CandidateSourceField[]; label: string }> = [
    { key: "amounts", fields: ["raw_amount"], label: "candidates.amounts" },
    { key: "tokens", fields: ["raw_token"], label: "candidates.tokens" },
    { key: "chains", fields: ["raw_chain", "workspace_config"], label: "candidates.chains" },
    { key: "addresses", fields: ["raw_address"], label: "candidates.addresses" },
    { key: "aliases", fields: ["raw_alias"], label: "candidates.aliases" },
    { key: "payoutIds", fields: ["raw_payout_id"], label: "candidates.payoutIds" },
    { key: "claimAmounts", fields: ["raw_amount"], label: "candidates.claimAmounts" },
  ];
  for (const check of checks) {
    const result = validateCandidateArray(raw[check.key], check.fields, check.label);
    if (!result.ok) return result;
  }
  return ok(raw as unknown as PaymentCandidates);
}

// ── PaymentIntent ──────────────────────────────────────────────────────────

const RECIPIENT_KEYS = ["raw", "kind", "address", "alias"] as const;
const RECIPIENT_KINDS = ["address", "alias", "username", "name", null] as const;

function amountIsFromCandidates(amount: string, candidates: PaymentCandidates): boolean {
  const haystack = [...candidates.amounts, ...candidates.claimAmounts];
  return haystack.some((candidate) => candidate.raw === amount || candidate.normalized === amount);
}

function addressIsFromCandidates(address: string, candidates: PaymentCandidates): boolean {
  const lower = address.toLowerCase();
  return candidates.addresses.some(
    (candidate) => candidate.raw.toLowerCase() === lower || candidate.normalized?.toLowerCase() === lower,
  );
}

function aliasIsFromCandidates(alias: string, candidates: PaymentCandidates): boolean {
  const lower = alias.toLowerCase();
  return candidates.aliases.some(
    (candidate) => candidate.raw.toLowerCase() === lower || candidate.normalized?.toLowerCase() === lower,
  );
}

export function validatePaymentIntent(raw: unknown): ValidationResult<PaymentIntent> {
  if (!isRecord(raw)) return fail("intent: must be an object");
  if (!hasOnlyKeys(raw, ["action", "amount", "currency", "recipient", "memo", "missingFields", "candidates", "source"])) {
    return fail("intent: has unknown keys");
  }
  if (!isAgentAction(raw.action)) return fail("intent.action: must be pay, claim_pay, status or unknown");
  if (raw.amount !== null) {
    if (!isWellFormedUsdcAmount(raw.amount)) return fail("intent.amount: must be a positive USDC decimal without signs or exponents");
  }
  if (raw.currency !== null && raw.currency !== "USDC") return fail("intent.currency: only USDC is supported");
  if (raw.source !== "natural_language") return fail("intent.source: must be natural_language");
  if (raw.memo !== null && (!isString(raw.memo) || raw.memo.length > MEMO_MAX_LENGTH)) {
    return fail(`intent.memo: must be a string of at most ${MEMO_MAX_LENGTH} characters or null`);
  }
  if (
    !Array.isArray(raw.missingFields) ||
    !raw.missingFields.every((key) => (MISSING_FIELD_KEYS as readonly unknown[]).includes(key))
  ) {
    return fail(`intent.missingFields: must contain only ${MISSING_FIELD_KEYS.join(", ")}`);
  }
  const candidatesResult = validatePaymentCandidates(raw.candidates);
  if (!candidatesResult.ok) return candidatesResult;
  const candidates = candidatesResult.value;

  if (raw.recipient !== null) {
    if (!isRecord(raw.recipient)) return fail("intent.recipient: must be an object or null");
    if (!hasOnlyKeys(raw.recipient, RECIPIENT_KEYS)) return fail("intent.recipient: has unknown keys");
    if (!(RECIPIENT_KINDS as readonly unknown[]).includes(raw.recipient.kind)) {
      return fail("intent.recipient.kind: must be address, alias, username, name or null");
    }
    if (raw.recipient.raw !== null && !isString(raw.recipient.raw)) return fail("intent.recipient.raw: must be a string or null");
    if (raw.recipient.address !== null && !isString(raw.recipient.address)) {
      return fail("intent.recipient.address: must be a string or null");
    }
    if (raw.recipient.alias !== null && !isString(raw.recipient.alias)) {
      return fail("intent.recipient.alias: must be a string or null");
    }
    if (raw.recipient.kind === "address") {
      if (!isString(raw.recipient.address) || !addressIsFromCandidates(raw.recipient.address, candidates)) {
        return fail("intent.recipient.address: must equal a deterministically extracted candidate address");
      }
    }
    if (raw.recipient.kind === "alias") {
      if (!isString(raw.recipient.alias) || !aliasIsFromCandidates(raw.recipient.alias, candidates)) {
        return fail("intent.recipient.alias: must equal a deterministically extracted candidate alias");
      }
    }
  }

  if (isString(raw.amount) && !amountIsFromCandidates(raw.amount, candidates)) {
    return fail("intent.amount: must equal a deterministically extracted candidate amount");
  }

  return ok(raw as unknown as PaymentIntent);
}

// ── AgentInput ─────────────────────────────────────────────────────────────

const INPUT_KEYS = ["surface", "chatId", "userId", "messageId", "rawText", "timestampIso", "workspace", "flags", "candidates"] as const;
const WORKSPACE_KEYS = ["id", "mode", "chainId", "tokenAddress", "aliases", "perTransactionLimitUsdc", "dailyLimitUsdc", "workspaceActive"] as const;
const FLAGS_KEYS = ["workspaceMode", "isMember"] as const;
const WORKSPACE_MODES = ["sandbox", "development", "personal", "community", "judge"] as const;

export function validateAgentInput(raw: unknown): ValidationResult<AgentInput> {
  if (!isRecord(raw)) return fail("input: must be an object");
  if (!hasOnlyKeys(raw, INPUT_KEYS)) return fail("input: has unknown keys");
  if (raw.surface !== "telegram") return fail("input.surface: must be telegram");
  if (!isString(raw.chatId) || raw.chatId.length === 0) return fail("input.chatId: required");
  if (!isString(raw.userId) || raw.userId.length === 0) return fail("input.userId: required");
  if (raw.messageId !== null && typeof raw.messageId !== "number") return fail("input.messageId: must be a number or null");
  if (!isString(raw.rawText)) return fail("input.rawText: must be a string");
  if (!isIsoTimestamp(raw.timestampIso)) return fail("input.timestampIso: must be an ISO-8601 UTC timestamp");
  if (!isRecord(raw.flags) || !hasOnlyKeys(raw.flags, FLAGS_KEYS)) return fail("input.flags: invalid");
  if (raw.flags.workspaceMode !== null && !(WORKSPACE_MODES as readonly unknown[]).includes(raw.flags.workspaceMode)) {
    return fail("input.flags.workspaceMode: unknown workspace mode");
  }
  if (typeof raw.flags.isMember !== "boolean") return fail("input.flags.isMember: must be a boolean");
  if (raw.workspace !== null) {
    if (!isRecord(raw.workspace) || !hasOnlyKeys(raw.workspace, WORKSPACE_KEYS)) return fail("input.workspace: invalid");
    if (!isString(raw.workspace.id) || raw.workspace.id.length === 0) return fail("input.workspace.id: required");
    if (!(WORKSPACE_MODES as readonly unknown[]).includes(raw.workspace.mode)) {
      return fail("input.workspace.mode: unknown workspace mode");
    }
    if (!isString(raw.workspace.chainId) || !isString(raw.workspace.tokenAddress)) {
      return fail("input.workspace.chainId/tokenAddress: required");
    }
    if (!Array.isArray(raw.workspace.aliases) || !raw.workspace.aliases.every(isString)) {
      return fail("input.workspace.aliases: must be an array of strings");
    }
    if (raw.workspace.perTransactionLimitUsdc !== null && !isWellFormedUsdcAmount(raw.workspace.perTransactionLimitUsdc)) {
      return fail("input.workspace.perTransactionLimitUsdc: must be a positive USDC decimal or null");
    }
    if (raw.workspace.dailyLimitUsdc !== null && !isWellFormedUsdcAmount(raw.workspace.dailyLimitUsdc)) {
      return fail("input.workspace.dailyLimitUsdc: must be a positive USDC decimal or null");
    }
    if (typeof raw.workspace.workspaceActive !== "boolean") return fail("input.workspace.workspaceActive: must be a boolean");
  }
  const candidatesResult = validatePaymentCandidates(raw.candidates);
  if (!candidatesResult.ok) return candidatesResult;
  return ok(raw as unknown as AgentInput);
}

// ── AgentInterpretation ────────────────────────────────────────────────────

const INTERPRETATION_KEYS = ["intent", "intentKind", "summary", "provider"] as const;

export function validateAgentInterpretation(raw: unknown): ValidationResult<AgentInterpretation> {
  if (!isRecord(raw)) return fail("interpretation: must be an object");
  if (!hasOnlyKeys(raw, INTERPRETATION_KEYS)) return fail("interpretation: has unknown keys");
  const intentResult = validatePaymentIntent(raw.intent);
  if (!intentResult.ok) return intentResult;
  if (!isAgentIntentKind(raw.intentKind)) return fail("interpretation.intentKind: unknown intent kind");
  if (raw.intentKind !== classifyAgentAction(intentResult.value.action)) {
    return fail(`interpretation.intentKind: must be ${classifyAgentAction(intentResult.value.action)} for action ${intentResult.value.action}`);
  }
  if (!isString(raw.summary) || raw.summary.length === 0 || raw.summary.length > SUMMARY_MAX_LENGTH) {
    return fail(`interpretation.summary: must be 1-${SUMMARY_MAX_LENGTH} characters`);
  }
  if (!isString(raw.provider) || raw.provider.length === 0) return fail("interpretation.provider: required");
  return ok(raw as unknown as AgentInterpretation);
}

// ── AgentPlan ──────────────────────────────────────────────────────────────

export function validateAgentPlan(raw: unknown): ValidationResult<AgentPlan> {
  if (!isRecord(raw) || !isAgentPlanAction(raw.action)) {
    return fail("plan.action: must be one of ask_clarifying_question, prepare_payment, create_claim_link, inspect_payment_status, decline_unsupported");
  }
  switch (raw.action) {
    case "ask_clarifying_question": {
      if (!hasOnlyKeys(raw, ["action", "missingFields", "question"])) return fail("plan: has unknown keys");
      if (
        !Array.isArray(raw.missingFields) ||
        raw.missingFields.length === 0 ||
        !raw.missingFields.every((key) => (MISSING_FIELD_KEYS as readonly unknown[]).includes(key))
      ) {
        return fail("plan.missingFields: must be a non-empty list of known missing-field keys");
      }
      if (!isString(raw.question) || raw.question.length === 0) return fail("plan.question: required");
      return ok(raw as unknown as AgentPlan);
    }
    case "prepare_payment": {
      if (!hasOnlyKeys(raw, ["action", "payout"])) return fail("plan: has unknown keys");
      if (!isRecord(raw.payout) || !hasOnlyKeys(raw.payout, ["recipientAddress", "amountBaseUnits", "memo"])) {
        return fail("plan.payout: must contain only recipientAddress, amountBaseUnits, memo");
      }
      if (!isString(raw.payout.recipientAddress) || !HEX_ADDRESS_PATTERN.test(raw.payout.recipientAddress)) {
        return fail("plan.payout.recipientAddress: must be a 40-hex 0x address");
      }
      if (!isWellFormedBaseUnits(raw.payout.amountBaseUnits)) {
        return fail("plan.payout.amountBaseUnits: must be positive integer base units");
      }
      if (raw.payout.memo !== null && (!isString(raw.payout.memo) || raw.payout.memo.length > MEMO_MAX_LENGTH)) {
        return fail(`plan.payout.memo: must be a string of at most ${MEMO_MAX_LENGTH} characters or null`);
      }
      return ok(raw as unknown as AgentPlan);
    }
    case "create_claim_link": {
      if (!hasOnlyKeys(raw, ["action", "claim"])) return fail("plan: has unknown keys");
      if (!isRecord(raw.claim) || !hasOnlyKeys(raw.claim, ["amountBaseUnits"])) return fail("plan.claim: must contain only amountBaseUnits");
      if (!isWellFormedBaseUnits(raw.claim.amountBaseUnits)) {
        return fail("plan.claim.amountBaseUnits: must be positive integer base units");
      }
      return ok(raw as unknown as AgentPlan);
    }
    case "inspect_payment_status": {
      if (!hasOnlyKeys(raw, ["action", "payoutId"])) return fail("plan: has unknown keys");
      if (raw.payoutId !== null && !isString(raw.payoutId)) return fail("plan.payoutId: must be a string or null");
      return ok(raw as unknown as AgentPlan);
    }
    case "decline_unsupported": {
      if (!hasOnlyKeys(raw, ["action", "reason"])) return fail("plan: has unknown keys");
      if (!isString(raw.reason) || raw.reason.length === 0) return fail("plan.reason: required");
      return ok(raw as unknown as AgentPlan);
    }
  }
}

// ── AgentResult ────────────────────────────────────────────────────────────

const RESULT_KEYS = ["intent", "plan", "candidates", "reply", "safetyFlags"] as const;
const REPLY_KEYS = ["text", "buttons"] as const;
const BUTTON_KEYS = ["text", "callbackData"] as const;

export function validateAgentResult(raw: unknown): ValidationResult<AgentResult> {
  if (!isRecord(raw)) return fail("result: must be an object");
  if (!hasOnlyKeys(raw, RESULT_KEYS)) return fail("result: has unknown keys");
  if (raw.intent !== null) {
    const intentResult = validatePaymentIntent(raw.intent);
    if (!intentResult.ok) return intentResult;
  }
  if (raw.plan !== null) {
    const planResult = validateAgentPlan(raw.plan);
    if (!planResult.ok) return planResult;
  }
  const candidatesResult = validatePaymentCandidates(raw.candidates);
  if (!candidatesResult.ok) return candidatesResult;
  if (raw.reply !== null) {
    if (!isRecord(raw.reply) || !hasOnlyKeys(raw.reply, REPLY_KEYS)) return fail("result.reply: invalid");
    if (!isString(raw.reply.text)) return fail("result.reply.text: required");
    if (!Array.isArray(raw.reply.buttons)) return fail("result.reply.buttons: must be an array");
    for (const button of raw.reply.buttons) {
      if (!isRecord(button) || !hasOnlyKeys(button, BUTTON_KEYS)) return fail("result.reply.buttons: invalid entry");
      if (!isString(button.text) || !isString(button.callbackData)) {
        return fail("result.reply.buttons: text and callbackData are required");
      }
    }
  }
  if (!Array.isArray(raw.safetyFlags) || !raw.safetyFlags.every(isString)) {
    return fail("result.safetyFlags: must be an array of strings");
  }
  return ok(raw as unknown as AgentResult);
}
