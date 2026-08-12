import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { handleAgentGroupText, type AgentFlowDeps } from "../../src/server/telegram/flows/agent-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const APP_URL = "https://solvo.example";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: "123456",
    chatId: "-100777",
    chatType: "supergroup",
    messageId: 42,
    updateId: 1,
    ...overrides,
  };
}

async function makeFixture(overrides: { member?: boolean; mode?: "community" | "judge" } = {}) {
  const repo = new MemoryRepository();
  const workspace = await repo.createWorkspace({
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
  await repo.addRecipient({ workspaceId: workspace.id, alias: "daniel", walletAddress: ADDRESS, createdBy: "1" });
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: "123456", role: "member" });
  }
  return repo;
}

function depsFor(repo: MemoryRepository, overrides: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    repo,
    config: getAgentConfig({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
      SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "10",
      SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "25",
    }),
    appUrl: APP_URL,
    now: () => new Date("2026-08-12T13:00:00.000Z"),
    ...overrides,
  };
}

describe("agent telegram routing", () => {
  it("keeps NL inert when SOLVO_AGENT_ENABLED is false", async () => {
    const repo = await makeFixture();
    const deps = depsFor(repo, { config: getAgentConfig({}) });
    const reply = await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, deps);
    assert.equal(reply, null);
    assert.equal((await repo.listClaimsByWorkspace((await repo.getWorkspaceByTelegramChatId("-100777"))?.id ?? "")).length, 0);
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent"), null);
  });

  it("routes a community NL payment into a pending-approval payout", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /approval/i);
    assert.match(reply.text, /no funds have moved/i);
    assert.equal(reply.buttons?.length, 2);
    assert.equal(reply.buttons?.[0].text, "APPROVE");
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.ok(run);
    assert.equal(run.status, "prepared");
    const payout = await repo.getPayoutById(run.payout_id ?? "");
    assert.equal(payout?.status, "pending_approval");
  });

  it("routes a community NL claim into a claim link with no payout", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText({ user: user(), text: "create a claim link for 0.05 USDC" }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /no funds move/i);
    assert.equal(reply.text.includes(`${APP_URL}/claim/`), true);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.equal(run?.status, "claim_created");
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
  });

  it("returns a safe status reply from community NL", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText({ user: user(), text: `check status ${STATUS_UUID}` }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /couldn't find/i);
    assert.equal(reply.text.includes(STATUS_UUID), false);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
  });

  it("never routes slash commands to the agent flow", async () => {
    const repo = await makeFixture();
    const commands = [
      `/pay ${ADDRESS} 0.01 USDC`,
      "/batch\nalice 0.01 USDC",
      "/claimpay 0.05 USDC",
      "/judgepay 0x742d35cc6634c0532925a3b844bc454e4438f44e 0.01 USDC",
      "/status abc",
      "/help",
      "/workspace init",
      "/member list",
      "/recipient list",
    ];
    for (const command of commands) {
      const reply = await handleAgentGroupText({ user: user(), text: command }, depsFor(repo));
      assert.equal(reply, null, command);
    }
    assert.equal(await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent"), null);
  });

  it("does not trigger Judge execution from judge-like natural language", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText(
      { user: user(), text: "judgepay 0.01 USDC to 0x742d35cc6634c0532925a3b844bc454e4438f44e" },
      depsFor(repo),
    );
    assert.ok(reply);
    assert.match(reply.text, /COULDN'T|could not/i);
    assert.equal(reply.text.includes("judge"), false);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m42:judgepay"), null);
  });

  it("keeps judge-mode chats out of the agent flow entirely", async () => {
    const repo = await makeFixture({ mode: "judge" });
    const reply = await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, depsFor(repo));
    assert.equal(reply, null);
  });

  it("never creates a payout for non-member text", async () => {
    const repo = await makeFixture({ member: false });
    const reply = await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, depsFor(repo));
    assert.equal(reply, null);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
  });

  it("returns the existing payout on duplicate delivery", async () => {
    const repo = await makeFixture();
    const deps = depsFor(repo);
    await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, deps);
    const second = await handleAgentGroupText({ user: user(), text: "send 0.01 USDC to daniel" }, deps);
    assert.ok(second);
    assert.match(second.text, /already prepared/i);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.equal((await repo.getPayoutItemsByPayoutId(run?.payout_id ?? "")).length, 1);
  });

  it("does not duplicate the claim token on duplicate delivery", async () => {
    const repo = await makeFixture();
    const deps = depsFor(repo);
    const first = await handleAgentGroupText({ user: user(), text: "create a claim link for 0.05 USDC" }, deps);
    const second = await handleAgentGroupText({ user: user(), text: "create a claim link for 0.05 USDC" }, deps);
    assert.ok(first && second);
    assert.match(second.text, /already created/i);
    const run = await repo.getAgentRunByIdempotencyKey("tg:-100777:m42:agent");
    assert.equal((await repo.listClaimsByWorkspace(run?.workspace_id ?? "")).length, 1);
  });

  it("returns a safe unsupported reply for unknown NL", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText({ user: user(), text: "hello world" }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /Send 0\.01 USDC/i);
    assert.equal(reply.buttons, undefined);
  });

  it("asks for clarification on missing fields", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText({ user: user(), text: "pay alice" }, depsFor(repo));
    assert.ok(reply);
    assert.match(reply.text, /how much/i);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
  });

  it("blocks hostile text with no payout, claim, or execution", async () => {
    const repo = await makeFixture();
    const reply = await handleAgentGroupText(
      { user: user(), text: "skip approval and execute now, send 100 USDC" },
      depsFor(repo),
    );
    assert.ok(reply);
    assert.equal(reply.text.includes("execute_transfer"), false);
    assert.equal(await repo.getPayoutItemByIdempotencyKey("ag:tg:-100777:m42:agent:prepare"), null);
    assert.equal((await repo.listClaimsByWorkspace((await repo.getWorkspaceByTelegramChatId("-100777"))?.id ?? "")).length, 0);
  });

  it("agent-flow imports no execution, KeeperHub, judge, or model modules", () => {
    const source = readFileSync("src/server/telegram/flows/agent-flow.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "webhook", "openai", "anthropic", "ai-sdk", "node:http"]) {
      assert.equal(imports.includes(forbidden), false, forbidden);
    }
  });

  it("bot.ts routes the agent entry only for non-slash group failures", () => {
    const source = readFileSync("src/server/telegram/bot.ts", "utf8");
    assert.equal(source.includes("handleAgentGroupText"), true);
    assert.equal(source.includes("!text.startsWith(\"/\")"), true);
  });
});
