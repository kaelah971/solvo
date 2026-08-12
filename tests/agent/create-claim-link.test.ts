import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { hashAgentInput } from "../../src/server/agent/redact.ts";
import {
  CreateClaimLinkBridgeError,
  bridgePreparedClaimLink,
  type CreateClaimLinkBridgeInput,
} from "../../src/server/agent/bridges/create-claim-link.ts";
import { AGENT_TOOL_NAMES } from "../../src/server/agent/tools.ts";
import type { AgentPlannerDecision, PreparedClaimData } from "../../src/server/agent/planner.ts";
import type { AgentRunRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const APP_URL = "https://solvo.example";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

function claimData(overrides: Partial<PreparedClaimData> = {}): PreparedClaimData {
  return {
    source: "claim_request",
    amountBaseUnits: "50000",
    currency: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS.toLowerCase(),
    expiryHours: 168,
    ...overrides,
  };
}

function claimDecision(overrides: Partial<PreparedClaimData> = {}): AgentPlannerDecision {
  return { decision: "prepared_claim_link", planAction: "create_claim_link", prepared: claimData(overrides) };
}

async function makeFixture(overrides: { member?: boolean; mode?: "community" | "judge" | "sandbox" } = {}) {
  const repo = new MemoryRepository();
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode: overrides.mode ?? "community",
    name: "Test WS",
    telegramChatId: "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  let member: WorkspaceMemberRow | null = null;
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
    member = (await repo.getWorkspaceMember(workspace.id, "123456")) as WorkspaceMemberRow;
  }
  const run: AgentRunRow = await repo.createAgentRun({
    workspaceId: workspace.id,
    surface: "telegram",
    telegramChatId: "-100777",
    telegramUserId: "123456",
    telegramMessageId: "42",
    idempotencyKey: "tg:-100777:m42:agent",
    provider: "static",
    inputHash: hashAgentInput("create a claim link for 0.05 USDC"),
    rawTextRedacted: "create a claim link for 0.05 USDC",
  });
  return { repo, workspace, member, run };
}

function inputFor(fixture: Awaited<ReturnType<typeof makeFixture>>, decision: AgentPlannerDecision): CreateClaimLinkBridgeInput {
  return {
    decision,
    run: fixture.run,
    workspace: fixture.workspace,
    member: fixture.member as WorkspaceMemberRow,
    userId: "123456",
    claimExpiryHours: 168,
  };
}

describe("create-claim-link bridge", () => {
  it("creates exactly one claim link row", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    assert.equal(result.outcome, "created");
    const claims = await fixture.repo.listClaimsByWorkspace(fixture.workspace.id);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].id, result.claimId);
    assert.equal(claims[0].amount_base_units, "50000");
    assert.equal(claims[0].currency_symbol, "USDC");
  });

  it("persists only the SHA-256 token hash, never the raw token", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    const claim = await fixture.repo.getClaimLinkById(result.claimId);
    assert.ok(claim);
    assert.match(claim.token_hash, /^[0-9a-f]{64}$/);
    const rawToken = result.claimUrl?.split("/").pop();
    assert.ok(rawToken);
    assert.notEqual(claim.token_hash, rawToken);
    assert.equal(claim.token_hash.includes(rawToken), false);
    assert.equal("token_hash" in claim, true);
  });

  it("returns the public claim link on creation and none on duplicates", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, claimDecision());
    const deps = { repo: fixture.repo, appUrl: APP_URL };
    const first = await bridgePreparedClaimLink(input, deps);
    assert.equal(first.claimUrl?.startsWith(`${APP_URL}/claim/`), true);
    assert.match(first.tokenPrefix, /^[A-Za-z0-9_-]{8}$/);
    const second = await bridgePreparedClaimLink(input, deps);
    assert.equal(second.outcome, "existing");
    assert.equal(second.claimUrl, null);
  });

  it("gives the claim a configured expiry", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    const claim = await fixture.repo.getClaimLinkById(result.claimId);
    assert.ok(claim);
    const expiresMs = new Date(claim.expires_at).getTime();
    const expected = Date.now() + 168 * 60 * 60 * 1000;
    assert.ok(Math.abs(expiresMs - expected) < 10_000);
  });

  it("records no recipient before the web claim", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    const claim = await fixture.repo.getClaimLinkById(result.claimId);
    assert.equal(claim?.claimed_recipient, null);
    assert.equal(claim?.claimed_by, null);
  });

  it("creates no payout or execution before approval", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    const claim = await fixture.repo.getClaimLinkById(result.claimId);
    assert.equal(claim?.payout_id, null);
    assert.equal(claim?.status, "created");
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey(`ag:${fixture.run.idempotency_key}:claim`), null);
    assert.equal(await fixture.repo.getPayoutItemByIdempotencyKey(`ag:${fixture.run.idempotency_key}:prepare`), null);
  });

  it("blocks a judge-mode workspace", async () => {
    const fixture = await makeFixture({ mode: "judge" });
    await assert.rejects(
      () => bridgePreparedClaimLink(inputFor(fixture, claimDecision()), { repo: fixture.repo, appUrl: APP_URL }),
      (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "judge_blocked",
    );
  });

  it("blocks sandbox and other non-community contexts", async () => {
    const fixture = await makeFixture({ mode: "sandbox" });
    await assert.rejects(
      () => bridgePreparedClaimLink(inputFor(fixture, claimDecision()), { repo: fixture.repo, appUrl: APP_URL }),
      (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "community_only",
    );
  });

  it("blocks missing workspace and member context", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedClaimLink(
          { ...inputFor(fixture, claimDecision()), workspace: null as never },
          { repo: fixture.repo, appUrl: APP_URL },
        ),
      (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "workspace_required",
    );
    const noMember = await makeFixture({ member: false });
    await assert.rejects(
      () => bridgePreparedClaimLink(inputFor(noMember, claimDecision()), { repo: noMember.repo, appUrl: APP_URL }),
      (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "member_required",
    );
  });

  it("blocks unsupported tokens, chains, and malformed amounts", async () => {
    const fixture = await makeFixture();
    for (const decision of [
      claimDecision({ currency: "ETH" as never }),
      claimDecision({ chainId: "42220" }),
      claimDecision({ tokenAddress: "0x0000000000000000000000000000000000000001" }),
      claimDecision({ amountBaseUnits: "0" }),
      claimDecision({ amountBaseUnits: "abc" }),
    ]) {
      await assert.rejects(
        () => bridgePreparedClaimLink(inputFor(fixture, decision), { repo: fixture.repo, appUrl: APP_URL }),
        (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "invalid_payload",
      );
    }
  });

  it("blocks claim amounts above the workspace limit", async () => {
    const fixture = await makeFixture();
    await assert.rejects(
      () =>
        bridgePreparedClaimLink(inputFor(fixture, claimDecision({ amountBaseUnits: "2000000" })), {
          repo: fixture.repo,
          appUrl: APP_URL,
        }),
      (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "policy_blocked",
    );
  });

  it("returns the existing claim on duplicate idempotency without duplicating rows", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, claimDecision());
    const deps = { repo: fixture.repo, appUrl: APP_URL };
    const first = await bridgePreparedClaimLink(input, deps);
    const second = await bridgePreparedClaimLink(input, deps);
    assert.equal(second.outcome, "existing");
    assert.equal(second.claimId, first.claimId);
    assert.equal((await fixture.repo.listClaimsByWorkspace(fixture.workspace.id)).length, 1);
  });

  it("does not duplicate audit events on duplicate idempotency", async () => {
    const fixture = await makeFixture();
    const input = inputFor(fixture, claimDecision());
    const deps = { repo: fixture.repo, appUrl: APP_URL };
    const first = await bridgePreparedClaimLink(input, deps);
    await bridgePreparedClaimLink(input, deps);
    const createdAudits = fixture.repo.auditEvents.filter(
      (event) => event.metadata?.claimId === first.claimId && event.event_type === "claim_created",
    );
    assert.equal(createdAudits.length, 1);
  });

  it("links the agent run to the claim with an agent-specific status", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    const run = await fixture.repo.getAgentRunById(fixture.run.id);
    assert.ok(run);
    assert.equal(run.claim_id, result.claimId);
    assert.equal(run.payout_id, null);
    assert.equal(run.status, "claim_created");
    assert.notEqual(run.completed_at, null);
    const claimStates = ["created", "claimed", "approved", "executed", "cancelled"];
    assert.equal(claimStates.includes(run.status), false);
  });

  it("rejects non-prepared_claim_link planner decisions", async () => {
    const fixture = await makeFixture();
    for (const decision of [
      { decision: "prepared_payment", planAction: "prepare_payment", prepared: {} },
      { decision: "blocked", planAction: "decline_unsupported", reason: "no" },
      { decision: "ask_clarifying_question", planAction: "ask_clarifying_question", missingFields: ["amount"], question: "?" },
      { decision: "unsupported", planAction: "decline_unsupported", reason: "no" },
    ] as unknown as AgentPlannerDecision[]) {
      await assert.rejects(
        () => bridgePreparedClaimLink(inputFor(fixture, decision), { repo: fixture.repo, appUrl: APP_URL }),
        (error: unknown) => error instanceof CreateClaimLinkBridgeError && error.code === "invalid_decision",
      );
    }
  });

  it("leaves the M7 claim lifecycle unchanged after bridging", async () => {
    const fixture = await makeFixture();
    const result = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), {
      repo: fixture.repo,
      appUrl: APP_URL,
    });
    // Web claim records a wallet; nothing executes.
    const claimed = await fixture.repo.claimClaimLink({
      claimId: result.claimId,
      recipientAddress: RECIPIENT,
      claimedBy: "web",
      nowIso: new Date().toISOString(),
    });
    assert.equal(claimed?.status, "claimed");
    assert.equal(claimed?.claimed_recipient, RECIPIENT.toLowerCase());
    // Immutable destination: a second submission never mutates.
    const second = await fixture.repo.claimClaimLink({
      claimId: result.claimId,
      recipientAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      claimedBy: "web",
      nowIso: new Date().toISOString(),
    });
    assert.equal(second, null);
    // No payout was ever created by the bridge or the claim.
    const claim = await fixture.repo.getClaimLinkById(result.claimId);
    assert.equal(claim?.payout_id, null);
  });

  it("creates a fresh claim per distinct agent run", async () => {
    const fixture = await makeFixture();
    const deps = { repo: fixture.repo, appUrl: APP_URL };
    const first = await bridgePreparedClaimLink(inputFor(fixture, claimDecision()), deps);
    const otherRun = await fixture.repo.createAgentRun({
      workspaceId: fixture.workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: "123456",
      telegramMessageId: "43",
      idempotencyKey: "tg:-100777:m43:agent",
      provider: "static",
      inputHash: hashAgentInput("create a claim link for 0.05 USDC"),
    });
    const second = await bridgePreparedClaimLink({ ...inputFor(fixture, claimDecision()), run: otherRun }, deps);
    assert.notEqual(second.claimId, first.claimId);
  });

  it("bridge file imports no execution or KeeperHub modules", () => {
    const source = readFileSync("src/server/agent/bridges/create-claim-link.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "node:http", "claim/service"]) {
      assert.equal(imports.includes(forbidden), false, forbidden);
    }
  });

  it("is not registered as a model-facing agent tool", () => {
    assert.equal((AGENT_TOOL_NAMES as readonly string[]).includes("create_claim_link"), false);
  });
});
