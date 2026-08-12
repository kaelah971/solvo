import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleClaimPayInstruction, claimIdempotencyKey } from "../../src/server/telegram/flows/claim-flow.ts";
import { handleClaimApprovalCallbackUpdate } from "../../src/server/telegram/flows/claim-approval-orchestration.ts";
import { claimCallbackData } from "../../src/server/telegram/community-messages.ts";
import type { ClaimPayInstruction, TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const MEMBER = "123456789";
const APPROVER = "987654321";
const OUTSIDER = "555555555";

function memberUser(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: MEMBER,
    chatId: "-100777",
    chatType: "group",
    messageId: 100,
    updateId: 1,
    ...overrides,
  };
}

function claimInstruction(overrides: Partial<ClaimPayInstruction> = {}): ClaimPayInstruction {
  return { kind: "claim_pay", amount: "0.05", token: "USDC", ...overrides };
}

async function makeWorkspace(repo: MemoryRepository, chatId = "-100777") {
  const workspace = await repo.createWorkspace({
    mode: "community",
    name: "Claim Guild",
    telegramChatId: chatId,
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
  });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
  await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: APPROVER, role: "approver" });
  return workspace;
}

type FakeMessenger = {
  answer: (text: string) => Promise<void>;
  edit: (text: string) => Promise<void>;
  reply: (text: string) => Promise<void>;
  answers: string[];
  edits: string[];
};

function messenger(): FakeMessenger {
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

describe("claimpay flow (M7)", () => {
  it("lets a member create a claim link that is an intent only", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const reply = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser() },
      { repo },
    );
    assert.equal(reply.outcome, "created");
    assert.match(reply.text, /CLAIM LINK CREATED/);
    assert.match(reply.text, /0\.05 USDC/);
    assert.match(reply.text, /http:\/\/localhost:3000\/claim\//);
    assert.match(reply.text, /NO funds move from the link/);
    assert.ok(reply.claimId);

    const claims = await repo.listClaimsByWorkspace([...repo.workspaces.values()][0].id);
    assert.equal(claims.length, 1);
    assert.equal(claims[0].requester_id, MEMBER);
    assert.equal(claims[0].amount_base_units, "50000");
    assert.equal(claims[0].status, "created");
    assert.equal([...repo.payouts.values()].length, 0, "creating a claim must not create a payout");
  });

  it("rejects non-members and wrong chat", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const outsider = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser({ userId: OUTSIDER }) },
      { repo },
    );
    assert.equal(outsider.outcome, "unauthorized");

    const noWorkspace = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser({ chatId: "-100999" }) },
      { repo },
    );
    assert.equal(noWorkspace.outcome, "wrong_context");
    assert.equal([...repo.claimLinks.values()].length, 0);
  });

  it("rejects amounts above the proof cap and workspace per-transaction limit", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    // Above the global 0.10 USDC proof cap → rejected at parse time.
    const overCap = await handleClaimPayInstruction(
      { instruction: claimInstruction({ amount: "0.11" }), user: memberUser() },
      { repo },
    );
    assert.equal(overCap.outcome, "invalid");
    assert.match(overCap.text, /claim is invalid/i);
    assert.equal([...repo.claimLinks.values()].length, 0);

    // 0.09 USDC parses but exceeds this workspace's 0.10 per-tx limit? No —
    // lower the workspace limit so policy blocks it.
    await repo.updateWorkspaceMemberRole(workspace.id, MEMBER, "member");
    const strictWorkspace = await repo.createWorkspace({
      mode: "community",
      name: "Strict",
      telegramChatId: "-100888",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "1000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    await repo.addWorkspaceMember({ workspaceId: strictWorkspace.id, telegramUserId: MEMBER, role: "member" });
    const overLimit = await handleClaimPayInstruction(
      { instruction: claimInstruction({ amount: "0.05" }), user: memberUser({ chatId: "-100888" }) },
      { repo },
    );
    assert.equal(overLimit.outcome, "blocked");
    assert.match(overLimit.text, /CLAIM BLOCKED/);
    assert.equal([...repo.claimLinks.values()].length, 0);
    void workspace;
  });

  it("is idempotent: duplicate Telegram delivery returns the existing claim", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const user = memberUser();
    const first = await handleClaimPayInstruction({ instruction: claimInstruction(), user }, { repo });
    assert.equal(first.outcome, "created");
    const second = await handleClaimPayInstruction({ instruction: claimInstruction(), user }, { repo });
    assert.equal(second.outcome, "existing");
    assert.match(second.text, /No duplicate claim was created/);
    assert.equal(second.claimId, first.claimId);
    assert.equal([...repo.claimLinks.values()].length, 1);
  });

  it("derives a stable idempotency key distinct from /pay and /judgepay", () => {
    const a = claimIdempotencyKey(memberUser());
    const b = claimIdempotencyKey(memberUser());
    assert.equal(a, b);
    assert.match(a, /claimpay$/);
    assert.ok(!a.includes(":pay"), "must not collide with /pay keys");
    assert.ok(!a.includes("judgepay"));
  });

  it("a member approving their own claim is blocked (separation of duty)", async () => {
    const repo = new MemoryRepository();
    const workspace = await makeWorkspace(repo);
    const created = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser() },
      { repo },
    );
    assert.equal(created.outcome, "created");
    await repo.claimClaimLink({
      claimId: created.claimId as string,
      recipientAddress: RECIPIENT,
      claimedBy: "web",
      nowIso: "2026-08-13T00:00:00.000Z",
    });
    // Promote the requester to approver — still cannot self-approve.
    await repo.updateWorkspaceMemberRole(workspace.id, MEMBER, "approver");

    const m = messenger();
    const gateway = new FakeGateway({});
    await handleClaimApprovalCallbackUpdate(
      {
        action: "claim_approve",
        claimId: created.claimId as string,
        actorUserId: MEMBER,
        chatId: "-100777",
      },
      { repo, gateway },
      m,
    );
    assert.ok(m.answers.some((a) => /separation of duty/i.test(a)));
    assert.equal(gateway.executeCalls, 0);
  });

  it("an approver approving the claimed destination executes exactly once", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const created = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser() },
      { repo },
    );
    await repo.claimClaimLink({
      claimId: created.claimId as string,
      recipientAddress: RECIPIENT,
      claimedBy: "web",
      nowIso: "2026-08-13T00:00:00.000Z",
    });

    const m = messenger();
    const gateway = new FakeGateway({});
    const callbackData = claimCallbackData("claim_approve", created.claimId as string);
    assert.match(callbackData, /^solvo:claimapprove:/);

    await handleClaimApprovalCallbackUpdate(
      {
        action: "claim_approve",
        claimId: created.claimId as string,
        actorUserId: APPROVER,
        chatId: "-100777",
      },
      { repo, gateway },
      m,
    );

    assert.equal(gateway.executeCalls, 1);
    assert.ok(m.edits.some((e) => /COMPLETED/.test(e)));
    const claim = await repo.getClaimLinkById(created.claimId as string);
    assert.equal(claim?.status, "executed");
    assert.ok(claim?.payout_id);
    const payout = await repo.getPayoutById(claim.payout_id as string);
    assert.equal(payout?.source_type, "claim_link");
    const items = await repo.getPayoutItemsByPayoutId(payout?.id ?? "");
    assert.equal(items[0]?.recipient_address, RECIPIENT);
  });

  it("a duplicate approval callback never executes twice", async () => {
    const repo = new MemoryRepository();
    await makeWorkspace(repo);
    const created = await handleClaimPayInstruction(
      { instruction: claimInstruction(), user: memberUser() },
      { repo },
    );
    await repo.claimClaimLink({
      claimId: created.claimId as string,
      recipientAddress: RECIPIENT,
      claimedBy: "web",
      nowIso: "2026-08-13T00:00:00.000Z",
    });

    const gateway = new FakeGateway({});
    for (let i = 0; i < 2; i += 1) {
      const m = messenger();
      await handleClaimApprovalCallbackUpdate(
        { action: "claim_approve", claimId: created.claimId as string, actorUserId: APPROVER, chatId: "-100777" },
        { repo, gateway },
        m,
      );
    }
    assert.equal(gateway.executeCalls, 1, "duplicate approval must not double execute");
  });
});
