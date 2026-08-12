import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { AGENT_LIVE_STYLE_PHRASES, type AgentPhrase } from "../fixtures/agent-live-style-phrases.ts";

const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

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

function phraseText(phrase: AgentPhrase): string {
  return phrase.phrase.replaceAll("<payout-id>", phrase.payoutId ?? STATUS_UUID);
}

async function assertNoExecution(repo: MemoryRepository): Promise<void> {
  assert.equal(repo.executionAttempts.size, 0);
  const types = repo.auditEvents.map((event) => event.event_type);
  assert.equal(types.includes("approval_granted"), false);
  assert.equal(types.some((type) => type.startsWith("simulation_")), false);
  assert.equal(types.some((type) => type.startsWith("execution_")), false);
  const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m1:agent");
  if (run) {
    assert.equal("transaction_hash" in run, false);
    assert.equal("keeperhub_execution_id" in run, false);
  }
}

describe("M9 live-style corpus — Telegram routing layer", () => {
  it("routes every live-style phrase to the documented safe outcome", async () => {
    let checked = 0;
    for (const phrase of AGENT_LIVE_STYLE_PHRASES) {
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
          if (items[0].memo !== null) {
            assert.match(reply.text, /memo/i, `${phrase.id}: memo should be echoed`);
          }
          break;
        }
        case "claim_link_created": {
          assert.match(reply.text, /no funds move/i, phrase.id);
          assert.ok(await repo.getClaimLinkByIdempotencyKey("ag:tg:-100777:m1:agent:claim"), phrase.id);
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
        case "inert":
          assert.fail(`${phrase.id}: live corpus has no inert phrases`);
      }
      await assertNoExecution(repo);
      checked += 1;
    }
    assert.ok(checked >= 60, `routing layer must cover at least 60 live phrases (covered ${checked})`);
  });
});
