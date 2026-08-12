import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { JudgeConfig } from "../../src/server/judge/config.ts";
import { handleStatusInstruction } from "../../src/server/telegram/flows/status-flow.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const OWNER_USER = "123456789";
const OTHER_USER = "999999999";
const ADMIN_USER = "555555555";

const PUBLIC_CONFIG: JudgeConfig = {
  enabled: true,
  adminUserIds: new Set(),
  perTxLimitBaseUnits: "10000",
  dailyLimitBaseUnits: "250000",
  lifetimeLimitBaseUnits: "1000000",
  maxSuccessfulPaymentsPerUser: 1,
  keeperhubJudgeIntegrationId: null,
};

const ADMIN_CONFIG: JudgeConfig = {
  ...PUBLIC_CONFIG,
  adminUserIds: new Set([ADMIN_USER]),
};

async function createJudgePayout(
  repo: MemoryRepository,
  status: string,
  executionId: string | null,
  txHash: string | null,
  requesterId = OWNER_USER,
) {
  const workspace = await repo.createWorkspace({
    mode: "judge",
    name: "Judge",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "10000",
    dailyLimitBaseUnits: "250000",
    approvalPolicy: "auto_approve_within_judge_policy",
  });
  const payout = await repo.createPayout({
    workspaceId: workspace.id,
    requesterId,
    sourceType: "judge_telegram",
    status: status as never,
    totalAmountBaseUnits: "10000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: "10000",
    memo: "judge payment",
    status: status as never,
    idempotencyKey: "judge-status-" + Math.random().toString(36).slice(2),
  });
  if (executionId) {
    await repo.setPayoutItemKeeperHubExecution(item.id, executionId);
  }
  if (txHash) {
    await repo.completePayoutItem(item.id, txHash, `https://basescan.org/tx/${txHash}`);
  }
  return { workspace, payout, item };
}

describe("judge status (M6.1 public)", () => {
  it("shows the caller's own completed judge payout", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(
      repo,
      "completed",
      "judge-exec-1",
      "0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089",
    );

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: OWNER_USER,
      chatId: "-100123",
      judgeConfig: PUBLIC_CONFIG,
    });
    assert.equal(reply.found, true);
    assert.match(reply.text, /JUDGE MODE/);
    assert.match(reply.text, /STATE\s+COMPLETED/);
    assert.match(reply.text, /0\.01 USDC/);
    assert.match(reply.text, new RegExp(RECIPIENT));
    assert.match(reply.text, /judge-exec-1/);
    assert.match(reply.text, /BASESCAN\s+https:\/\/basescan\.org\/tx\//);
    assert.match(reply.text, /FUNDS\s+MOVED ON BASE/);
    assert.match(reply.text, /DAILY SPEND/);
    assert.match(reply.text, /LIFETIME/);
    assert.match(reply.text, /MY PAYMENTS\s+1 \/ 1/);
  });

  it("does not leak another user's judge payout", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(repo, "completed", "judge-exec-2", null);

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: OTHER_USER,
      chatId: "-100123",
      judgeConfig: PUBLIC_CONFIG,
    });
    assert.equal(reply.found, false);
    assert.match(reply.text, /not found/i);
  });

  it("lets an admin inspect any judge payout", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(repo, "completed", "judge-exec-4", null, OTHER_USER);

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: ADMIN_USER,
      chatId: "-100123",
      judgeConfig: ADMIN_CONFIG,
    });
    assert.equal(reply.found, true);
    assert.match(reply.text, /JUDGE MODE/);
  });

  it("tells the owner execution_unknown will not be auto-retried", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(repo, "execution_unknown", "judge-exec-3", null);

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: OWNER_USER,
      chatId: "-100123",
      judgeConfig: PUBLIC_CONFIG,
    });
    assert.equal(reply.found, true);
    assert.match(reply.text, /EXECUTION_UNKNOWN/);
    assert.match(reply.text, /NOT automatically retry/i);
    assert.match(reply.text, /NO FUNDS MOVED/);
  });
});
