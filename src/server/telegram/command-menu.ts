import type { Bot } from "grammy";

import {
  groupScopeCommands,
  privateScopeCommands,
  toTelegramCommands,
  validateCommands,
} from "./commands.ts";
import { redactSecrets, serializeBotError } from "./safe-logging.ts";

export type CommandMenuRegistration = {
  ok: boolean;
  errors: string[];
};

const PRIVATE_SCOPE = { type: "default" } as const;
const GROUP_SCOPE = { type: "all_group_chats" } as const;

type SetMyCommands = Pick<Bot, "api">["api"]["setMyCommands"];

/**
 * Registers the slash-command menu with Telegram once, at startup only —
 * never on incoming updates. Private chats (and the default fallback) get the
 * private-safe command set; group/community chats get the full set.
 *
 * Failures are logged sanitized (never the bot token) and reported so the
 * caller can surface "menu may be stale" without crashing the bot.
 */
export async function registerCommandMenu(
  bot: Pick<Bot, "api">,
  onError: (message: string, scope: string) => void = (message, scope) => {
    console.error(`${scope}: ${message}`);
  },
): Promise<CommandMenuRegistration> {
  const invariantErrors = validateCommands(groupScopeCommands());
  if (invariantErrors.length > 0) {
    for (const error of invariantErrors) {
      onError(redactSecrets(error), "invariants");
    }
    return { ok: false, errors: invariantErrors.map((error) => redactSecrets(error)) };
  }

  const errors: string[] = [];
  const attempts: Array<[string, Parameters<SetMyCommands>[1], Parameters<SetMyCommands>[0]]> = [
    ["private", PRIVATE_SCOPE as Parameters<SetMyCommands>[1], toTelegramCommands(privateScopeCommands()) as Parameters<SetMyCommands>[0]],
    ["group", GROUP_SCOPE as Parameters<SetMyCommands>[1], toTelegramCommands(groupScopeCommands()) as Parameters<SetMyCommands>[0]],
  ];

  for (const [scope, telegramScope, commands] of attempts) {
    try {
      await bot.api.setMyCommands(commands, telegramScope);
    } catch (error) {
      const message = serializeBotError(error, { action: `setMyCommands:${scope}` });
      onError(message, scope);
      errors.push(message);
    }
  }

  return { ok: errors.length === 0, errors };
}
