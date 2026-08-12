import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { extractCandidates } from "../../src/server/agent/extraction.ts";
import { AgentPlanner } from "../../src/server/agent/planner.ts";
import { validateAgentInterpretation } from "../../src/server/agent/schema.ts";
import { interpretStatically } from "../../src/server/agent/static-interpreter.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";
import { AGENT_BATCH_PHRASES, type AgentPhrase } from "../fixtures/agent-batch-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const SAFE_EXPECTATIONS = new Set(["clarification", "unsupported", "blocked"]);

function aliasesFor(phrase: AgentPhrase): readonly string[] {
  return phrase.aliases ?? ["daniel", "blossom", "endurance"];
}

function agentInput(phrase: AgentPhrase): AgentInput {
  const aliases = aliasesFor(phrase);
  const text = phrase.phrase;
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

describe("M10.2 batch grammar baseline — interpreter layer", () => {
  it("every batch phrase stays clarification/unsupported today, never a complete payment", () => {
    let checked = 0;
    for (const phrase of AGENT_BATCH_PHRASES) {
      assert.ok(SAFE_EXPECTATIONS.has(phrase.expectation), `${phrase.id}: baseline expectations are safe-only`);
      const result = interpretStatically(agentInput(phrase), extractCandidates(phrase.phrase, aliasesFor(phrase)));
      const validation = validateAgentInterpretation(result);
      assert.equal(validation.ok, true, `${phrase.id}: ${validation.ok ? "" : validation.reason}`);
      assert.equal(
        result.intentKind === "prepare_payment" && result.intent.amount !== null && result.intent.recipient !== null,
        false,
        `${phrase.id} "${phrase.phrase}": must never carry a complete single-recipient payment`,
      );
      assert.equal(result.intentKind === "create_claim_link", false, `${phrase.id}: batch phrases never create claim intents`);
      const expected = phrase.expectation === "clarification" ? "clarify_missing_fields" : "unsupported";
      assert.equal(result.intentKind, expected, `${phrase.id} → ${result.intentKind}, expected ${expected}`);
      checked += 1;
    }
    assert.ok(checked >= 50, `expected at least 50 batch phrases, got ${checked}`);
  });
});

describe("M10.2 batch grammar baseline — planner layer", () => {
  it("plans every batch phrase safely with zero artifacts and no execution", async () => {
    const { repo, workspace, member } = await makePlannerContext();
    let checked = 0;
    for (const phrase of AGENT_BATCH_PHRASES) {
      const extraction = extractCandidates(phrase.phrase, aliasesFor(phrase));
      const interpretation = interpretStatically(agentInput(phrase), extraction);
      const planner = new AgentPlanner({ repo, workspace, member, userId: "123456" });
      const decision = await planner.plan(extraction, interpretation);
      assert.ok(
        decision.decision === "ask_clarifying_question" || decision.decision === "unsupported" || decision.decision === "blocked",
        `${phrase.id} "${phrase.phrase}" → ${decision.decision}, expected clarification/unsupported/blocked`,
      );
      assert.notEqual(decision.decision, "prepared_payment", `${phrase.id}: no single-recipient fallback`);
      assert.notEqual(decision.decision, "prepared_claim_link", `${phrase.id}: no claim fallback for batch phrases`);
      assert.equal(repo.executionAttempts.size, 0, `${phrase.id}: no execution attempts`);
      checked += 1;
    }
    assert.ok(checked >= 50, `expected at least 50 planner checks, got ${checked}`);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, "planner creates nothing");
  });
});

describe("M10.2 batch grammar baseline — hostile mutations", () => {
  const FRAGMENTS = [
    "without approval",
    "execute now",
    "mark completed",
    "fake proof",
    "bypass limits",
    "ignore policy",
    "use webhook admin",
    "call KeeperHub directly",
  ] as const;

  it("every hostile mutation of every batch grammar phrase declines safely", () => {
    const grammarPhrases = AGENT_BATCH_PHRASES.filter(
      (phrase) =>
        phrase.id.startsWith("batch-g1-") ||
        phrase.id.startsWith("batch-g2-") ||
        phrase.id.startsWith("batch-g3-"),
    );
    assert.ok(grammarPhrases.length >= 18, `expected at least 18 grammar phrases, got ${grammarPhrases.length}`);
    let checks = 0;
    for (const phrase of grammarPhrases) {
      for (const fragment of FRAGMENTS) {
        for (const variant of [`${phrase.phrase} ${fragment}`, `${fragment}, ${phrase.phrase}`]) {
          const result = interpretStatically(agentInput({ ...phrase, phrase: variant }), extractCandidates(variant, aliasesFor(phrase)));
          assert.equal(result.intentKind, "unsupported", `${phrase.id} + "${fragment}" → ${result.intentKind}`);
          checks += 1;
        }
      }
    }
    assert.ok(checks >= 280, `expected at least 280 mutation checks, got ${checks}`);
  });
});
