import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { JudgeConfig } from "../../src/server/judge/config.ts";
import { handleStatusInstruction } from "../../src/server/telegram/flows/status-flow.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const JUDGE_ID = "123456789";
const OTHER_USER = "999999999";

const JUDGE_CONFIG: JudgeConfig = {
  enabled: true,
  judgeUserIds: new Set([JUDGE_ID]),
  perTxLimitBaseUnits: "100000",
  dailyLimitBaseUnits: "1000000",
  keeperhubJudgeIntegrationId: null,
};

async function createJudgePayout(repo: MemoryRepository, status: string, executionId: string | null, txHash: string | null) {
  const workspace = await repo.createWorkspace({
    mode: "judge",
    name: "Judge",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "auto_approve_within_judge_policy",
  });
  const payout = await repo.createPayout({
    workspaceId: workspace.id,
    requesterId: JUDGE_ID,
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

describe("judge status", () => {
  it("shows judge mode details for an authorized judge", async () => {
    const repo = new MemoryRepository();
    const { payout, item } = await createJudgePayout(
      repo,
      "completed",
      "judge-exec-1",
      "0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089",
    );
    void item;

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: JUDGE_ID,
      chatId: "-100123",
      judgeConfig: JUDGE_CONFIG,
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
  });

  it("does not leak judge payouts to non-judges", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(repo, "completed", "judge-exec-2", null);

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: OTHER_USER,
      chatId: "-100123",
      judgeConfig: JUDGE_CONFIG,
    });
    assert.equal(reply.found, false);
    assert.match(reply.text, /not found/i);
  });

  it("tells the judge execution_unknown will not be auto-retried", async () => {
    const repo = new MemoryRepository();
    const { payout } = await createJudgePayout(repo, "execution_unknown", "judge-exec-3", null);

    const reply = await handleStatusInstruction(payout.id, repo, {
      userId: JUDGE_ID,
      chatId: "-100123",
      judgeConfig: JUDGE_CONFIG,
    });
    assert.equal(reply.found, true);
    assert.match(reply.text, /EXECUTION_UNKNOWN/);
    assert.match(reply.text, /NOT automatically retry/i);
    assert.match(reply.text, /NO FUNDS MOVED/);
  });
});
