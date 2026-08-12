import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import type { SolvoDirectExecutionStatus } from "../../src/server/keeperhub/types.ts";
import { handleApprovalCallbackUpdate } from "../../src/server/telegram/flows/approval-orchestration.ts";
import { handleClaimApprovalCallbackUpdate } from "../../src/server/telegram/flows/claim-approval-orchestration.ts";
import { handlePayInstruction } from "../../src/server/telegram/flows/pay-flow.ts";
import { handleCommunityBatchInstruction } from "../../src/server/telegram/flows/community-batch-flow.ts";
import { handleClaimPayInstruction } from "../../src/server/telegram/flows/claim-flow.ts";
import { claimExpiresAtIso, submitClaimRecipient } from "../../src/server/claim/service.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway, completedStatus } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const MEMBER = "123456789";
const APPROVER_1 = "987654321";
const APPROVER_2 = "555555555";

/**
 * Controlled synchronization: gates the KeeperHub execute call so tests can
 * prove that two flows are genuinely overlapping when they both reach the
 * execution boundary.
 */
class GatedGateway extends FakeGateway {
  private barrier: Promise<void>;
  private open: (() => void) | null = null;

  constructor(script: ConstructorParameters<typeof FakeGateway>[0] = {}) {
    super(script);
    this.barrier = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open?.();
  }

  override async executeTransfer(): Promise<SolvoDirectExecutionStatus> {
    this.executeCalls += 1;
    await this.barrier;
    return completedStatus("gated-exec");
  }
}

type Messenger = {
  answers: string[];
  edits: string[];
  answer: (text: string) => Promise<void>;
  edit: (text: string) => Promise<void>;
  reply: (text: string) => Promise<void>;
};

function messenger(): Messenger {
  const answers: string[] = [];
  const edits: string[] = [];
  return {
    answers,
    edits,
    answer: async (text: string) => {
      answers.push(text);
    },
    edit: async (text: string) => {
      edits.push(text);
    },
    reply: async (text: string) => {
      edits.push(text);
    },
  };
}

async function makeCommunityWorkspace(repo: SolvoRepository, chatId = "-100555") {
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: "M8 Guild",
    telegramChatId: chatId,
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER_1, role: "approver" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER_2, role: "approver" });
  return workspace;
}

async function createPendingPayout(repo: SolvoRepository, workspaceId: string, requester = MEMBER, keySuffix = Math.random().toString(36).slice(2)) {
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: requester,
    sourceType: "telegram_command",
    status: "pending_approval",
    totalAmountBaseUnits: "10000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: RECIPIENT,
    amountBaseUnits: "10000",
    memo: null,
    status: "pending_approval",
    idempotencyKey: `m8-payout-${keySuffix}`,
  });
  return { payout, item };
}

function memberUser(chatId = "-100555", messageId = 200): TelegramUser {
  return { userId: MEMBER, chatId, chatType: "group", messageId, updateId: 1 };
}

describe("M8 duplicate-execution attack matrix (memory-level)", () => {
  it("A: the same approval callback delivered twice sequentially executes once", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const { payout } = await createPendingPayout(repo, workspace.id);
    const gateway = new FakeGateway({});

    for (let i = 0; i < 2; i += 1) {
      const m = messenger();
      await handleApprovalCallbackUpdate(
        { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
        { repo, gateway },
        m,
      );
    }
    assert.equal(gateway.executeCalls, 1);
    const item = (await repo.getPayoutItemsByPayoutId(payout.id))[0];
    assert.equal(item?.status, "completed");
  });

  it("B: the same callback delivered concurrently executes once", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const { payout } = await createPendingPayout(repo, workspace.id);
    const gateway = new GatedGateway({});

    const first = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    const second = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_2, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    // Give both flows time to reach the execution boundary, then release.
    await new Promise((resolve) => setTimeout(resolve, 30));
    gateway.release();
    await Promise.all([first, second]);

    assert.equal(gateway.executeCalls, 1, "concurrent duplicate approval must execute exactly once");
    const item = (await repo.getPayoutItemsByPayoutId(payout.id))[0];
    assert.equal(item?.status, "completed");
  });

  it("C: two different approvers approve the same payout concurrently — one winner", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const { payout } = await createPendingPayout(repo, workspace.id);
    const gateway = new GatedGateway({});

    const first = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    const second = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_2, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    gateway.release();
    await Promise.all([first, second]);

    const item = (await repo.getPayoutItemsByPayoutId(payout.id))[0];
    assert.equal(item?.status, "completed");
    assert.equal(gateway.executeCalls, 1);
    const approvals = repo.auditEvents.filter((e) => e.event_type === "approval_granted" && e.payout_id === payout.id);
    assert.equal(approvals.length, 1, "exactly one approval_granted audit event");
  });

  it("D: approving again after execution completed never re-executes", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const { payout } = await createPendingPayout(repo, workspace.id);
    const gateway = new FakeGateway({});

    await handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    const after = await handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    void after;
    assert.equal(gateway.executeCalls, 1);
  });

  it("E: retry while execution is in progress reconciles, never rebroadcasts", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const { payout } = await createPendingPayout(repo, workspace.id);
    const gateway = new GatedGateway({});

    const first = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Second callback while the first execution is still in flight.
    const second = handleApprovalCallbackUpdate(
      { action: "approve", payoutId: payout.id, actorUserId: APPROVER_1, chatId: "-100555" },
      { repo, gateway },
      messenger(),
    );
    gateway.release();
    await Promise.all([first, second]);

    assert.equal(gateway.executeCalls, 1);
  });

  it("F/G: duplicate /pay delivery (same chat+message) creates ONE payout and executes once", async () => {
    const repo = new MemoryRepository();
    await repo.createWorkspace({
      mode: "sandbox",
      name: "Sandbox",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "auto",
    });
    const user = { userId: "111222333", chatId: "-100", chatType: "private" as const, messageId: 42, updateId: 1 };
    const gateway = new FakeGateway({});
    const instruction = { kind: "pay" as const, address: RECIPIENT, amount: "0.01", token: "USDC" as const, sourceType: "telegram_command" as const };

    const first = await handlePayInstruction(
      { instruction, user, mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );
    const second = await handlePayInstruction(
      { instruction, user, mode: "sandbox", allowedDevUserIds: new Set() },
      { repo, gateway },
    );
    assert.equal(first.outcome, "simulated");
    assert.equal(second.outcome, "duplicate");
    assert.equal(first.payoutId, second.payoutId, "one logical intent, one payout");
    assert.equal([...repo.payouts.values()].filter((p) => p.requester_id === user.userId).length, 1);
  });

  it("H: duplicate /batch submission creates ONE batch payout", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    await repo.addRecipient({ workspaceId: workspace.id, alias: "endurance", walletAddress: RECIPIENT, createdBy: MEMBER });
    await repo.addRecipient({
      workspaceId: workspace.id,
      alias: "blossom",
      walletAddress: "0x742d35cc6634c0532925a3b844bc454e4438f44e",
      createdBy: MEMBER,
    });
    const user = memberUser("-100555", 77);
    const body = "endurance 0.01 USDC\nblossom 0.01 USDC";
    const deps = { repo };

    const first = await handleCommunityBatchInstruction({ instruction: { kind: "batch" as const, body }, user }, deps);
    const second = await handleCommunityBatchInstruction({ instruction: { kind: "batch" as const, body }, user }, deps);
    assert.ok(first.text.includes("BATCH PAYOUT"));
    assert.match(second.text, /already received/i);
    assert.equal([...repo.payouts.values()].filter((p) => p.workspace_id === workspace.id).length, 1);
    assert.equal(
      [...repo.payoutItems.values()].filter((i) => i.payout_id === [...repo.payouts.values()].find((p) => p.workspace_id === workspace.id)?.id).length,
      2,
    );
  });

  it("I: duplicate /claimpay delivery creates ONE claim link", async () => {
    const repo = new MemoryRepository();
    await makeCommunityWorkspace(repo);
    const user = memberUser("-100555", 88);
    const deps = { repo };

    const first = await handleClaimPayInstruction({ instruction: { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const }, user }, deps);
    const second = await handleClaimPayInstruction({ instruction: { kind: "claim_pay" as const, amount: "0.05", token: "USDC" as const }, user }, deps);
    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "existing");
    assert.equal(first.claimId, second.claimId);
    assert.equal([...repo.claimLinks.values()].length, 1);
  });

  it("J: duplicate claim approval callbacks execute the claim payout once", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeCommunityWorkspace(repo);
    const token = generateClaimTokenPair();
    const claim = await repo.createClaimLink({
      workspaceId: workspace.id,
      requesterId: MEMBER,
      amountBaseUnits: "5000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
      expiresAt: claimExpiresAtIso(168, new Date("2026-08-12T00:00:00Z")),
      idempotencyKey: `m8-claim-j-${Math.random().toString(36).slice(2)}`,
    });
    const submission = await submitClaimRecipient(repo, token.raw, RECIPIENT, "web", "2026-08-13T00:00:00.000Z");
    assert.equal(submission.ok, true);

    const gateway = new FakeGateway({});
    for (let i = 0; i < 2; i += 1) {
      const m = messenger();
      await handleClaimApprovalCallbackUpdate(
        { action: "claim_approve", claimId: claim.id, actorUserId: APPROVER_1, chatId: "-100555" },
        { repo, gateway },
        m,
      );
    }
    assert.equal(gateway.executeCalls, 1, "duplicate claim approval must execute exactly once");
    assert.equal((await repo.getClaimLinkById(claim.id))?.status, "executed");
  });
});
