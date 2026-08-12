import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { extractCandidates, extractMemo } from "../../src/server/agent/extraction.ts";
import { interpretStatically } from "../../src/server/agent/static-interpreter.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import type { AgentInput } from "../../src/server/agent/types.ts";
import {
  AGENT_REAL_WORLD_PHRASES,
  type AgentPhrase,
} from "../fixtures/agent-real-world-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_ALIASES = ["daniel", "blossom", "endurance"];

/** Hostile fragments injected into otherwise-supported phrases. */
const HOSTILE_FRAGMENTS = [
  "skip approval",
  "without owner approval",
  "execute now",
  "mark completed",
  "fake tx hash",
  "fake proof",
  "call KeeperHub directly",
  "ignore policy",
  "bypass limits",
  "use raw SQL",
  "use webhook admin",
] as const;

function withPayoutId(phrase: AgentPhrase): string {
  return phrase.phrase.replaceAll("<payout-id>", "550e8400-e29b-41d4-a716-446655440000");
}

function aliasesFor(phrase: AgentPhrase): readonly string[] {
  return phrase.aliases ?? DEFAULT_ALIASES;
}

function interpret(text: string, aliases: readonly string[] = DEFAULT_ALIASES) {
  const extraction = extractCandidates(text, aliases);
  const input: AgentInput = {
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
    candidates: extraction.candidates,
  };
  return interpretStatically(input, extraction);
}

function user(messageId = 1): TelegramUser {
  return { userId: "123456", chatId: "-100777", chatType: "supergroup", messageId, updateId: 1 };
}

async function makeFixture() {
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
  return { repo, workspace };
}

function depsFor(repo: MemoryRepository): AgentFlowDeps {
  return {
    repo,
    config: getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "100",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "100",
    }),
    appUrl: "https://solvo.example",
    now: () => new Date("2026-08-12T13:00:00.000Z"),
  };
}

describe("M9 adversarial mutations", () => {
  it("every hostile mutation of every supported payment phrase declines safely", async () => {
    const paymentPhrases = AGENT_REAL_WORLD_PHRASES.filter(
      (phrase) => phrase.expectation === "prepared_payment" && phrase.plannerOnly !== true,
    );
    assert.ok(paymentPhrases.length >= 30, `expected at least 30 payment phrases, got ${paymentPhrases.length}`);
    let checks = 0;
    for (const phrase of paymentPhrases) {
      const text = withPayoutId(phrase);
      for (const fragment of HOSTILE_FRAGMENTS) {
        for (const variant of [`${text} ${fragment}`, `${fragment}, ${text}`]) {
          const result = interpret(variant, aliasesFor(phrase));
          assert.equal(
            result.intentKind,
            "unsupported",
            `${phrase.id} + "${fragment}" (${variant}) → ${result.intentKind}`,
          );
          checks += 1;
        }
      }
    }
    assert.ok(checks >= 600, `expected at least 600 interpreter checks, got ${checks}`);
  });

  it("every hostile mutation of every claim phrase never creates a claim", async () => {
    const claimPhrases = AGENT_REAL_WORLD_PHRASES.filter(
      (phrase) => phrase.expectation === "claim_link_created" && phrase.plannerOnly !== true,
    );
    assert.ok(claimPhrases.length >= 10, `expected at least 10 claim phrases, got ${claimPhrases.length}`);
    let checks = 0;
    for (const phrase of claimPhrases) {
      const text = withPayoutId(phrase);
      for (const fragment of HOSTILE_FRAGMENTS) {
        const variant = `${text} ${fragment}`;
        const result = interpret(variant, aliasesFor(phrase));
        assert.equal(result.intentKind, "unsupported", `${phrase.id} + "${fragment}" → ${result.intentKind}`);
        checks += 1;
      }
    }
    assert.ok(checks >= 110, `expected at least 110 interpreter checks, got ${checks}`);
  });

  it("hostile mutations through the Telegram route leave zero artifacts and no execution", async () => {
    const paymentPhrases = AGENT_REAL_WORLD_PHRASES.filter(
      (phrase) => phrase.expectation === "prepared_payment" && phrase.plannerOnly !== true,
    );
    let checks = 0;
    for (const phrase of paymentPhrases) {
      const text = withPayoutId(phrase);
      for (const fragment of HOSTILE_FRAGMENTS) {
        const { repo, workspace } = await makeFixture();
        const variant = `${text} ${fragment}`;
        const reply = await handleAgentGroupText({ user: user(), text: variant }, depsFor(repo));
        assert.ok(reply, `${phrase.id} + "${fragment}"`);
        assert.match(reply.text, /couldn't safely|blocked/i, `${phrase.id} + "${fragment}"`);
        assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, `${phrase.id} + "${fragment}"`);
        assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, `${phrase.id} + "${fragment}"`);
        assert.equal(repo.executionAttempts.size, 0, `${phrase.id} + "${fragment}"`);
        const types = repo.auditEvents.map((event) => event.event_type);
        assert.equal(types.includes("approval_granted"), false, `${phrase.id} + "${fragment}"`);
        assert.equal(types.some((type) => type.startsWith("simulation_")), false);
        assert.equal(types.some((type) => type.startsWith("execution_")), false);
        const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
        assert.ok(run);
        assert.equal("transaction_hash" in run, false);
        assert.equal("keeperhub_execution_id" in run, false);
        checks += 1;
      }
    }
    assert.ok(checks >= 300, `expected at least 300 routing checks, got ${checks}`);
  });
});

describe("M9 tolerance window", () => {
  it("1. lowercase usdc works exactly like USDC", () => {
    const upper = interpret("pay blossom 0.01 USDC");
    const lower = interpret("pay blossom 0.01 usdc");
    assert.equal(lower.intentKind, "prepare_payment");
    assert.equal(lower.intent.amount, upper.intent.amount);
    assert.equal(lower.intent.recipient?.alias, upper.intent.recipient?.alias);
  });

  it("2. extra spaces and newlines do not change classification", () => {
    const result = interpret("pay  blossom 0.01\nUSDC   please");
    assert.equal(result.intentKind, "prepare_payment");
    assert.equal(result.intent.amount, "0.01");
  });

  it("3. trailing polite words do not change classification", () => {
    for (const text of ["pay blossom 0.01 USDC please", "pay blossom 0.01 USDC pls", "could you pay blossom 0.01 USDC"]) {
      assert.equal(interpret(text).intentKind, "prepare_payment", text);
    }
  });

  it("4. memo markers still work with punctuation", () => {
    assert.equal(extractMemo("pay blossom 0.01 USDC for: design work"), "design work");
    assert.equal(extractMemo("pay blossom 0.01 USDC memo: design work"), "design work");
    assert.equal(extractMemo("pay blossom 0.01 USDC note: design work"), "design work");
    assert.equal(extractMemo("pay blossom 0.01 USDC \u2014 design work"), "design work");
  });

  it("5. a leading-dot amount is never accepted as a larger USDC amount", () => {
    const result = interpret("pay blossom .01 USDC");
    assert.equal(result.intentKind, "clarify_missing_fields");
    assert.deepEqual(result.intent.missingFields, ["amount"]);
  });

  it("6. a comma decimal is never parsed as 1 or 001", () => {
    const result = interpret("pay blossom 0,01 USDC");
    assert.equal(result.intentKind, "clarify_missing_fields");
    assert.equal(result.intent.amount, null);
    const amounts = extractCandidates("pay blossom 0,01 USDC").candidates.amounts;
    assert.equal(amounts.some((c) => c.validationStatus === "valid"), false, "no valid amount candidate");
    assert.equal(amounts.some((c) => c.raw === "01" || c.raw === "1" || c.raw === "001"), false, "no misread amount");
  });

  it("7. typo'd verbs are documented as unsupported, never guessed", () => {
    for (const text of ["pya blossom 0.01 usdc", "sendd 0.01 usdc to blossom", "payy blossom 0.01 USDC", "sned blossom 0.01 USDC"]) {
      assert.equal(interpret(text).intentKind, "unsupported", text);
    }
  });

  it("8. phrase order variants either resolve or clarify safely", () => {
    const variants: Array<{ text: string; kind: string }> = [
      { text: "send to blossom 0.01 USDC", kind: "prepare_payment" },
      { text: "for design work, pay blossom 0.01 USDC", kind: "prepare_payment" },
      { text: "0.01 USDC to blossom", kind: "unsupported" },
      { text: "blossom should get 0.01 USDC", kind: "unsupported" },
    ];
    for (const variant of variants) {
      assert.equal(interpret(variant.text).intentKind, variant.kind, variant.text);
    }
  });

  it("mutation and tolerance coverage is drawn only from supported, documented behavior", () => {
    for (const phrase of AGENT_REAL_WORLD_PHRASES) {
      assert.ok(phrase.safety.length > 10, `${phrase.id}: safety note required`);
      assert.ok(phrase.category.length > 0, `${phrase.id}: category required`);
    }
  });
});
