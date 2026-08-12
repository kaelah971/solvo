import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import {
  AGENT_REAL_WORLD_PHRASES,
  type AgentPhrase,
} from "../fixtures/agent-real-world-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: "123456",
    chatId: "-100777",
    chatType: "supergroup",
    messageId: 1,
    updateId: 1,
    ...overrides,
  };
}

async function makeFixture(overrides: { member?: boolean; mode?: "community" | "judge"; chatId?: string | null } = {}) {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
    mode: overrides.mode ?? "community",
    name: "Test WS",
    telegramChatId: overrides.chatId ?? "-100777",
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
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  }
  return { repo, workspace };
}

function depsFor(repo: MemoryRepository, overrides: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
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
    ...overrides,
  };
}

function phraseText(phrase: AgentPhrase): string {
  return phrase.phrase.replaceAll("<payout-id>", phrase.payoutId ?? STATUS_UUID);
}

async function assertNoExecution(repo: MemoryRepository, messageId = 1): Promise<void> {
  assert.equal(repo.executionAttempts.size, 0);
  const types = repo.auditEvents.map((event) => event.event_type);
  assert.equal(types.includes("approval_granted"), false);
  assert.equal(types.some((type) => type.startsWith("simulation_")), false);
  assert.equal(types.some((type) => type.startsWith("execution_")), false);
  const run = await repo.getAgentRunByIdempotencyKey(`tg:-100777:m${messageId}:agent`);
  if (run) {
    assert.equal("transaction_hash" in run, false);
    assert.equal("keeperhub_execution_id" in run, false);
  }
}

describe("M9 real-world corpus — Telegram routing layer", () => {
  it("routes every non-inert corpus phrase to the documented safe outcome", async () => {
    let checked = 0;
    for (const phrase of AGENT_REAL_WORLD_PHRASES) {
      if (phrase.expectation === "inert") continue;
      const { repo, workspace } = await makeFixture();
      const reply = await handleAgentGroupText({ user: user(), text: phraseText(phrase) }, depsFor(repo));
      assert.ok(reply, `${phrase.id}: expected a reply`);

      switch (phrase.expectation) {
        case "prepared_payment": {
          assert.match(reply.text, /approval/i, phrase.id);
          assert.match(reply.text, /no funds have moved/i, phrase.id);
          const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
          assert.ok(run, phrase.id);
          const payout = await repo.getPayoutById(run.payout_id ?? "");
          assert.equal(payout?.status, "pending_approval", phrase.id);
          assert.equal(payout?.approved_at, null, phrase.id);
          assert.equal(payout?.completed_at, null, phrase.id);
          const items = await repo.getPayoutItemsByPayoutId(payout?.id ?? "");
          assert.equal(items.length, 1, phrase.id);
          assert.equal(items[0].status, "pending_approval", phrase.id);
          break;
        }
        case "claim_link_created": {
          assert.match(reply.text, /no funds move/i, phrase.id);
          assert.ok(await repo.getClaimLinkByIdempotencyKey("ag:tg:-100777:m1:agent:claim"), phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 1, phrase.id);
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          break;
        }
        case "clarification": {
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, phrase.id);
          break;
        }
        case "unsupported": {
          assert.match(reply.text, /couldn't safely|blocked/i, phrase.id);
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, phrase.id);
          break;
        }
        case "blocked": {
          assert.match(reply.text, /blocked/i, phrase.id);
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, phrase.id);
          break;
        }
        case "status_not_found": {
          assert.match(reply.text, /couldn't find/i, phrase.id);
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, phrase.id);
          break;
        }
        case "batch_parsed": {
          assert.match(reply.text, /couldn't safely|blocked|one more detail/i, phrase.id);
          assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null, phrase.id);
          assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 0, phrase.id);
          break;
        }
      }
      await assertNoExecution(repo);
      checked += 1;
    }
    assert.ok(checked >= 75, `routing layer must cover at least 75 phrases (covered ${checked})`);
  });

  it("slash commands always bypass the agent flow", async () => {
    for (const phrase of AGENT_REAL_WORLD_PHRASES) {
      if (phrase.category !== "slash_command") continue;
      const { repo } = await makeFixture();
      const reply = await handleAgentGroupText({ user: user(), text: phraseText(phrase) }, depsFor(repo));
      assert.equal(reply, null, phrase.id);
      assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"), null, phrase.id);
    }
  });

  it("DM chats, non-members, judge chats, and disabled config stay inert", async () => {
    const dm = await makeFixture();
    assert.equal(
      await handleAgentGroupText({ user: user({ chatId: "999999999" }), text: "send 0.01 USDC to blossom" }, depsFor(dm.repo)),
      null,
      "DM chat",
    );
    assert.equal(await dm.repo.getAgentRunByIdempotencyKey("tg:999999999:m1:agent"), null);

    const noMember = await makeFixture({ member: false });
    assert.equal(
      await handleAgentGroupText({ user: user(), text: "pay blossom 0.01 USDC" }, depsFor(noMember.repo)),
      null,
      "non-member",
    );
    assert.equal(await noMember.repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m1:agent:prepare"), null);

    const judgeChat = await makeFixture({ mode: "judge" });
    assert.equal(
      await handleAgentGroupText({ user: user(), text: "send 0.01 USDC" }, depsFor(judgeChat.repo)),
      null,
      "judge chat",
    );
    assert.equal(await judgeChat.repo.getPayoutItemByIdempotencyKey("tg:-100777:m1:judgepay"), null);

    const disabled = await makeFixture();
    const disabledDeps = depsFor(disabled.repo, { config: getAgentConfig({}) });
    assert.equal(
      await handleAgentGroupText({ user: user(), text: "pay blossom 0.01 USDC" }, disabledDeps),
      null,
      "disabled config",
    );
    assert.equal(await disabled.repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent"), null);
  });
});
