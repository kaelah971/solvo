import type { SolvoRepository } from "../../db/repository.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../db/types.ts";
import { generateClaimTokenPair } from "../../claim/token.ts";
import type { AgentPlannerDecision, PreparedClaimData } from "../planner.ts";
import { validateClaimRequestTool } from "../tools.ts";

/**
 * M8 — create_claim_link application bridge.
 *
 * The ONLY application-owned path that turns a `prepared_claim_link` planner
 * decision into a real M7 claim link. Called by deterministic Solvo
 * orchestration AFTER planning and policy inspection. It is NOT a
 * model-facing tool.
 *
 * M7 invariants are preserved by construction: the 192-bit CSPRNG token from
 * the existing `claim/token.ts` helper, SHA-256 hash-only persistence, single
 * use, immutable claimed recipient, configurable expiry, no payout and no
 * execution before human approval, requester cannot self-approve.
 */

export type CreateClaimLinkBridgeInput = {
  decision: AgentPlannerDecision;
  run: AgentRunRow;
  workspace: WorkspaceRow;
  member: WorkspaceMemberRow;
  userId: string;
  /** M7 claim expiry in hours (default 168 = 7 days). */
  claimExpiryHours?: number;
};

export type CreateClaimLinkBridgeResult = {
  outcome: "created" | "existing";
  claimId: string;
  /** Public claim link containing the one-time raw token (shown once). */
  claimUrl: string | null;
  tokenPrefix: string;
  amountBaseUnits: string;
  currencySymbol: "USDC";
  chainId: string;
  tokenAddress: string;
  expiresAt: string;
  state: string;
  approvalBehavior: string;
};

export type CreateClaimLinkBridgeDeps = {
  repo: SolvoRepository;
  appUrl: string;
};

export type CreateClaimLinkBridgeErrorCode =
  | "invalid_decision"
  | "workspace_required"
  | "member_required"
  | "community_only"
  | "judge_blocked"
  | "invalid_payload"
  | "policy_blocked";

export class CreateClaimLinkBridgeError extends Error {
  readonly code: CreateClaimLinkBridgeErrorCode;

  constructor(code: CreateClaimLinkBridgeErrorCode, message: string) {
    super(message);
    this.name = "CreateClaimLinkBridgeError";
    this.code = code;
  }
}

const BASE_UNITS_PATTERN = /^\d+$/;
const DEFAULT_CLAIM_EXPIRY_HOURS = 168;
const APPROVAL_BEHAVIOR =
  "Recipient submits a wallet address; an owner or approver approves the exact destination before anything moves.";

export async function bridgePreparedClaimLink(
  input: CreateClaimLinkBridgeInput,
  deps: CreateClaimLinkBridgeDeps,
): Promise<CreateClaimLinkBridgeResult> {
  if (input.decision.decision !== "prepared_claim_link") {
    throw new CreateClaimLinkBridgeError(
      "invalid_decision",
      `The claim-link bridge only accepts prepared_claim_link decisions (got ${input.decision.decision}).`,
    );
  }
  if (input.workspace === null || input.workspace === undefined) {
    throw new CreateClaimLinkBridgeError("workspace_required", "Workspace context is required to create a claim link.");
  }
  if (input.member === null || input.member === undefined || input.member.status !== "active") {
    throw new CreateClaimLinkBridgeError("member_required", "Active workspace membership is required to create a claim link.");
  }
  if (input.workspace.mode === "judge") {
    throw new CreateClaimLinkBridgeError("judge_blocked", "Judge Mode is not reachable through the agent bridge.");
  }
  if (input.workspace.mode !== "community") {
    throw new CreateClaimLinkBridgeError("community_only", "Claim links are only created in community workspaces.");
  }

  const prepared = input.decision.prepared;
  validateClaimPayload(prepared, input.workspace);

  const validation = await validateClaimRequestTool(
    { repo: deps.repo, workspace: input.workspace, member: input.member, userId: input.userId },
    { amount: baseUnitsToUsdc(prepared.amountBaseUnits), token: prepared.currency, chainId: prepared.chainId },
  );
  if (validation.status === "needs_context") {
    throw new CreateClaimLinkBridgeError("workspace_required", "Workspace context is required to create a claim link.");
  }
  if (validation.status !== "valid") {
    throw new CreateClaimLinkBridgeError("policy_blocked", validation.reason);
  }

  const expiryHours = input.claimExpiryHours ?? DEFAULT_CLAIM_EXPIRY_HOURS;
  const expiresAt = claimExpiresAtIso(expiryHours);
  const idempotencyKey = `ag:${input.run.idempotency_key}:claim`;

  const persisted = await deps.repo.transaction(async (tx) => {
    // Serialize identical deliveries: concurrent bridge calls resolve to ONE
    // claim, never a second token or row.
    await tx.lockIdempotencyKey(idempotencyKey);
    const raced = await tx.getClaimLinkByIdempotencyKey(idempotencyKey);
    if (raced) {
      await tx.updateAgentRun(input.run.id, { status: "claim_created", claimId: raced.id });
      return { existing: true, claim: raced, link: null };
    }

    const token = generateClaimTokenPair();
    const claim = await tx.createClaimLink({
      workspaceId: input.workspace.id,
      requesterId: input.userId,
      amountBaseUnits: prepared.amountBaseUnits,
      currencySymbol: "USDC",
      chainId: input.workspace.chain_id,
      tokenAddress: input.workspace.token_address,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt,
      idempotencyKey,
    });
    await tx.appendAuditEvent({
      workspaceId: input.workspace.id,
      payoutId: null,
      payoutItemId: null,
      eventType: "claim_created",
      actorType: "member",
      actorId: input.userId,
      metadata: {
        claimId: claim.id,
        amountBaseUnits: prepared.amountBaseUnits,
        tokenPrefix: token.prefix,
        expiresAt,
        agentRunId: input.run.id,
      },
    });
    await tx.updateAgentRun(input.run.id, {
      status: "claim_created",
      intentKind: "create_claim_link",
      planAction: "create_claim_link",
      decisionType: "prepared_claim_link",
      claimId: claim.id,
      decisionJson: {
        decision: "prepared_claim_link",
        amountBaseUnits: prepared.amountBaseUnits,
        source: prepared.source,
      },
    });
    return { existing: false, claim, link: `${deps.appUrl}/claim/${token.raw}` };
  });

  return {
    outcome: persisted.existing ? "existing" : "created",
    claimId: persisted.claim.id,
    claimUrl: persisted.link,
    tokenPrefix: persisted.claim.token_prefix,
    amountBaseUnits: prepared.amountBaseUnits,
    currencySymbol: "USDC",
    chainId: persisted.claim.chain_id,
    tokenAddress: persisted.claim.token_address,
    expiresAt: persisted.claim.expires_at,
    state: persisted.claim.status,
    approvalBehavior: APPROVAL_BEHAVIOR,
  };
}

function validateClaimPayload(prepared: PreparedClaimData, workspace: WorkspaceRow): void {
  if (prepared.currency !== "USDC") {
    throw new CreateClaimLinkBridgeError("invalid_payload", "Only Base USDC claim links can be created.");
  }
  if (!BASE_UNITS_PATTERN.test(prepared.amountBaseUnits) || BigInt(prepared.amountBaseUnits) <= 0n) {
    throw new CreateClaimLinkBridgeError("invalid_payload", "The prepared claim amount is invalid.");
  }
  if (prepared.chainId !== workspace.chain_id) {
    throw new CreateClaimLinkBridgeError("invalid_payload", "The prepared chain does not match the workspace.");
  }
  if (prepared.tokenAddress.toLowerCase() !== workspace.token_address.toLowerCase()) {
    throw new CreateClaimLinkBridgeError("invalid_payload", "The prepared token does not match the workspace.");
  }
}

/** Base units → USDC decimal for the existing claim request validator. */
function baseUnitsToUsdc(value: string): string {
  const v = BigInt(value);
  const whole = v / 1000000n;
  const fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

function claimExpiresAtIso(hours: number, now = new Date()): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}
