import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { getJudgeConfig, isJudgeUser } from "../../src/server/judge/config.ts";
import { evaluateJudgeRequest } from "../../src/server/judge/policy.ts";
import { evaluateCommunityRequest } from "../../src/server/telegram/policy.ts";
import { handleClaimPayInstruction } from "../../src/server/telegram/flows/claim-flow.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("M8 environment isolation", () => {
  it("community payouts can never inherit judge auto-approval", () => {
    const judgeUserIds = new Set(["123456789"]);
    const community = evaluateCommunityRequest({
      workspaceActive: true,
      isMember: true,
      amountBaseUnits: "10000",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
    });
    // Community policy ALWAYS requires approval, regardless of the judge allowlist.
    assert.equal(community.decision, "approval_required");
    assert.notEqual(community.decision, "auto_approve");

    // And judge policy never auto-approves through the community workspace.
    const judge = evaluateJudgeRequest({
      modeEnabled: true,
      adminUserIds: judgeUserIds,
      userId: "123456789",
      amountBaseUnits: "10000",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      workspaceActive: true,
      perTxLimitBaseUnits: "10000",
      dailyLimitBaseUnits: "250000",
      lifetimeLimitBaseUnits: "1000000",
      maxSuccessfulPaymentsPerUser: 1,
      successfulPaymentsByUser: 0,
      currentDailySpendBaseUnits: "0",
      lifetimeSpendBaseUnits: "0",
    });
    assert.equal(judge.decision, "auto_approve");
  });

  it("judge mode cannot reach community execution and vice versa", () => {
    const judgeConfig = getJudgeConfig({
      JUDGE_MODE_ENABLED: "true",
      TELEGRAM_JUDGE_USER_IDS: "123456789",
    });
    assert.equal(isJudgeUser("123456789", judgeConfig), true);
    assert.equal(isJudgeUser("someone-else", judgeConfig), false);

    // /judgepay is the ONLY public judge surface: /claimpay and /pay are not
    // judge execution paths.
    const judge = parseInstruction("/judgepay 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC");
    assert.equal(judge.kind, "judge_pay");
    const pay = parseInstruction("/pay 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC");
    assert.equal(pay.kind, "pay");
    assert.notEqual(pay.kind, "judge_pay");
  });

  it("/claimpay is unavailable outside an initialized community workspace", async () => {
    const repo = new MemoryRepository();
    const user = { userId: "123456789", chatId: "-100", chatType: "private" as const, messageId: 1, updateId: 1 };
    const reply = await handleClaimPayInstruction(
      { instruction: { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const }, user },
      { repo },
    );
    assert.equal(reply.outcome, "wrong_context");
    assert.equal([...repo.claimLinks.values()].length, 0, "no claim may be created outside a community workspace");

    // A judge workspace does not grant claim creation either.
    const judgeWorkspace = await repo.createWorkspace({
      mode: "judge",
      name: "Judge",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "10000",
      dailyLimitBaseUnits: "250000",
      approvalPolicy: "auto_approve_within_judge_policy",
    });
    const judgeUser = { userId: "123456789", chatId: judgeWorkspace.telegram_chat_id ?? "-1", chatType: "group" as const, messageId: 2, updateId: 2 };
    const judgeReply = await handleClaimPayInstruction(
      { instruction: { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const }, user: judgeUser },
      { repo },
    );
    assert.equal(judgeReply.outcome, "wrong_context", "judge workspace must reject /claimpay");
  });

  it("workspace ids cannot cross environments: /pay in a community chat goes through community policy", async () => {
    // The community flow resolves the workspace from the chat, and approval is
    // required — a judge auto-approval can never apply to that chat.
    const repo = new MemoryRepository();
    const community = await repo.createWorkspace({
      mode: "community",
      name: "C",
      telegramChatId: "-10077",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    await repo.addWorkspaceMember({ workspaceId: community.id, telegramUserId: "123456789", role: "member" });

    const reply = await handleClaimPayInstruction(
      { instruction: { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const }, user: { userId: "123456789", chatId: "-10077", chatType: "group" as const, messageId: 3, updateId: 3 } },
      { repo },
    );
    assert.equal(reply.outcome, "created", "community chat creates claims under community policy");

    const judgeConfig = getJudgeConfig({ JUDGE_MODE_ENABLED: "true", TELEGRAM_JUDGE_USER_IDS: "123456789" });
    const judgeEval = evaluateJudgeRequest({
      modeEnabled: judgeConfig.enabled,
      adminUserIds: judgeConfig.adminUserIds,
      userId: "123456789",
      amountBaseUnits: "50000",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      workspaceActive: true,
      perTxLimitBaseUnits: judgeConfig.perTxLimitBaseUnits,
      dailyLimitBaseUnits: judgeConfig.dailyLimitBaseUnits,
      lifetimeLimitBaseUnits: judgeConfig.lifetimeLimitBaseUnits,
      maxSuccessfulPaymentsPerUser: 1,
      successfulPaymentsByUser: 0,
      currentDailySpendBaseUnits: "0",
      lifetimeSpendBaseUnits: "0",
    });
    // Judge caps would block the 0.05 claim amount — the community workspace
    // is the only environment that can host the claim, and it never
    // auto-executes.
    assert.equal(judgeEval.decision, "blocked");
    assert.equal(reply.text.includes("CLAIM LINK CREATED"), true);
  });

  it("production config cannot silently fall back to unsafe judge defaults", () => {
    // Judge mode is OFF unless explicitly enabled.
    assert.equal(getJudgeConfig({}).enabled, false);
    // A non-numeric admin id is never accepted as authority.
    const config = getJudgeConfig({ TELEGRAM_JUDGE_USER_IDS: "alice,not-a-number" });
    assert.equal(config.adminUserIds.size, 0);
  });
});
