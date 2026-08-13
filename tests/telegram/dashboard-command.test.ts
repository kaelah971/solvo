import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { handleDashboardInstruction } from "../../src/server/telegram/flows/dashboard-flow.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { makeWorkspace, NOW, MEMBER, OUTSIDER, OWNER, APPROVER } from "../dashboard/fixtures.ts";

const APP_URL = "https://solvo.example";

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: OWNER,
    chatId: "-100777",
    chatType: "supergroup",
    messageId: 42,
    updateId: 1,
    ...overrides,
  };
}

async function makeCommunity(repo: MemoryRepository, mode: "community" | "judge" = "community"): Promise<string> {
  return makeWorkspace(repo, { mode });
}

describe("/dashboard command parsing", () => {
  it("parses /dashboard and rejects extra arguments", () => {
    assert.deepEqual(parseInstruction("/dashboard"), { kind: "dashboard" });
    const addressed = parseInstruction("/dashboard@SolvoAgentBot", { botUsername: "SolvoAgentBot" });
    assert.deepEqual(addressed, { kind: "dashboard" });
    const extra = parseInstruction("/dashboard now");
    assert.equal(extra.kind, "failure");
  });
});

describe("/dashboard Telegram flow", () => {
  it("active owner, approver, and member receive a one-time dashboard link", async () => {
    for (const [userId, role] of [
      [OWNER, "owner"],
      [APPROVER, "approver"],
      [MEMBER, "member"],
    ] as const) {
      const repo = new MemoryRepository();
      const workspaceId = await makeCommunity(repo);
      const reply = await handleDashboardInstruction(
        { user: user({ userId }) },
        { repo, now: () => new Date(NOW), appUrl: APP_URL },
      );
      assert.equal(reply.outcome, "link_issued", role);
      assert.match(reply.text, /OPEN YOUR DASHBOARD/);
      assert.match(reply.text, new RegExp(`${APP_URL.replace(".", "\\.")}\\/auth\\/telegram-link\\?token=`));
      assert.match(reply.text, /expires in 10 minutes and can be used once\./);
      assert.match(reply.text, /Valid until/);
      assert.equal(repo.dashboardLoginTokens.size, 1);
      const stored = [...repo.dashboardLoginTokens.values()][0];
      assert.equal(stored.workspace_id, workspaceId);
      assert.equal(stored.telegram_user_id, userId);
      assert.equal(stored.role, role);
      // The raw token appears in the reply but never in storage.
      assert.ok(!JSON.stringify(stored).includes(reply.text.split("token=")[1].trim()));
    }
  });

  it("denied shapes (private chat, nonmember, inactive, no workspace, judge mode) share one generic reply", async () => {
    const cases: Array<{ name: string; setup: (repo: MemoryRepository) => Promise<unknown>; userOverride: Partial<TelegramUser> }> = [
      { name: "private chat", setup: () => Promise.resolve(null), userOverride: { chatType: "private" } },
      { name: "nonmember", setup: (repo) => makeCommunity(repo), userOverride: { userId: OUTSIDER } },
      { name: "inactive member", setup: async (repo) => { const ws = await makeCommunity(repo); await repo.removeWorkspaceMember(ws, OWNER); return ws; }, userOverride: {} },
      { name: "no workspace for chat", setup: () => Promise.resolve(null), userOverride: { chatId: "-100999" } },
      { name: "judge mode", setup: (repo) => makeCommunity(repo, "judge"), userOverride: {} },
    ];

    let deniedText: string | null = null;
    for (const testCase of cases) {
      const repo = new MemoryRepository();
      await testCase.setup(repo);
      const reply = await handleDashboardInstruction(
        { user: user(testCase.userOverride) },
        { repo, now: () => new Date(NOW), appUrl: APP_URL },
      );
      assert.equal(reply.outcome, "unavailable", testCase.name);
      assert.equal(reply.text, "Dashboard unavailable. Ask a workspace owner to add you, then try /dashboard again.", testCase.name);
      if (deniedText === null) deniedText = reply.text;
      else assert.equal(reply.text, deniedText, "every denied shape must use identical copy");
      assert.equal(repo.dashboardLoginTokens.size, 0, testCase.name);
    }
  });

  it("the reply never leaks workspace or member ids", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeCommunity(repo);
    const reply = await handleDashboardInstruction(
      { user: user({ userId: MEMBER }) },
      { repo, now: () => new Date(NOW), appUrl: APP_URL },
    );
    assert.equal(reply.outcome, "link_issued");
    assert.ok(!reply.text.includes(workspaceId), "workspace id leaked");
    assert.ok(!reply.text.includes(MEMBER), "member id leaked");
    assert.ok(!reply.text.includes("member"), "no member references");
  });

  it("no payment, approval, or execution artifacts are created", async () => {
    const repo = new MemoryRepository();
    await makeCommunity(repo);
    await handleDashboardInstruction({ user: user() }, { repo, now: () => new Date(NOW), appUrl: APP_URL });
    assert.equal(repo.payouts.size, 0);
    assert.equal(repo.payoutItems.size, 0);
    assert.equal(repo.claimLinks.size, 0);
    assert.equal(repo.executionAttempts.size, 0);
    assert.equal(repo.agentRuns.size, 0);
    assert.ok(!repo.auditEvents.some((event) => event.event_type.startsWith("execution_")));
  });

  it("the raw token is never logged by the flow (no console output paths)", () => {
    const source = readFileSync("src/server/telegram/flows/dashboard-flow.ts", "utf8");
    assert.equal(source.includes("console.log"), false);
    assert.equal(source.includes("console.error"), false);
  });
});
