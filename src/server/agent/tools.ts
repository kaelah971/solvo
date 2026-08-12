import type { SolvoRepository } from "../db/repository.ts";
import type { WorkspaceMemberRow, WorkspaceRow } from "../db/types.ts";
import { evaluateCommunityRequest } from "../telegram/policy.ts";
import { canonicalizeAmountLocal, usdcToBaseUnitsLocal } from "./extraction.ts";

/**
 * M8 — Bounded internal agent tool registry.
 *
 * A closed set of safe, deterministic tools the planner (and later a model)
 * may propose. Every tool is read-only or validation-only: none can execute,
 * approve, persist, or reach KeeperHub. Tool names are a strict union;
 * unknown or execution-like names are rejected by `getAgentTool` and
 * `validateAgentToolCall`. All repository access is dependency-injected so
 * the tools stay fully offline and testable.
 */

// ── Registry ───────────────────────────────────────────────────────────────

export const AGENT_TOOL_NAMES = [
  "resolve_recipient",
  "inspect_payment_policy",
  "inspect_payment_status",
  "validate_claim_request",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export type AgentToolSpec = {
  name: AgentToolName;
  /** Model-safe description: no secrets, no dangerous implementation detail. */
  description: string;
  workspaceModes: readonly string[];
};

const TOOL_SPECS: Record<AgentToolName, AgentToolSpec> = {
  resolve_recipient: {
    name: "resolve_recipient",
    description:
      "Resolve a recipient candidate (workspace alias or 0x address) to a verified workspace destination. Never invents addresses.",
    workspaceModes: ["community", "development", "sandbox", "personal"],
  },
  inspect_payment_policy: {
    name: "inspect_payment_policy",
    description:
      "Inspect workspace payment policy for an amount: approval requirements, per-transaction limits, and block reasons. Read-only facts.",
    workspaceModes: ["community"],
  },
  inspect_payment_status: {
    name: "inspect_payment_status",
    description:
      "Read the current state of a payout by id. Returns not_found or forbidden without details when access is not confirmed. Read-only.",
    workspaceModes: ["community", "development", "sandbox", "personal"],
  },
  validate_claim_request: {
    name: "validate_claim_request",
    description:
      "Validate a claim-link request (amount, token, workspace mode) and return prepared claim data for later creation. Creates nothing.",
    workspaceModes: ["community"],
  },
};

export function isAgentToolName(value: unknown): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly unknown[]).includes(value);
}

export function getAgentTool(name: string): AgentToolSpec | null {
  if (!isAgentToolName(name)) return null;
  return TOOL_SPECS[name];
}

export function listAgentToolSpecs(): readonly AgentToolSpec[] {
  return AGENT_TOOL_NAMES.map((name) => TOOL_SPECS[name]);
}

// ── Typed args ─────────────────────────────────────────────────────────────

export type ResolveRecipientArgs = { candidate: string };
export type InspectPolicyArgs = { amountBaseUnits: string | null; token: string | null; chainId: string | null };
export type InspectStatusArgs = { payoutId: string | null };
export type ValidateClaimArgs = { amount: string | null; token: string | null; chainId: string | null };

type ArgsResult = { ok: true; args: Record<string, unknown> } | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateArgs(
  raw: unknown,
  allowed: readonly string[],
  required: readonly string[],
  checks: Record<string, (value: unknown) => boolean>,
): ArgsResult {
  if (!isRecord(raw)) return { ok: false, reason: "args must be an object" };
  const keys = Object.keys(raw);
  if (!keys.every((key) => allowed.includes(key))) {
    return { ok: false, reason: `args has unknown keys: ${keys.filter((key) => !allowed.includes(key)).join(", ")}` };
  }
  for (const key of required) {
    if (raw[key] === undefined) return { ok: false, reason: `args.${key} is required` };
  }
  for (const key of allowed) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!checks[key](value)) return { ok: false, reason: `args.${key} has an invalid value` };
  }
  return { ok: true, args: raw };
}

const optionalString = (value: unknown): boolean => value === null || typeof value === "string";
const baseUnitsOrNull = (value: unknown): boolean => value === null || (typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n);

const ARG_VALIDATORS: Record<AgentToolName, { allowed: readonly string[]; required: readonly string[]; checks: Record<string, (value: unknown) => boolean> }> = {
  resolve_recipient: {
    allowed: ["candidate"],
    required: ["candidate"],
    checks: { candidate: (value) => typeof value === "string" && value.trim().length > 0 },
  },
  inspect_payment_policy: {
    allowed: ["amountBaseUnits", "token", "chainId"],
    required: [],
    checks: { amountBaseUnits: baseUnitsOrNull, token: optionalString, chainId: optionalString },
  },
  inspect_payment_status: {
    allowed: ["payoutId"],
    required: [],
    checks: { payoutId: optionalString },
  },
  validate_claim_request: {
    allowed: ["amount", "token", "chainId"],
    required: [],
    checks: { amount: optionalString, token: optionalString, chainId: optionalString },
  },
};

export type AgentToolCallValidation =
  | { ok: true; name: AgentToolName; args: Record<string, unknown> }
  | { ok: false; reason: string };

export function validateAgentToolCall(name: unknown, args: unknown): AgentToolCallValidation {
  if (!isAgentToolName(name)) return { ok: false, reason: `unknown agent tool: ${String(name)}` };
  const validator = ARG_VALIDATORS[name];
  const result = validateArgs(args, validator.allowed, validator.required, validator.checks);
  if (!result.ok) return { ok: false, reason: `invalid args for ${name}: ${result.reason}` };
  return { ok: true, name, args: result.args };
}

// ── Tool context (dependency injection; never live singletons) ────────────

export type AgentToolContext = {
  repo: SolvoRepository;
  workspace: WorkspaceRow | null;
  member: WorkspaceMemberRow | null;
  userId: string;
};

// ── resolve_recipient ──────────────────────────────────────────────────────

export type RecipientResolution =
  | { status: "resolved"; address: string; alias: string | null }
  | { status: "unresolved"; reason: string }
  | { status: "ambiguous"; matches: string[] }
  | { status: "invalid"; reason: string }
  | { status: "needs_resolution"; reason: string };

const HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x" + "0".repeat(40);

export async function resolveRecipientTool(ctx: AgentToolContext, args: ResolveRecipientArgs): Promise<RecipientResolution> {
  const candidate = args.candidate.trim();
  if (candidate.length === 0) return { status: "invalid", reason: "A recipient candidate is required." };

  if (HEX_ADDRESS_PATTERN.test(candidate)) {
    if (candidate.toLowerCase() === ZERO_ADDRESS) {
      return { status: "invalid", reason: "The zero address is not an acceptable recipient." };
    }
    return { status: "resolved", address: candidate.toLowerCase(), alias: null };
  }
  if (candidate.startsWith("0x")) {
    return { status: "invalid", reason: "Address must be 40 hex characters prefixed with 0x." };
  }

  if (ctx.workspace === null) {
    return { status: "needs_resolution", reason: "Workspace context is required to resolve a name or alias." };
  }

  const alias = candidate.toLowerCase();
  const directory = await ctx.repo.getRecipientByAlias(ctx.workspace.id, alias);
  if (directory) {
    return { status: "resolved", address: directory.wallet_address.toLowerCase(), alias: directory.alias };
  }

  const matches = (await ctx.repo.listRecipients(ctx.workspace.id))
    .filter((recipient) => recipient.alias === alias)
    .map((recipient) => recipient.alias);
  if (matches.length === 1) {
    const recipient = await ctx.repo.getRecipientByAlias(ctx.workspace.id, alias);
    if (recipient) {
      return { status: "resolved", address: recipient.wallet_address.toLowerCase(), alias: recipient.alias };
    }
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return { status: "unresolved", reason: `No verified recipient "${candidate}" in this workspace.` };
}

// ── inspect_payment_policy ─────────────────────────────────────────────────

export type PolicyInspection = {
  allowed: boolean;
  approvalRequired: boolean;
  denied: boolean;
  missingContext: boolean;
  reason: string;
  perTxLimitUsdc: string | null;
  remainingPerTxUsdc: string | null;
};

function baseUnitsToUsdcDecimal(value: string): string {
  const v = BigInt(value);
  const whole = v / 1000000n;
  const fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

function conservativePolicy(missingContext: boolean, reason: string): PolicyInspection {
  return {
    allowed: false,
    approvalRequired: false,
    denied: false,
    missingContext,
    reason,
    perTxLimitUsdc: null,
    remainingPerTxUsdc: null,
  };
}

function deniedPolicy(reason: string): PolicyInspection {
  return {
    allowed: false,
    approvalRequired: false,
    denied: true,
    missingContext: false,
    reason,
    perTxLimitUsdc: null,
    remainingPerTxUsdc: null,
  };
}

export async function inspectPaymentPolicyTool(ctx: AgentToolContext, args: InspectPolicyArgs): Promise<PolicyInspection> {
  if (ctx.workspace === null) {
    return conservativePolicy(true, "Workspace context is required to inspect payment policy.");
  }
  if (args.amountBaseUnits === null) {
    return conservativePolicy(true, "An amount is required to inspect payment policy.");
  }
  const amount = BigInt(args.amountBaseUnits);
  if (amount <= 0n) {
    return deniedPolicy("Amount must be greater than zero.");
  }
  if (args.token !== null && args.token.toLowerCase() !== "usdc") {
    return deniedPolicy("Solvo executes Base USDC only.");
  }
  if (args.chainId !== null && args.chainId !== ctx.workspace.chain_id) {
    return deniedPolicy("The requested chain does not match this workspace.");
  }

  const policy = evaluateCommunityRequest({
    workspaceActive: ctx.workspace.status === "active",
    isMember: ctx.member !== null && ctx.member.status === "active",
    amountBaseUnits: args.amountBaseUnits,
    chainId: ctx.workspace.chain_id,
    tokenAddress: ctx.workspace.token_address,
    perTransactionLimitBaseUnits: ctx.workspace.per_transaction_limit_base_units,
  });

  const perTxLimitUsdc =
    ctx.workspace.per_transaction_limit_base_units !== null
      ? baseUnitsToUsdcDecimal(ctx.workspace.per_transaction_limit_base_units)
      : null;
  const remainingPerTxUsdc =
    ctx.workspace.per_transaction_limit_base_units !== null
      ? baseUnitsToUsdcDecimal((BigInt(ctx.workspace.per_transaction_limit_base_units) - amount).toString())
      : null;

  if (policy.decision === "blocked") {
    return {
      allowed: false,
      approvalRequired: false,
      denied: true,
      missingContext: false,
      reason: policy.reason,
      perTxLimitUsdc,
      remainingPerTxUsdc,
    };
  }
  return {
    allowed: true,
    approvalRequired: policy.decision === "approval_required",
    denied: false,
    missingContext: false,
    reason: policy.reason,
    perTxLimitUsdc,
    remainingPerTxUsdc,
  };
}

// ── inspect_payment_status ─────────────────────────────────────────────────

export type StatusInspection =
  | { status: "visible"; payoutId: string; state: string; itemCount: number; completedAt: string | null }
  | { status: "not_found"; payoutId: string }
  | { status: "forbidden"; payoutId: string; reason: string }
  | { status: "malformed"; payoutId: string | null; reason: string };

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function inspectPaymentStatusTool(ctx: AgentToolContext, args: InspectStatusArgs): Promise<StatusInspection> {
  const payoutId = args.payoutId;
  if (payoutId === null || payoutId.trim().length === 0) {
    return { status: "malformed", payoutId: null, reason: "A payout id is required." };
  }
  const trimmed = payoutId.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    return { status: "malformed", payoutId: trimmed, reason: "Payout id must be a UUID." };
  }

  const payout = await ctx.repo.getPayoutById(trimmed);
  if (!payout) {
    return { status: "not_found", payoutId: trimmed };
  }

  const workspace = await ctx.repo.getWorkspaceById(payout.workspace_id);
  const sameWorkspace = ctx.workspace !== null && workspace !== null && ctx.workspace.id === workspace.id;
  const isMember = ctx.member !== null && ctx.member.status === "active";
  if (!sameWorkspace || !isMember) {
    // Deliberately generic: never leak whether a payout exists elsewhere.
    return { status: "forbidden", payoutId: trimmed, reason: "Payout details are not available to this caller." };
  }

  const items = await ctx.repo.getPayoutItemsByPayoutId(trimmed);
  return {
    status: "visible",
    payoutId: trimmed,
    state: payout.status,
    itemCount: items.length,
    completedAt: payout.completed_at,
  };
}

// ── validate_claim_request ─────────────────────────────────────────────────

export type ClaimRequestValidation =
  | {
      status: "valid";
      claim: {
        workspaceId: string;
        amountBaseUnits: string;
        currencySymbol: "USDC";
        chainId: string;
        tokenAddress: string;
      };
    }
  | { status: "invalid"; reason: string }
  | { status: "needs_context"; reason: string };

export async function validateClaimRequestTool(ctx: AgentToolContext, args: ValidateClaimArgs): Promise<ClaimRequestValidation> {
  if (ctx.workspace === null) {
    return { status: "needs_context", reason: "Workspace context is required to validate a claim request." };
  }
  if (args.amount === null) {
    return { status: "invalid", reason: "A claim amount is required." };
  }
  const canonical = canonicalizeAmountLocal(args.amount);
  if (canonical === "invalid" || canonical === "0" || (canonical.split(".")[1]?.length ?? 0) > 6) {
    return { status: "invalid", reason: "Claim amount must be a positive USDC decimal with at most 6 decimal places." };
  }
  const amountBaseUnits = usdcToBaseUnitsLocal(canonical);
  if (amountBaseUnits === null) {
    return { status: "invalid", reason: "Claim amount must be a positive USDC decimal with at most 6 decimal places." };
  }
  if (args.token !== null && args.token.toLowerCase() !== "usdc") {
    return { status: "invalid", reason: "Solvo executes Base USDC only." };
  }
  if (args.chainId !== null && args.chainId !== ctx.workspace.chain_id) {
    return { status: "invalid", reason: "The requested chain does not match this workspace." };
  }

  const policy = evaluateCommunityRequest({
    workspaceActive: ctx.workspace.status === "active",
    isMember: ctx.member !== null && ctx.member.status === "active",
    amountBaseUnits,
    chainId: ctx.workspace.chain_id,
    tokenAddress: ctx.workspace.token_address,
    perTransactionLimitBaseUnits: ctx.workspace.per_transaction_limit_base_units,
  });
  if (policy.decision === "blocked") {
    return { status: "invalid", reason: policy.reason };
  }

  return {
    status: "valid",
    claim: {
      workspaceId: ctx.workspace.id,
      amountBaseUnits,
      currencySymbol: "USDC",
      chainId: ctx.workspace.chain_id,
      tokenAddress: ctx.workspace.token_address.toLowerCase(),
    },
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────────

export type AgentToolResult = RecipientResolution | PolicyInspection | StatusInspection | ClaimRequestValidation;

/**
 * Validates the call (name allowlist + typed args) and dispatches to the
 * safe handler. Throws typed errors on unknown names or invalid args; the
 * planner must treat a throw as a failed tool call that changes nothing.
 */
export async function executeAgentTool(
  name: AgentToolName,
  ctx: AgentToolContext,
  args: unknown,
): Promise<AgentToolResult> {
  const validation = validateAgentToolCall(name, args);
  if (!validation.ok) {
    throw new Error(`invalid args for agent tool: ${validation.reason}`);
  }
  switch (name) {
    case "resolve_recipient":
      return resolveRecipientTool(ctx, validation.args as unknown as ResolveRecipientArgs);
    case "inspect_payment_policy":
      return inspectPaymentPolicyTool(ctx, validation.args as unknown as InspectPolicyArgs);
    case "inspect_payment_status":
      return inspectPaymentStatusTool(ctx, validation.args as unknown as InspectStatusArgs);
    case "validate_claim_request":
      return validateClaimRequestTool(ctx, validation.args as unknown as ValidateClaimArgs);
  }
}
