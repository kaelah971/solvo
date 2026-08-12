import type { Instruction, ParseResult, PayInstruction } from "./types.ts";

const ADDRESS = "(0x[0-9a-fA-F]{40})";
const AMOUNT = "(\\d+(?:\\.\\d+)?)";
const TOKEN = "(usdc)";
const ALIAS = "([a-z0-9][a-z0-9_-]{0,31})";

/** Telegram command token: latin letters/digits/underscore, optional @username. */
const COMMAND_TOKEN = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?/;

const PAY_COMMAND = new RegExp(`^\\/pay\\s+${ADDRESS}\\s+${AMOUNT}\\s+${TOKEN}\\s*$`, "i");
const PAY_COMMAND_NO_TOKEN = new RegExp(`^\\/pay\\s+${ADDRESS}\\s+${AMOUNT}\\s*$`, "i");

const NL_AMOUNT_FIRST = new RegExp(`^(?:send|pay)\\s+${AMOUNT}\\s+${TOKEN}\\s+to\\s+${ADDRESS}\\s*$`, "i");
const NL_ADDRESS_FIRST = new RegExp(`^(?:send|pay)\\s+${ADDRESS}\\s+${AMOUNT}\\s+${TOKEN}\\s*$`, "i");
const NL_ALIAS = new RegExp(`^(?:send|pay)\\s+${AMOUNT}\\s+${TOKEN}\\s+to\\s+${ALIAS}\\s*$`, "i");

const NEGATIVE_AMOUNT = /^(?:send|pay)\s+-\d/;
const LOOKS_LIKE_PAYMENT = /^(?:send|pay|transfer|give)\b/i;

function toPayInstruction(
  address: string,
  amount: string,
  token: string,
  sourceType: PayInstruction["sourceType"],
): ParseResult {
  if (token.toLowerCase() !== "usdc") {
    return {
      kind: "failure",
      reason: "Unsupported token.",
      hint: "Solvo executes Base USDC only. Use /pay <address> <amount> USDC.",
    };
  }
  return {
    kind: "pay",
    address,
    amount,
    token: "USDC",
    sourceType,
  };
}

function unsupportedTokenHint(): ParseResult {
  return {
    kind: "failure",
    reason: "Unsupported token.",
    hint: "Solvo executes Base USDC only. Use /pay <address> <amount> USDC.",
  };
}

function needsAddressHint(): ParseResult {
  return {
    kind: "failure",
    reason: "I need an explicit wallet address for this payment.",
    hint: "Use /pay <address> <amount> USDC.",
  };
}

function unknownCommandResult(): ParseResult {
  return {
    kind: "failure",
    reason: "Unknown command.",
    hint: "Supported commands: /start, /help, /pay, /batch, /status, /workspace, /member, /recipient.",
  };
}

/**
 * Centralized handling for Telegram's group-chat addressed commands, e.g.
 * `/batch@SolvoAgentBot`. Telegram's command picker inserts the bot's
 * username into the command token; every command must also be recognized in
 * that addressed form, and commands addressed to OTHER bots must never be
 * treated as ours.
 *
 * Semantics mirror grammY's `bot.command` matcher:
 *  - the command name keeps its case (matched case-sensitively downstream);
 *  - the username after `@` is compared case-insensitively (Telegram
 *    usernames are case-insensitive);
 *  - a command addressed to a different bot is rejected;
 *  - only the FIRST token (the command) is touched — arguments and multiline
 *    bodies pass through untouched.
 */
export type AddressedCommandResult = { rejected: true } | { rejected: false; text: string };

export function normalizeAddressedCommand(text: string, botUsername: string | null): AddressedCommandResult {
  if (!text.startsWith("/")) return { rejected: false, text };
  const match = COMMAND_TOKEN.exec(text);
  if (!match || !match[2]) return { rejected: false, text };
  const target = match[2];
  if (botUsername && target.toLowerCase() === botUsername.toLowerCase()) {
    const suffix = "@" + target;
    const index = text.indexOf(suffix);
    return { rejected: false, text: text.slice(0, index) + text.slice(index + suffix.length) };
  }
  return { rejected: true };
}

export function parseInstruction(text: string, options: { botUsername?: string | null } = {}): ParseResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { kind: "failure", reason: "Empty instruction.", hint: "Use /pay <address> <amount> USDC." };
  }

  const addressed = normalizeAddressedCommand(trimmed, options.botUsername ?? null);
  if (addressed.rejected) {
    return unknownCommandResult();
  }
  const subject = addressed.text;

  if (subject === "/start" || subject.startsWith("/start ")) {
    return { kind: "start" };
  }
  if (subject === "/help" || subject.startsWith("/help ")) {
    return { kind: "help" };
  }
  if (subject === "/status") {
    return {
      kind: "failure",
      reason: "Missing payout ID.",
      hint: "Use /status <payout_id> to inspect a payment.",
    };
  }
  const statusMatch = /^\/status\s+(\S+)\s*$/.exec(subject);
  if (statusMatch) {
    return { kind: "status", payoutId: statusMatch[1] };
  }

  if (subject === "/workspace init" || /^\/workspace\s+init\s*$/.test(subject)) {
    return { kind: "workspace_init" };
  }
  if (/^\/workspace\b/.test(subject)) {
    return {
      kind: "failure",
      reason: "Unknown workspace command.",
      hint: "Supported command: /workspace init.",
    };
  }

  const memberAdd = /^\/member\s+add\s+(\d+)(?:\s+(owner|approver|member))?\s*$/i.exec(subject);
  if (memberAdd) {
    return {
      kind: "member_add",
      telegramUserId: memberAdd[1],
      role: (memberAdd[2] ?? "member").toLowerCase() as "member" | "approver" | "owner",
    };
  }
  const memberAddUsername = /^\/member\s+add\s+@[A-Za-z0-9_]{3,32}(?:\s+(owner|approver|member))?\s*$/i.exec(subject);
  if (memberAddUsername) {
    return {
      kind: "failure",
      reason: "Usernames cannot authorize actions.",
      hint: "Provide the numeric Telegram ID, e.g. /member add 123456789 member.",
    };
  }
  const memberRemove = /^\/member\s+remove\s+(\d+)\s*$/.exec(subject);
  if (memberRemove) {
    return { kind: "member_remove", telegramUserId: memberRemove[1] };
  }
  if (/^\/member\s+list\s*$/.test(subject)) {
    return { kind: "member_list" };
  }
  if (/^\/member\b/.test(subject)) {
    return {
      kind: "failure",
      reason: "Unknown member command.",
      hint: "Use /member add <numeric_id> [member|approver], /member remove <numeric_id>, or /member list.",
    };
  }

  const recipientAdd = new RegExp(`^\\/recipient\\s+add\\s+${ALIAS}\\s+${ADDRESS}\\s*$`, "i").exec(subject);
  if (recipientAdd) {
    return {
      kind: "recipient_add",
      alias: recipientAdd[1],
      address: recipientAdd[2],
    };
  }
  if (/^\/recipient\s+list\s*$/.test(subject)) {
    return { kind: "recipient_list" };
  }
  if (/^\/recipient\b/.test(subject)) {
    return {
      kind: "failure",
      reason: "Unknown recipient command.",
      hint: "Use /recipient add <alias> <0x...> or /recipient list.",
    };
  }

  const command = PAY_COMMAND.exec(subject);
  if (command) {
    return toPayInstruction(command[1], command[2], command[3], "telegram_command");
  }
  const commandNoToken = PAY_COMMAND_NO_TOKEN.exec(subject);
  if (commandNoToken) {
    return unsupportedTokenHint();
  }

  const judgePay = new RegExp(`^\\/judgepay\\s+${ADDRESS}\\s+${AMOUNT}\\s+${TOKEN}\\s*$`, "i").exec(subject);
  if (judgePay) {
    if (judgePay[3].toLowerCase() !== "usdc") {
      return unsupportedTokenHint();
    }
    return {
      kind: "judge_pay",
      address: judgePay[1],
      amount: judgePay[2],
      token: "USDC",
    };
  }
  if (/^\/judgepay\s*$/.test(subject) || /^\/judgepay\s+/.test(subject)) {
    return {
      kind: "failure",
      reason: "Invalid judge payment command.",
      hint: "Use /judgepay <address> <amount> USDC, for example: /judgepay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.01 USDC",
    };
  }

  const claimPay = new RegExp(`^\\/claimpay\\s+${AMOUNT}\\s+${TOKEN}\\s*$`, "i").exec(subject);
  if (claimPay) {
    return {
      kind: "claim_pay",
      amount: claimPay[1],
      token: "USDC",
    };
  }
  if (/^\/claimpay\s*$/.test(subject) || /^\/claimpay\s+/.test(subject)) {
    return {
      kind: "failure",
      reason: "Invalid claim command.",
      hint: "Use /claimpay <amount> USDC, for example: /claimpay 0.05 USDC. Base USDC only.",
    };
  }

  const batchMatch = /^\/batch\s*\n([\s\S]*)$/.exec(subject);
  if (batchMatch) {
    if (batchMatch[1].trim().length === 0) {
      return {
        kind: "failure",
        reason: "The batch is empty.",
        hint: "Add one recipient per line, e.g.: /batch\nalice 0.01 USDC\nbob 0.02 USDC",
      };
    }
    return { kind: "batch", body: batchMatch[1] };
  }
  const batchInline = /^\/batch(?:\s+([\s\S]*))?$/.exec(subject);
  if (batchInline && batchInline[1] !== undefined) {
    return { kind: "batch", body: batchInline[1] };
  }
  if (subject === "/batch") {
    return {
      kind: "failure",
      reason: "The batch is empty.",
      hint: "Add one recipient per line, e.g.: /batch\nalice 0.01 USDC\nbob 0.02 USDC",
    };
  }

  if (subject.startsWith("/")) {
    return unknownCommandResult();
  }

  if (NEGATIVE_AMOUNT.test(subject)) {
    return {
      kind: "failure",
      reason: "Amount must be greater than zero.",
      hint: "Use /pay <address> <amount> USDC.",
    };
  }

  const nlAlias = NL_ALIAS.exec(subject);
  if (nlAlias) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(nlAlias[3])) {
      return needsAddressHint();
    }
    return {
      kind: "pay_alias",
      alias: nlAlias[3],
      amount: nlAlias[1],
      token: "USDC",
      sourceType: "telegram_natural_language",
    };
  }

  const nlAmountFirst = NL_AMOUNT_FIRST.exec(subject);
  if (nlAmountFirst) {
    return toPayInstruction(nlAmountFirst[3], nlAmountFirst[1], nlAmountFirst[2], "telegram_natural_language");
  }
  const nlAddressFirst = NL_ADDRESS_FIRST.exec(subject);
  if (nlAddressFirst) {
    return toPayInstruction(nlAddressFirst[1], nlAddressFirst[2], nlAddressFirst[3], "telegram_natural_language");
  }

  if (LOOKS_LIKE_PAYMENT.test(subject)) {
    if (/0x[0-9a-fA-F]{40}/.test(subject)) {
      return {
        kind: "failure",
        reason: "I could not parse the payment instruction.",
        hint: "Use /pay <address> <amount> USDC, for example: /pay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.01 USDC",
      };
    }
    return needsAddressHint();
  }

  return {
    kind: "failure",
    reason: "I did not understand that instruction.",
    hint: "Use /pay <address> <amount> USDC, or /help to see what I can do.",
  };
}

export type { Instruction, ParseResult };
