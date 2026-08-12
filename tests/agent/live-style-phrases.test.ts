import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { extractCandidates, extractMemo } from "../../src/server/agent/extraction.ts";
import { AgentPlanner } from "../../src/server/agent/planner.ts";
import { validateAgentInterpretation } from "../../src/server/agent/schema.ts";
import { interpretStatically } from "../../src/server/agent/static-interpreter.ts";
import type { AgentInput, AgentInterpretation } from "../../src/server/agent/types.ts";
import { AGENT_LIVE_STYLE_PHRASES, type AgentPhrase } from "../fixtures/agent-live-style-phrases.ts";
import type { AgentPhraseExpectation } from "../fixtures/agent-real-world-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

function aliasesFor(phrase: AgentPhrase): readonly string[] {
  return phrase.aliases ?? ["daniel", "blossom", "endurance"];
}

function withPayoutId(phrase: AgentPhrase): string {
  return phrase.phrase.replaceAll("<payout-id>", phrase.payoutId ?? STATUS_UUID);
}

function agentInput(phrase: AgentPhrase): AgentInput {
  const aliases = aliasesFor(phrase);
  const text = withPayoutId(phrase);
  return {
    surface: "telegram",
    chatId: "-100777",
    userId: "123456",
    messageId: 1,
    rawText: text,
    timestampIso: "2026-08-12T13:00:00.000Z",
    workspace: {
      id: "ws-1",
      mode: "community",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
      aliases,
      perTransactionLimitUsdc: "1.00",
      dailyLimitUsdc: "10.00",
      workspaceActive: true,
    },
    flags: { workspaceMode: "community", isMember: true },
    candidates: extractCandidates(text, aliases).candidates,
  };
}

async function makePlannerContext() {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: "Test WS",
    telegramChatId: "-100777",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
    perTransactionLimitBaseUnits: "1000000",
    dailyLimitBaseUnits: "10000000",
    approvalPolicy: "approval_required",
    status: "active",
  });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e", createdBy: "1" });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "blossom", walletAddress: "0x1234567890abcdef1234567890abcdef12345678", createdBy: "1" });
  await repo.addRecipient({ workspaceId: workspace.id, alias: "endurance", walletAddress: "0x234567890abcdef1234567890abcdef123456789", createdBy: "1" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  const member = await repo.getWorkspaceMember(workspace.id, "123456");
  return { repo, workspace, member };
}

const INTERPRETER_LEVEL: ReadonlySet<AgentPhraseExpectation> = new Set([
  "prepared_payment",
  "claim_link_created",
  "clarification",
  "unsupported",
  "blocked",
  "status_not_found",
]);

function interpreterIntentKind(expectation: AgentPhraseExpectation): AgentInterpretation["intentKind"] {
  switch (expectation) {
    case "prepared_payment":
      return "prepare_payment";
    case "claim_link_created":
      return "create_claim_link";
    case "clarification":
      return "clarify_missing_fields";
    case "unsupported":
    case "blocked":
      return "unsupported";
    case "status_not_found":
      return "inspect_payment_status";
    case "inert":
      throw new Error("inert phrases are not interpreter-level");
  }
}

function plannerDecisionMatches(decision: string, expectation: AgentPhraseExpectation): boolean {
  switch (expectation) {
    case "prepared_payment":
      return decision === "prepared_payment";
    case "claim_link_created":
      return decision === "prepared_claim_link";
    case "clarification":
      return decision === "ask_clarifying_question";
    case "unsupported":
      return decision === "unsupported" || decision === "blocked";
    case "blocked":
      return decision === "blocked";
    case "status_not_found":
      return decision === "status_not_found";
    case "inert":
      return false;
  }
}

describe("M9 live-style corpus — interpreter layer", () => {
  it("classifies every live-style phrase exactly as documented", () => {
    let checked = 0;
    for (const phrase of AGENT_LIVE_STYLE_PHRASES) {
      if (!INTERPRETER_LEVEL.has(phrase.expectation) || phrase.plannerOnly === true) continue;
      const result = interpretStatically(agentInput(phrase), extractCandidates(withPayoutId(phrase), aliasesFor(phrase)));
      const validation = validateAgentInterpretation(result);
      assert.equal(validation.ok, true, `${phrase.id}: ${validation.ok ? "" : validation.reason}`);
      const expectedKind = interpreterIntentKind(phrase.expectation);
      assert.equal(result.intentKind, expectedKind, `${phrase.id} "${phrase.phrase}" → ${result.intentKind}, expected ${expectedKind}`);
      if (phrase.expectation === "prepared_payment" && result.intentKind === "prepare_payment") {
        assert.equal(result.intent.amount !== null, true, `${phrase.id}: amount must be selected`);
        assert.equal(result.intent.recipient !== null, true, `${phrase.id}: recipient must be selected`);
      }
      checked += 1;
    }
    assert.ok(checked >= 50, `interpreter layer must cover at least 50 live phrases (covered ${checked})`);
  });

  it("supported payment memos are captured exactly as extracted", () => {
    for (const phrase of AGENT_LIVE_STYLE_PHRASES) {
      const text = withPayoutId(phrase);
      const result = interpretStatically(agentInput(phrase), extractCandidates(text, aliasesFor(phrase)));
      if (result.intentKind === "prepare_payment" && result.intent.memo !== null) {
        assert.equal(result.intent.memo, extractMemo(text), `${phrase.id}: memo mismatch`);
      }
    }
  });

  it("role/group language is never silently converted into a payment intent", () => {
    for (const phrase of AGENT_LIVE_STYLE_PHRASES) {
      if (phrase.expectation !== "unsupported" && phrase.expectation !== "clarification") continue;
      const result = interpretStatically(agentInput(phrase), extractCandidates(withPayoutId(phrase), aliasesFor(phrase)));
      const complete = result.intentKind === "prepare_payment" && result.intent.amount !== null && result.intent.recipient !== null;
      assert.equal(complete, false, `${phrase.id}: must not carry a complete payment intent`);
    }
  });
});

describe("M9 live-style corpus — planner layer", () => {
  it("plans every live-style phrase as documented with zero artifacts", async () => {
    const { repo, workspace, member } = await makePlannerContext();
    let checked = 0;
    for (const phrase of AGENT_LIVE_STYLE_PHRASES) {
      const text = withPayoutId(phrase);
      const extraction = extractCandidates(text, aliasesFor(phrase));
      const interpretation = interpretStatically(agentInput(phrase), extraction);
      const planner = new AgentPlanner({ repo, workspace, member, userId: "123456" });
      const decision = await planner.plan(extraction, interpretation);
      assert.equal(
        plannerDecisionMatches(decision.decision, phrase.expectation),
        true,
        `${phrase.id} "${phrase.phrase}" → ${decision.decision}, expected ${phrase.expectation}`,
      );
      assert.equal(repo.executionAttempts.size, 0, `${phrase.id}: no execution attempts`);
      checked += 1;
    }
    assert.ok(checked >= 60, `planner layer must cover at least 60 live phrases (covered ${checked})`);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, "planner creates nothing");
  });
});
