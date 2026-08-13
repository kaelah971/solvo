import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Transformer } from "grammy";
import type { Update } from "grammy/types";

import { createTelegramBot } from "../../src/server/telegram/bot.ts";
import { DEFAULT_BOT_USERNAME } from "../../src/server/telegram/config.ts";
import type { PostgresRepository } from "../../src/server/db/postgres-repository.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleMemberAdd } from "../../src/server/telegram/flows/member-flow.ts";
import { handleRecipientAdd } from "../../src/server/telegram/flows/recipient-flow.ts";
import { handleWorkspaceInit } from "../../src/server/telegram/flows/workspace-flow.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";

const OWNER = "100000001";
const APPROVER = "100000002";
const MEMBER = "100000003";
const CHAT = -1001234567890;
const ADDRESS = "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486";

const FAKE_TOKEN = "1234567890:AAfakefakefakefakefakefakefakefake";

type SentMessage = { chatId: number; text: string };

/**
 * Runs a full fake Telegram update through the SAME runtime path production
 * uses: webhook POST -> bot.handleUpdate -> ":text" middleware ->
 * parseInstruction -> group/private dispatch -> flow -> ctx.reply. All
 * outbound API calls are intercepted so no network or real payment can occur.
 */
class WebhookHarness {
  repo = new MemoryRepository();
  sent: SentMessage[] = [];
  private bot = createTelegramBot(FAKE_TOKEN, {
    repo: this.repo as unknown as PostgresRepository,
  });

  constructor() {
    this.bot.botInfo = {
      id: 42,
      is_bot: true,
      first_name: "Solvo",
      username: DEFAULT_BOT_USERNAME,
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    };
    const interceptor = (async (
      prev: (method: string, payload: Record<string, unknown>) => Promise<unknown>,
      method: string,
      payload: Record<string, unknown>,
    ) => {
      if (method === "sendMessage") {
        const text = (payload.text as string | undefined) ?? "";
        this.sent.push({ chatId: (payload.chat_id as number | undefined) ?? 0, text });
        return {
          ok: true,
          result: {
            message_id: 1,
            date: 0,
            chat: { id: (payload.chat_id as number | undefined) ?? 0, type: "supergroup" },
            text,
          },
        };
      }
      return prev(method, payload);
    }) as unknown as Transformer;
    this.bot.api.config.use(interceptor);
  }

  async seed(): Promise<void> {
    const owner: TelegramUser = { userId: OWNER, chatId: String(CHAT), chatType: "supergroup", messageId: 1, updateId: 1 };
    await handleWorkspaceInit({ user: owner, allowedDevUserIds: new Set([OWNER]) }, { repo: this.repo });
    await handleMemberAdd({ user: owner, targetUserId: APPROVER, role: "approver" }, { repo: this.repo });
    await handleMemberAdd({ user: owner, targetUserId: MEMBER, role: "member" }, { repo: this.repo });
    await handleRecipientAdd({ user: owner, alias: "blossom", address: ADDRESS }, { repo: this.repo });
  }

  async push(text: string, fromId = MEMBER): Promise<void> {
    const update: Update = {
      update_id: 5000,
      message: {
        message_id: 7,
        date: Math.floor(Date.now() / 1000),
        chat: { id: CHAT, type: "supergroup", title: "Solvo Test" },
        from: { id: Number(fromId), is_bot: false, first_name: "Member" },
        text,
        entities: [{ offset: 0, length: text.split(/\s+/)[0].length, type: "bot_command" }],
      },
    };
    await this.bot.handleUpdate(update);
  }

  lastReply(): string {
    return this.sent[this.sent.length - 1]?.text ?? "";
  }
}

describe("webhook runtime path: addressed commands", () => {
  it("routes /pay@SolvoAgentBot <alias> <amount> USDC to community payout handling (not Unknown command)", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/pay@SolvoAgentBot blossom 0.01 USDC");

    assert.match(h.lastReply(), /approval|pending|Approval|APPROVE/i);
    assert.ok(!h.lastReply().includes("Unknown command"), "must not hit unknownCommandResult");

    const payouts = [...h.repo.payouts.values()];
    assert.equal(payouts.length, 1, "exactly one payout row");
    assert.equal(payouts[0].status, "pending_approval");
    const items = await h.repo.getPayoutItemsByPayoutId(payouts[0].id);
    assert.equal(items.length, 1);
    assert.equal(items[0].recipient_address.toLowerCase(), ADDRESS.toLowerCase(), "alias blossom resolved");
    assert.equal(items[0].amount_base_units, "10000");
  });

  it("matches the bot username case-insensitively through the webhook path", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/pay@solvoagentbot blossom 0.01 USDC");
    assert.match(h.lastReply(), /approval|pending|Approval|APPROVE/i);
    assert.equal([...h.repo.payouts.values()].length, 1);
  });

  it("keeps the plain /pay alias form working through the webhook path", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/pay blossom 0.01 USDC");
    assert.match(h.lastReply(), /approval|pending|Approval|APPROVE/i);
    assert.equal([...h.repo.payouts.values()].length, 1);
  });

  it("routes /dashboard@SolvoAgentBot through the dashboard flow", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/dashboard@SolvoAgentBot", OWNER);
    assert.match(h.lastReply(), /Open your Solvo dashboard\./);
    assert.ok(!h.lastReply().includes("Unknown command"));
  });

  it("routes /recipient@SolvoAgentBot list and /member@SolvoAgentBot list", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/recipient@SolvoAgentBot list", OWNER);
    assert.match(h.lastReply(), /blossom/);
    await h.push("/member@SolvoAgentBot list", OWNER);
    assert.ok(!h.lastReply().includes("Unknown command"));
  });

  it("still rejects unknown addressed commands with Unknown command", async () => {
    const h = new WebhookHarness();
    await h.seed();
    await h.push("/distribute@SolvoAgentBot now", OWNER);
    assert.match(h.lastReply(), /Unknown command\./);
  });

  it("tolerates a mistyped TELEGRAM_BOT_USERNAME in the environment", async () => {
    const prev = process.env.TELEGRAM_BOT_USERNAME;
    try {
      // "ctx.me" is authoritative, so a stale env value must not break the bot.
      process.env.TELEGRAM_BOT_USERNAME = "StaleBot";
      const h = new WebhookHarness();
      await h.seed();
      await h.push("/pay@SolvoAgentBot blossom 0.01 USDC");
      assert.equal([...h.repo.payouts.values()].length, 1);
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
      else process.env.TELEGRAM_BOT_USERNAME = prev;
    }
  });

  it("tolerates a leading @ in TELEGRAM_BOT_USERNAME via config normalization", async () => {
    const prev = process.env.TELEGRAM_BOT_USERNAME;
    try {
      process.env.TELEGRAM_BOT_USERNAME = "@SolvoAgentBot";
      const { getTelegramConfig } = await import("../../src/server/telegram/config.ts");
      assert.equal(getTelegramConfig().botUsername, "SolvoAgentBot");
    } finally {
      if (prev === undefined) delete process.env.TELEGRAM_BOT_USERNAME;
      else process.env.TELEGRAM_BOT_USERNAME = prev;
    }
  });
});
