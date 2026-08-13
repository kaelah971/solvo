import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import type { SolvoRepository } from "../../src/server/db/repository.ts";
import { handleApprovalCallback } from "../../src/server/telegram/flows/approval-flow.ts";
import { handleCommunityPayInstruction } from "../../src/server/telegram/flows/community-pay-flow.ts";
import {
  handleMemberAdd,
  handleMemberList,
  handleMemberRemove,
} from "../../src/server/telegram/flows/member-flow.ts";
import {
  handleRecipientAdd,
  handleRecipientList,
} from "../../src/server/telegram/flows/recipient-flow.ts";
import { handleWorkspaceInit } from "../../src/server/telegram/flows/workspace-flow.ts";
import { handleStatusInstruction } from "../../src/server/telegram/flows/status-flow.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { FakeGateway, TX_HASH } from "../execution/fixtures.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ADDRESS = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";
const NORMALIZED = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

const OWNER = "100000001";
const APPROVER = "100000002";
const MEMBER = "100000003";
const OTHER = "100000004";
const CHAT = "-1001234567890";

const DEV_OPERATORS = new Set([OWNER]);

function groupUser(userId: string, messageId = 1): TelegramUser {
  return { userId, chatId: CHAT, chatType: "supergroup", messageId, updateId: 1000 + messageId };
}

function payoutIdFromReply(reply: { buttons?: Array<{ callbackData: string }> }): string {
  const data = reply.buttons?.[0]?.callbackData ?? "";
  const match = /^solvo:(?:approve|reject):([0-9a-f-]{36})$/.exec(data);
  assert.ok(match, "expected callback data carrying the full payout id");
  return match[1];
}

async function seedCommunity(
  repo: SolvoRepository,
): Promise<{ workspaceId: string; payoutId: string; itemId: string }> {
  const init = await handleWorkspaceInit(
    { user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS },
    { repo },
  );
  assert.equal(init.outcome, "created");
  const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
  assert.ok(workspace);
  await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
  await handleMemberAdd({ user: groupUser(OWNER, 3), targetUserId: MEMBER, role: "member" }, { repo });

  const request = await handleCommunityPayInstruction(
    {
      instruction: {
        kind: "pay",
        address: ADDRESS,
        amount: "0.01",
        token: "USDC",
        sourceType: "telegram_command",
      },
      user: groupUser(MEMBER, 4),
    },
    { repo },
  );
  assert.ok(request.buttons, "expected approval buttons");
  const payoutId = payoutIdFromReply(request);
  const items = await repo.getPayoutItemsByPayoutId(payoutId);
  return { workspaceId: workspace.id, payoutId, itemId: items[0]?.id ?? "" };
}

describe("workspace init", () => {
  it("creates a community workspace and makes the initializer owner", async () => {
    const repo = new MemoryRepository();
    const reply = await handleWorkspaceInit(
      { user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS },
      { repo },
    );
    assert.equal(reply.outcome, "created");
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    assert.equal(workspace.mode, "community");
    assert.equal(workspace.chain_id, CHAIN);
    assert.equal(workspace.token_address, TOKEN);
    assert.equal(workspace.approval_policy, "requires_approval");
    assert.equal(workspace.per_transaction_limit_base_units, "100000");
    const member = await repo.getWorkspaceMember(workspace.id, OWNER);
    assert.equal(member?.role, "owner");
  });

  it("is idempotent: a second init returns the existing workspace", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    const second = await handleWorkspaceInit(
      { user: groupUser(OWNER, 2), allowedDevUserIds: DEV_OPERATORS },
      { repo },
    );
    assert.equal(second.outcome, "existing");
    const workspaces = [...repo.workspaces.values()].filter((w) => w.mode === "community");
    assert.equal(workspaces.length, 1);
  });

  it("blocks private chats", async () => {
    const repo = new MemoryRepository();
    const reply = await handleWorkspaceInit(
      { user: { ...groupUser(OWNER), chatType: "private" }, allowedDevUserIds: DEV_OPERATORS },
      { repo },
    );
    assert.equal(reply.outcome, "wrong_context");
  });

  it("blocks unauthorized initializers", async () => {
    const repo = new MemoryRepository();
    const reply = await handleWorkspaceInit(
      { user: groupUser(MEMBER, 1), allowedDevUserIds: DEV_OPERATORS },
      { repo },
    );
    assert.equal(reply.outcome, "unauthorized");
  });
});

describe("membership", () => {
  it("owner can add a member and an approver", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    const added = await handleMemberAdd(
      { user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" },
      { repo },
    );
    assert.equal(added.outcome, "ok");
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    assert.equal((await repo.getWorkspaceMember(workspace.id, MEMBER))?.role, "member");
    await handleMemberAdd({ user: groupUser(OWNER, 3), targetUserId: APPROVER, role: "approver" }, { repo });
    assert.equal((await repo.getWorkspaceMember(workspace.id, APPROVER))?.role, "approver");
  });

  it("a member cannot assign roles", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    const reply = await handleMemberAdd(
      { user: groupUser(MEMBER, 3), targetUserId: OTHER, role: "approver" },
      { repo },
    );
    assert.equal(reply.outcome, "unauthorized");
  });

  it("duplicate membership is reported without a second row", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    const duplicate = await handleMemberAdd(
      { user: groupUser(OWNER, 3), targetUserId: MEMBER, role: "member" },
      { repo },
    );
    assert.equal(duplicate.outcome, "existing");
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    const rows = [...repo.members.values()].filter(
      (m) => m.workspace_id === workspace.id && m.telegram_user_id === MEMBER,
    );
    assert.equal(rows.length, 1);
  });

  it("the final owner cannot be removed", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    const reply = await handleMemberRemove({ user: groupUser(OWNER, 2), targetUserId: OWNER }, { repo });
    assert.equal(reply.outcome, "invalid");
    assert.match(reply.text, /final owner/);
  });

  it("an approver cannot manage roles", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
    const reply = await handleMemberAdd(
      { user: groupUser(APPROVER, 3), targetUserId: MEMBER, role: "member" },
      { repo },
    );
    assert.equal(reply.outcome, "unauthorized");
  });

  it("owner can remove a member and list members", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    const removed = await handleMemberRemove({ user: groupUser(OWNER, 3), targetUserId: MEMBER }, { repo });
    assert.equal(removed.outcome, "ok");
    const list = await handleMemberList({ user: groupUser(OWNER, 4) }, { repo });
    assert.doesNotMatch(list.text, new RegExp(MEMBER));
    assert.match(list.text, /OWNER\s+100000001/);
  });
});

describe("recipient directory", () => {
  it("owner or approver can add a validated recipient alias", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
    const reply = await handleRecipientAdd(
      { user: groupUser(APPROVER, 3), alias: "alice", address: ADDRESS },
      { repo },
    );
    assert.equal(reply.outcome, "ok");
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    const recipient = await repo.getRecipientByAlias(workspace.id, "alice");
    assert.equal(recipient?.wallet_address, NORMALIZED);
  });

  it("rejects an invalid address", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    const reply = await handleRecipientAdd(
      { user: groupUser(OWNER, 2), alias: "bob", address: "0x123" },
      { repo },
    );
    assert.equal(reply.outcome, "invalid");
  });

  it("rejects a duplicate alias in the same workspace", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 2), alias: "alice", address: ADDRESS }, { repo });
    const duplicate = await handleRecipientAdd(
      { user: groupUser(OWNER, 3), alias: "Alice", address: ADDRESS },
      { repo },
    );
    assert.equal(duplicate.outcome, "existing");
  });

  it("a member cannot add recipients but may list them", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 3), alias: "alice", address: ADDRESS }, { repo });
    const blocked = await handleRecipientAdd(
      { user: groupUser(MEMBER, 4), alias: "carol", address: ADDRESS },
      { repo },
    );
    assert.equal(blocked.outcome, "unauthorized");
    const list = await handleRecipientList({ user: groupUser(MEMBER, 5) }, { repo });
    assert.match(list.text, /alice/);
  });
});

describe("community payment requests", () => {
  it("a member creates a request that lands in pending_approval", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await seedCommunity(repo);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "pending_approval");
  });

  it("non-members are blocked", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    const reply = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay",
          address: ADDRESS,
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_command",
        },
        user: groupUser(OTHER, 2),
      },
      { repo },
    );
    assert.match(reply.text, /not a member/);
  });

  it("preview shows the destination explicitly and requires approval", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    const reply = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay",
          address: ADDRESS,
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_command",
        },
        user: groupUser(MEMBER, 3),
      },
      { repo },
    );
    assert.match(reply.text, /PAYMENT REQUEST/);
    assert.match(reply.text, /ADDRESS\s+0x76d7a718/);
    assert.match(reply.text, /AMOUNT\s+0\.01 USDC/);
    assert.match(reply.text, /APPROVAL\s+REQUIRED/);
    assert.ok(reply.buttons);
    assert.equal(reply.buttons.length, 2);
  });

  it("resolves a validated alias and never treats a username as a wallet", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 3), alias: "alice", address: ADDRESS }, { repo });

    const parsed = parseInstruction("Send 0.05 USDC to alice");
    assert.equal(parsed.kind, "pay_alias");
    const reply = await handleCommunityPayInstruction(
      { instruction: parsed, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(reply.text, /ADDRESS\s+0x76d7a718/);
    const unknown = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay_alias",
          alias: "bob",
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_natural_language",
        },
        user: groupUser(MEMBER, 5),
      },
      { repo },
    );
    assert.match(unknown.text, /Unknown recipient/);

    const capitalized = parseInstruction("Send 5 USDC to Alex");
    assert.equal(capitalized.kind, "failure");
  });

  it("a request above the per-transaction limit is blocked", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await repo.createWorkspace({
      mode: "community",
      name: "Strict",
      telegramChatId: "-1005555555555",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "5000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
    });
    const strict = await repo.getWorkspaceByTelegramChatId("-1005555555555");
    assert.ok(strict);
    await repo.addWorkspaceMember({ workspaceId: strict.id, telegramUserId: MEMBER, role: "member" });
    const reply = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay",
          address: ADDRESS,
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_command",
        },
        user: { ...groupUser(MEMBER, 3), chatId: "-1005555555555" },
      },
      { repo },
    );
    assert.match(reply.text, /per-transaction limit/);
  });
});

describe("slash alias community payouts (/pay <alias> <amount> USDC)", () => {
  it("creates a pending_approval payout resolving the alias to its wallet", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 3), alias: "blossom", address: ADDRESS }, { repo });

    const parsed = parseInstruction("/pay blossom 0.01 USDC");
    assert.equal(parsed.kind, "pay_alias");
    if (parsed.kind !== "pay_alias") return;
    const reply = await handleCommunityPayInstruction({ instruction: parsed, user: groupUser(MEMBER, 4) }, { repo });
    assert.match(reply.text, /PAYMENT REQUEST/);
    assert.match(reply.text, /ADDRESS\s+0x76d7a718/);
    assert.match(reply.text, /APPROVAL\s+REQUIRED/);
    assert.ok(reply.buttons, "expected approval buttons");

    const payoutId = payoutIdFromReply(reply);
    const payout = await repo.getPayoutById(payoutId);
    assert.equal(payout?.status, "pending_approval");
    assert.equal(payout?.source_type, "telegram_command");
    const items = await repo.getPayoutItemsByPayoutId(payoutId);
    assert.equal(items.length, 1);
    assert.equal(items[0].recipient_address, NORMALIZED);
    assert.equal(items[0].status, "pending_approval");
    // No execution attempt and no KeeperHub interaction at request time.
    assert.equal(repo.executionAttempts.size, 0);
  });

  it("an unknown alias returns helpful add-recipient guidance", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });

    const parsed = parseInstruction("/pay unknown_alias 0.01 USDC");
    assert.equal(parsed.kind, "pay_alias");
    if (parsed.kind !== "pay_alias") return;
    const reply = await handleCommunityPayInstruction({ instruction: parsed, user: groupUser(MEMBER, 3) }, { repo });
    assert.match(reply.text, /Unknown recipient "unknown_alias"/);
    assert.match(reply.text, /\/recipient add unknown_alias/);
    assert.equal(repo.payouts.size, 0, "unknown alias must not create a payout");
  });

  it("a non-member cannot use alias pay", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 2), alias: "blossom", address: ADDRESS }, { repo });

    const parsed = parseInstruction("/pay blossom 0.01 USDC");
    assert.equal(parsed.kind, "pay_alias");
    if (parsed.kind !== "pay_alias") return;
    const reply = await handleCommunityPayInstruction({ instruction: parsed, user: groupUser(OTHER, 3) }, { repo });
    assert.match(reply.text, /not a member/);
    assert.equal(repo.payouts.size, 0);
  });

  it("private-chat alias pay is intercepted at the bot layer, never pretending the alias exists", () => {
    // The bot replies to every group-only command in DMs with the same
    // message; aliases are workspace-scoped and must not resolve in DMs.
    const bot = readFileSync(new URL("../../src/server/telegram/bot.ts", import.meta.url), "utf8");
    assert.match(bot, /"This command only works inside an initialized group workspace\."/);
    assert.ok(bot.includes('parsed.kind === "pay_alias"'), "pay_alias must be in the group-only private-chat list");
  });

  it("self-approval stays blocked for an alias requester who is an approver", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 3), alias: "blossom", address: ADDRESS }, { repo });

    const parsed = parseInstruction("/pay blossom 0.01 USDC");
    assert.equal(parsed.kind, "pay_alias");
    if (parsed.kind !== "pay_alias") return;
    const request = await handleCommunityPayInstruction(
      { instruction: parsed, user: groupUser(APPROVER, 4) },
      { repo },
    );
    const payoutId = payoutIdFromReply(request);
    const gateway = new FakeGateway({});
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(result.answer, "A different treasury approver must approve this request.");
    assert.equal(gateway.executeCalls, 0);
  });

  it("wallet /pay continues to work alongside alias /pay", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: MEMBER, role: "member" }, { repo });
    await handleRecipientAdd({ user: groupUser(OWNER, 3), alias: "blossom", address: ADDRESS }, { repo });

    const walletParsed = parseInstruction(`/pay ${ADDRESS} 0.01 USDC`);
    assert.equal(walletParsed.kind, "pay");
    const walletReply = await handleCommunityPayInstruction(
      { instruction: walletParsed, user: groupUser(MEMBER, 4) },
      { repo },
    );
    assert.match(walletReply.text, /ADDRESS\s+0x76d7a718/);
    const aliasParsed = parseInstruction("/pay blossom 0.01 USDC");
    assert.equal(aliasParsed.kind, "pay_alias");
    const aliasReply = await handleCommunityPayInstruction(
      { instruction: aliasParsed, user: groupUser(MEMBER, 5) },
      { repo },
    );
    assert.match(aliasReply.text, /ADDRESS\s+0x76d7a718/);
    assert.equal(repo.executionAttempts.size, 0, "no execution attempt from either request");
  });
});

describe("approval flow", () => {
  it("a member cannot approve", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: MEMBER, chatId: CHAT },
      { repo, gateway: new FakeGateway({}) },
    );
    assert.equal(result.answer, "You are not authorized to approve this request.");
  });

  it("an approver can approve another member's request", async () => {
    const repo = new MemoryRepository();
    const { itemId } = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    const result = await handleApprovalCallback(
      { action: "approve", payoutId: (await repo.getPayoutItemById(itemId))?.payout_id ?? "", actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /approved/i);
    assert.equal(gateway.executeCalls, 1);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "completed");
  });

  it("self-approval is blocked even when the requester is an approver", async () => {
    const repo = new MemoryRepository();
    await handleWorkspaceInit({ user: groupUser(OWNER, 1), allowedDevUserIds: DEV_OPERATORS }, { repo });
    await handleMemberAdd({ user: groupUser(OWNER, 2), targetUserId: APPROVER, role: "approver" }, { repo });
    const gateway = new FakeGateway({});
    const request = await handleCommunityPayInstruction(
      {
        instruction: {
          kind: "pay",
          address: ADDRESS,
          amount: "0.01",
          token: "USDC",
          sourceType: "telegram_command",
        },
        user: groupUser(APPROVER, 3),
      },
      { repo },
    );
    const payoutId = payoutIdFromReply(request);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(result.answer, "A different treasury approver must approve this request.");
    assert.equal(gateway.executeCalls, 0);
  });

  it("duplicate callbacks are idempotent: one execution only", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.executeCalls, 1);
    const second = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(second.answer, "This request has already been handled.");
    assert.equal(gateway.executeCalls, 1);
  });

  it("two concurrent approvals produce exactly one execution", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    const results = await Promise.all([
      handleApprovalCallback(
        { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
        { repo, gateway },
      ),
      handleApprovalCallback(
        { action: "approve", payoutId, actorUserId: OWNER, chatId: CHAT },
        { repo, gateway },
      ),
    ]);
    const winners = results.filter((result) => /approved/i.test(result.answer)).length;
    const losers = results.filter((result) => /already been handled/i.test(result.answer)).length;
    assert.equal(winners, 1);
    assert.equal(losers, 1);
    assert.equal(gateway.executeCalls, 1);
  });

  it("a rejected request never executes", async () => {
    const repo = new MemoryRepository();
    const { itemId, payoutId } = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    const result = await handleApprovalCallback(
      { action: "reject", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /rejected/i);
    assert.match(result.edited ?? "", /PAYMENT NOT APPROVED/);
    assert.equal(gateway.executeCalls, 0);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "cancelled");
  });

  it("callbacks from the wrong chat are rejected", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: "-999999999" },
      { repo, gateway: new FakeGateway({}) },
    );
    assert.equal(result.answer, "This request does not belong to this chat.");
  });

  it("a completed payout cannot execute again", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const gateway = new FakeGateway({});
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.executeCalls, 1);
    const again = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: OWNER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(again.answer, "This request has already been handled.");
    assert.equal(gateway.executeCalls, 1);
  });

  it("simulation failure stops before execution and stays non-executable", async () => {
    const repo = new MemoryRepository();
    const { itemId, payoutId } = await seedCommunity(repo);
    const gateway = new FakeGateway({
      simulate: {
        success: false,
        wouldRevert: true,
        from: null,
        to: null,
        value: null,
        gasEstimate: null,
        revertReason: "Error(revert)",
        code: "simulation_reverted",
        balanceWei: null,
        requiredWei: null,
        shortfallWei: null,
        error: "Error(revert)",
      },
    });
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.equal(gateway.executeCalls, 0);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.status, "simulation_failed");
    assert.equal(result.answer, "Payment approved.");
  });

  it("records the approval actor in the audit trail", async () => {
    const repo = new MemoryRepository();
    const { payoutId, itemId } = await seedCommunity(repo);
    await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway: new FakeGateway({}) },
    );
    const events = repo.auditEvents.filter((event) => event.payout_id === payoutId);
    const approved = events.find((event) => event.event_type === "approval_granted");
    assert.ok(approved);
    assert.equal(approved.actor_id, APPROVER);
    assert.equal(approved.actor_type, "approver");
    const lifecycle = events.map((event) => event.event_type);
    assert.deepEqual(lifecycle, [
      "request_created",
      "approval_required",
      "approval_granted",
      "simulation_started",
      "simulation_passed",
      "execution_submitted",
      "execution_completed",
    ]);
    const item = await repo.getPayoutItemById(itemId);
    assert.equal(item?.transaction_hash, TX_HASH);
  });

  it("the daily execution limit is enforced at approval time", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    const item = (await repo.getPayoutItemsByPayoutId(payoutId))[0];
    assert.ok(item);

    const completed = await repo.createPayout({
      workspaceId: workspace.id,
      requesterId: MEMBER,
      sourceType: "telegram_command",
      status: "completed",
      totalAmountBaseUnits: "995000",
      currencySymbol: "USDC",
      chainId: CHAIN,
      tokenAddress: TOKEN,
    });
    await repo.createPayoutItem({
      payoutId: completed.id,
      recipientAddress: NORMALIZED,
      amountBaseUnits: "995000",
      memo: null,
      status: "completed",
      idempotencyKey: `daily-spend-${Math.random().toString(36).slice(2)}`,
    });

    const gateway = new FakeGateway({});
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /daily execution limit/);
    assert.equal(gateway.executeCalls, 0);
    const after = await repo.getPayoutItemById(item.id);
    assert.equal(after?.status, "pending_approval");
  });

  it("an inactive workspace blocks approval", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const workspace = await repo.getWorkspaceByTelegramChatId(CHAT);
    assert.ok(workspace);
    repo.workspaces.set(workspace.id, { ...workspace, status: "suspended" });
    const gateway = new FakeGateway({});
    const result = await handleApprovalCallback(
      { action: "approve", payoutId, actorUserId: APPROVER, chatId: CHAT },
      { repo, gateway },
    );
    assert.match(result.answer, /not active/);
    assert.equal(gateway.executeCalls, 0);
  });
});

describe("community status scoping", () => {
  it("members of the workspace can inspect, outsiders cannot", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const memberView = await handleStatusInstruction(payoutId, repo, {
      userId: MEMBER,
      chatId: CHAT,
    });
    assert.equal(memberView.found, true);
    assert.match(memberView.text, /PAYOUT STATUS/);
    const outsiderView = await handleStatusInstruction(payoutId, repo, {
      userId: OTHER,
      chatId: CHAT,
    });
    assert.equal(outsiderView.found, false);
    assert.match(outsiderView.text, /not a member/);
  });

  it("status from a different chat is rejected for community payouts", async () => {
    const repo = new MemoryRepository();
    const { payoutId } = await seedCommunity(repo);
    const view = await handleStatusInstruction(payoutId, repo, {
      userId: MEMBER,
      chatId: "-888888888",
    });
    assert.equal(view.found, false);
  });
});

