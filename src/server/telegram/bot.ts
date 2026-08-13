import { Bot, Context, InlineKeyboard } from "grammy";

import { PostgresRepository } from "../db/postgres-repository.ts";
import * as accessor from "../db/accessor.ts";
import { getTelegramConfig, DEFAULT_BOT_USERNAME } from "./config.ts";
import { parseInstruction } from "./parsing.ts";
import { handlePayInstruction, resolveMode } from "./flows/pay-flow.ts";
import { handleStatusInstruction } from "./flows/status-flow.ts";
import { handleWorkspaceInit } from "./flows/workspace-flow.ts";
import { handleMemberAdd, handleMemberList, handleMemberRemove } from "./flows/member-flow.ts";
import { handleRecipientAdd, handleRecipientList } from "./flows/recipient-flow.ts";
import { handleCommunityPayInstruction } from "./flows/community-pay-flow.ts";
import { handleCommunityBatchInstruction } from "./flows/community-batch-flow.ts";
import { handleJudgePayInstruction } from "./flows/judge-flow.ts";
import { handleClaimPayInstruction } from "./flows/claim-flow.ts";
import { handleClaimStatusInstruction } from "./flows/claim-status-flow.ts";
import { handleDashboardInstruction } from "./flows/dashboard-flow.ts";
import { handleAgentGroupText } from "./flows/agent-flow.ts";
import { handleClaimApprovalCallbackUpdate } from "./flows/claim-approval-orchestration.ts";
import { handleApprovalCallbackUpdate } from "./flows/approval-orchestration.ts";
import { parseCallbackData, type ParsedCallbackData } from "./community-messages.ts";
import { serializeBotError } from "./safe-logging.ts";
import { helpMessage, startMessage } from "./messages.ts";
import type { ParseResult, TelegramUser } from "./types.ts";

type HandlerDeps = {
  repo: PostgresRepository;
};

const BOT = Symbol.for("solvo.telegram.bot");

function isGroupChat(type: string): boolean {
  return type === "group" || type === "supergroup";
}

function isClaimCallback(
  parsed: ParsedCallbackData,
): parsed is Extract<ParsedCallbackData, { action: "claim_approve" | "claim_reject" }> {
  return parsed.action === "claim_approve" || parsed.action === "claim_reject";
}

function userFromContext(ctx: Context): TelegramUser | null {
  const from = ctx.from;
  if (!from) return null;
  const chatType = ctx.chat?.type ?? "private";
  if (!isGroupChat(chatType) && chatType !== "private") return null;
  return {
    userId: String(from.id),
    chatId: String(ctx.chat?.id ?? ""),
    chatType,
    messageId: ctx.message?.message_id ?? null,
    updateId: ctx.update.update_id,
  };
}

export function createTelegramBot(token: string, deps: HandlerDeps): Bot {
  const bot = new Bot(token);
  const config = getTelegramConfig();

  // Never let an unhandled error escape into grammY's default handler: the
  // raw dump of a BotError serializes the whole Context, which carries the
  // bot token in ctx.api. Log only sanitized scalars.
  bot.catch((caught) => {
    const updateId = caught.ctx?.update?.update_id ?? null;
    const callbackData =
      caught.ctx?.callbackQuery && typeof caught.ctx.callbackQuery.data === "string"
        ? caught.ctx.callbackQuery.data
        : null;
    const parsed = callbackData ? parseCallbackData(callbackData) : null;
    console.error(
      serializeBotError(caught.error, {
        updateId,
        action: parsed?.action ?? null,
        payoutId: parsed !== null && "payoutId" in parsed ? parsed.payoutId : null,
        claimId: parsed !== null && "claimId" in parsed ? parsed.claimId : null,
      }),
    );
  });

  bot.on(":text", async (ctx) => {
    const user = userFromContext(ctx);
    if (!user) return;
    const text = ctx.message?.text ?? "";
    // Deterministic in production: prefer the configured username, then the
    // cached getMe value, and finally the documented default. Relying on
    // ctx.me alone makes addressed commands (/pay@SolvoAgentBot) fail
    // whenever getMe has not run for this serverless worker.
    const botUsername =
      config.botUsername ?? (ctx.me?.username as string | undefined) ?? DEFAULT_BOT_USERNAME;
    const parsed = parseInstruction(text, { botUsername });

    if (isGroupChat(user.chatType)) {
      await handleGroupText(ctx, parsed, user, deps, config.allowedDevUserIds);
      return;
    }

    await handlePrivateText(ctx, parsed, user, deps);
  });

  bot.on("callback_query:data", async (ctx) => {
    const callback = ctx.callbackQuery;
    const parsed = parseCallbackData(callback.data);
    const from = ctx.from;
    const message = callback.message;
    if (!parsed || !from || !message) {
      try {
        await ctx.answerCallbackQuery({ text: "Unknown action." });
      } catch (error) {
        console.error(serializeBotError(error));
      }
      return;
    }

    const messenger = {
      answer: async (text: string) => {
        await ctx.answerCallbackQuery({ text });
      },
      edit: async (text: string) => {
        await ctx.api.editMessageText(String(message.chat.id), message.message_id, text);
      },
      reply: async (text: string) => {
        await ctx.reply(text);
      },
    };

    if (isClaimCallback(parsed)) {
      await handleClaimApprovalCallbackUpdate(
        {
          action: parsed.action,
          claimId: parsed.claimId,
          actorUserId: String(from.id),
          chatId: String(message.chat.id),
        },
        { repo: deps.repo },
        messenger,
      );
      return;
    }

    const payoutAction = parsed.action;
    const payoutId = parsed.payoutId;
    await handleApprovalCallbackUpdate(
      {
        action: payoutAction,
        payoutId,
        actorUserId: String(from.id),
        chatId: String(message.chat.id),
      },
      { repo: deps.repo },
      messenger,
    );
  });

  return bot;
}
async function handlePrivateText(
  ctx: Context,
  parsed: ParseResult,
  user: TelegramUser,
  deps: HandlerDeps,
): Promise<void> {
  if (parsed.kind === "start") {
    await ctx.reply(startMessage());
    return;
  }
  if (parsed.kind === "help") {
    await ctx.reply(helpMessage());
    return;
  }
  if (parsed.kind === "failure") {
    await ctx.reply(`${parsed.reason}\n\n${parsed.hint}`);
    return;
  }
  if (parsed.kind === "status") {
    const reply = await handleStatusInstruction(parsed.payoutId, deps.repo, {
      userId: user.userId,
      chatId: user.chatId,
    });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "judge_pay") {
    await renderJudgeReply(ctx, user, parsed, deps);
    return;
  }
  if (
    parsed.kind === "workspace_init" ||
    parsed.kind === "member_add" ||
    parsed.kind === "member_remove" ||
    parsed.kind === "member_list" ||
    parsed.kind === "recipient_add" ||
    parsed.kind === "recipient_list" ||
    parsed.kind === "pay_alias" ||
    parsed.kind === "batch" ||
    parsed.kind === "claim_pay" ||
    parsed.kind === "claim_status" ||
    parsed.kind === "dashboard"
  ) {
    await ctx.reply("This command only works inside an initialized group workspace.");
    return;
  }

  const allowedDevUserIds = getTelegramConfig().allowedDevUserIds;
  const mode = resolveMode(user.userId, allowedDevUserIds);
  const reply = await handlePayInstruction(
    { instruction: parsed, user, mode, allowedDevUserIds },
    { repo: deps.repo },
  );

  let sent: { chatId: string; messageId: number } | null = null;
  for (const message of reply.messages.length > 0 ? reply.messages : [reply.final]) {
    if (!sent) {
      const result = await ctx.reply(message);
      sent = { chatId: String(result.chat.id), messageId: result.message_id };
    } else {
      try {
        await ctx.api.editMessageText(sent.chatId, sent.messageId, message);
      } catch {
        const result = await ctx.reply(message);
        sent = { chatId: String(result.chat.id), messageId: result.message_id };
      }
    }
  }
  if (sent !== null && reply.messages.length > 0 && reply.final !== reply.messages[reply.messages.length - 1]) {
    try {
      await ctx.api.editMessageText(sent.chatId, sent.messageId, reply.final);
    } catch {
      await ctx.reply(reply.final);
    }
  }
}

async function handleGroupText(
  ctx: Context,
  parsed: ParseResult,
  user: TelegramUser,
  deps: HandlerDeps,
  allowedDevUserIds: ReadonlySet<string>,
): Promise<void> {
  const text = ctx.message?.text ?? "";
  if (parsed.kind === "start") {
    await ctx.reply(startMessage());
    return;
  }
  if (parsed.kind === "help") {
    await ctx.reply(helpMessage());
    return;
  }
  if (parsed.kind === "failure") {
    // M8 agent entry: only NON-command text that the deterministic parser
    // rejects may reach the agent orchestration flow (feature-flagged and
    // community-only inside agent-flow). Slash text keeps the existing reply.
    if (!text.startsWith("/")) {
      const agentReply = await handleAgentGroupText({ user, text }, { repo: deps.repo });
      if (agentReply) {
        if (agentReply.buttons && agentReply.buttons.length > 0) {
          const keyboard = new InlineKeyboard();
          for (const button of agentReply.buttons) {
            keyboard.text(button.text, button.callbackData);
          }
          await ctx.reply(agentReply.text, { reply_markup: keyboard });
        } else {
          await ctx.reply(agentReply.text);
        }
        return;
      }
    }
    await ctx.reply(`${parsed.reason}\n\n${parsed.hint}`);
    return;
  }
  if (parsed.kind === "status") {
    const reply = await handleStatusInstruction(parsed.payoutId, deps.repo, {
      userId: user.userId,
      chatId: user.chatId,
    });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "judge_pay") {
    await renderJudgeReply(ctx, user, parsed, deps);
    return;
  }
  if (parsed.kind === "workspace_init") {
    const reply = await handleWorkspaceInit({ user, allowedDevUserIds }, { repo: deps.repo });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "member_add") {
    const reply = await handleMemberAdd(
      { user, targetUserId: parsed.telegramUserId, role: parsed.role },
      { repo: deps.repo },
    );
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "member_remove") {
    const reply = await handleMemberRemove(
      { user, targetUserId: parsed.telegramUserId },
      { repo: deps.repo },
    );
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "member_list") {
    const reply = await handleMemberList({ user }, { repo: deps.repo });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "recipient_add") {
    const reply = await handleRecipientAdd(
      { user, alias: parsed.alias, address: parsed.address },
      { repo: deps.repo },
    );
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "recipient_list") {
    const reply = await handleRecipientList({ user }, { repo: deps.repo });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "pay" || parsed.kind === "pay_alias") {
    const reply = await handleCommunityPayInstruction({ instruction: parsed, user }, { repo: deps.repo });
    if (reply.buttons && reply.buttons.length > 0) {
      const keyboard = new InlineKeyboard();
      for (const button of reply.buttons) {
        keyboard.text(button.text, button.callbackData);
      }
      await ctx.reply(reply.text, { reply_markup: keyboard });
    } else {
      await ctx.reply(reply.text);
    }
    return;
  }
  if (parsed.kind === "batch") {
    const reply = await handleCommunityBatchInstruction({ instruction: parsed, user }, { repo: deps.repo });
    if (reply.buttons && reply.buttons.length > 0) {
      const keyboard = new InlineKeyboard();
      for (const button of reply.buttons) {
        keyboard.text(button.text, button.callbackData);
      }
      await ctx.reply(reply.text, { reply_markup: keyboard });
    } else {
      await ctx.reply(reply.text);
    }
    return;
  }
  if (parsed.kind === "claim_pay") {
    const reply = await handleClaimPayInstruction({ instruction: parsed, user }, { repo: deps.repo });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "claim_status") {
    const reply = await handleClaimStatusInstruction({ claimId: parsed.claimId, user }, { repo: deps.repo });
    await ctx.reply(reply.text);
    return;
  }
  if (parsed.kind === "dashboard") {
    const reply = await handleDashboardInstruction({ user }, { repo: deps.repo });
    if (reply.buttonUrl !== null) {
      const keyboard = new InlineKeyboard().url("Open dashboard", reply.buttonUrl);
      await ctx.reply(reply.text, { reply_markup: keyboard });
    } else {
      await ctx.reply(reply.text);
    }
    return;
  }
}

async function renderJudgeReply(
  ctx: Context,
  user: TelegramUser,
  parsed: { kind: "judge_pay"; address: string; amount: string; token: "USDC" },
  deps: HandlerDeps,
): Promise<void> {
  const reply = await handleJudgePayInstruction({ instruction: parsed, user }, { repo: deps.repo });
  let sent: { chatId: string; messageId: number } | null = null;
  for (const message of reply.messages.length > 0 ? reply.messages : [reply.final]) {
    if (!sent) {
      const result = await ctx.reply(message);
      sent = { chatId: String(result.chat.id), messageId: result.message_id };
    } else {
      try {
        await ctx.api.editMessageText(sent.chatId, sent.messageId, message);
      } catch {
        const result = await ctx.reply(message);
        sent = { chatId: String(result.chat.id), messageId: result.message_id };
      }
    }
  }
  if (sent !== null && reply.messages.length > 0 && reply.final !== reply.messages[reply.messages.length - 1]) {
    try {
      await ctx.api.editMessageText(sent.chatId, sent.messageId, reply.final);
    } catch {
      await ctx.reply(reply.final);
    }
  }
}

export function getDbRepository(): PostgresRepository | null {
  return accessor.getDbRepository();
}

export function getTelegramBot(): Bot | null {
  const config = getTelegramConfig();
  if (!config.botToken) return null;
  const holder = globalThis as unknown as Record<symbol, Bot | undefined>;
  if (!holder[BOT]) {
    const repo = getDbRepository();
    if (!repo) return null;
    holder[BOT] = createTelegramBot(config.botToken, { repo });
  }
  return holder[BOT];
}
