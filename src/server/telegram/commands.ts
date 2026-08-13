/**
 * Single source of truth for the Telegram slash-command menu.
 *
 * Rules:
 * - a command MUST NOT appear here before its implementation is live
 * - a command MUST NOT be registered in Telegram before it is implemented
 * - Telegram constraints: names are 1-32 chars, lowercase a-z0-9_ (no leading
 *   slash); descriptions are 1-256 chars
 */

export type CommandScope = "all" | "community";

export type SolvoCommand = {
  name: string;
  description: string;
  /** "all" = available everywhere; "community" = group/community chats only */
  scope: CommandScope;
};

export const SOLVO_COMMANDS: readonly SolvoCommand[] = [
  { name: "start", description: "Start Solvo", scope: "all" },
  { name: "help", description: "Show available commands", scope: "all" },
  { name: "pay", description: "Create a payment request", scope: "all" },
  { name: "status", description: "Check a payout status", scope: "all" },
  { name: "judgepay", description: "Judge payment (authorized judges only)", scope: "all" },
  { name: "workspace", description: "Manage community workspace", scope: "community" },
  { name: "member", description: "Manage workspace members", scope: "community" },
  { name: "recipient", description: "Manage saved recipients", scope: "community" },
  { name: "batch", description: "Create a batch payout", scope: "community" },
  { name: "claimpay", description: "Create a one-time claim link", scope: "community" },
  { name: "claimstatus", description: "Check a claim link status", scope: "community" },
];

export const COMMAND_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;
export const COMMAND_DESCRIPTION_MAX = 256;

/** Commands safe for every chat (private chats, channels, fallback scope). */
export function privateScopeCommands(): readonly SolvoCommand[] {
  return SOLVO_COMMANDS.filter((command) => command.scope === "all");
}

/** Commands for group/community chats: everything implemented. */
export function groupScopeCommands(): readonly SolvoCommand[] {
  return SOLVO_COMMANDS;
}

export type TelegramBotCommand = {
  command: string;
  description: string;
};

/** Telegram-ready payload ({command, description} objects). */
export function toTelegramCommands(commands: readonly SolvoCommand[]): TelegramBotCommand[] {
  return commands.map((command) => ({
    command: command.name,
    description: command.description,
  }));
}

/**
 * Shared line formatter used by both the Telegram menu and /help so the two
 * can never drift.
 */
export function formatCommandLines(commands: readonly SolvoCommand[]): string[] {
  return commands.map((command) => `/${command.name.padEnd(11)} ${command.description}`);
}

/**
 * Dev-time invariant checks. `npm test` exercises these so a command added to
 * the menu before Telegram would accept it fails fast.
 */
export function validateCommands(commands: readonly SolvoCommand[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    if (!COMMAND_NAME_PATTERN.test(command.name)) {
      errors.push(`command name "${command.name}" is not Telegram-valid (lowercase a-z0-9_, 1-32 chars)`);
    }
    if (seen.has(command.name)) {
      errors.push(`duplicate command name "${command.name}"`);
    }
    seen.add(command.name);
    if (command.description.trim().length === 0) {
      errors.push(`command "${command.name}" has an empty description`);
    }
    if (command.description.length > COMMAND_DESCRIPTION_MAX) {
      errors.push(`command "${command.name}" description exceeds ${COMMAND_DESCRIPTION_MAX} chars`);
    }
  }
  return errors;
}
