import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bot } from "grammy";

import {
  formatCommandLines,
  groupScopeCommands,
  privateScopeCommands,
  SOLVO_COMMANDS,
  toTelegramCommands,
  validateCommands,
} from "../../src/server/telegram/commands.ts";
import { registerCommandMenu } from "../../src/server/telegram/command-menu.ts";
import { helpMessage } from "../../src/server/telegram/messages.ts";

type FakeBot = Pick<Bot, "api">;

const IMPLEMENTED = ["start", "help", "pay", "status", "judgepay", "workspace", "member", "recipient", "batch", "claimpay", "claimstatus"];
const DEFERRED = ["distribute", "send", "claim", "judge", "withdraw", "limits", "admin"];

describe("command source of truth", () => {
  it("contains exactly the currently implemented commands", () => {
    const names = SOLVO_COMMANDS.map((command) => command.name);
    assert.deepEqual([...names].sort(), [...IMPLEMENTED].sort());
    for (const deferred of DEFERRED) {
      assert.ok(!names.includes(deferred), `deferred command /${deferred} must not be registered`);
    }
  });

  it("has no duplicate command names", () => {
    const names = SOLVO_COMMANDS.map((command) => command.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(validateCommands(SOLVO_COMMANDS), []);
  });

  it("uses lowercase Telegram-valid names", () => {
    for (const command of SOLVO_COMMANDS) {
      assert.match(command.name, /^[a-z0-9_]{1,32}$/);
    }
  });

  it("uses non-empty descriptions within Telegram limits", () => {
    for (const command of SOLVO_COMMANDS) {
      assert.ok(command.description.trim().length > 0);
      assert.ok(command.description.length <= 256);
      assert.ok(!command.description.includes("\n"));
    }
  });
});

describe("scoped command menus", () => {
  it("private scope contains only private-safe commands", () => {
    const names = privateScopeCommands().map((command) => command.name);
    assert.deepEqual([...names].sort(), ["help", "judgepay", "pay", "start", "status"]);
    for (const communityOnly of ["workspace", "member", "recipient", "batch", "claimpay", "claimstatus"]) {
      assert.ok(!names.includes(communityOnly), `/${communityOnly} must not appear in private chats`);
    }
  });

  it("group scope contains the full community command set", () => {
    const names = groupScopeCommands().map((command) => command.name);
    assert.deepEqual([...names].sort(), [...IMPLEMENTED].sort());
  });

  it("registers the default scope as private-safe and groups with the full set", async () => {
    const calls: Array<{ commands: Array<{ command: string }>; scope: unknown }> = [];
    const fakeApi = {
      setMyCommands: async (commands: unknown, scope?: unknown) => {
        calls.push({ commands: commands as Array<{ command: string }>, scope });
        return { ok: true };
      },
    };
    const result = await registerCommandMenu({ api: fakeApi } as unknown as FakeBot);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].scope, { type: "default" });
    const privateNames = calls[0].commands.map((command) => command.command);
    assert.ok(!privateNames.includes("batch"));
    assert.deepEqual(calls[1].scope, { type: "all_group_chats" });
    const groupNames = calls[1].commands.map((command) => command.command);
    assert.ok(groupNames.includes("batch"));
    assert.ok(groupNames.includes("workspace"));
  });
});

describe("/help synchronization", () => {
  it("derives the command list from the single source of truth", () => {
    const help = helpMessage();
    for (const command of SOLVO_COMMANDS) {
      assert.match(help, new RegExp(`/${command.name}\\b`), `help must list /${command.name}`);
      assert.ok(help.includes(command.description), `help must carry the description of /${command.name}`);
    }
    const formatted = formatCommandLines(SOLVO_COMMANDS).map((line) => "  " + line);
    for (const line of formatted) {
      assert.ok(help.includes(line), `help must contain the shared formatted line: ${line.trim()}`);
    }
  });

  it("keeps the richer explanatory sections", () => {
    const help = helpMessage();
    assert.match(help, /SANDBOX/);
    assert.match(help, /DEVELOPMENT/);
    assert.match(help, /COMMUNITY/);
    assert.match(help, /Natural language/);
  });
});

describe("command registration failure handling", () => {
  it("sanitizes errors and never exposes the bot token", async () => {
    const FAKE_TOKEN = "1234567890:AAHfakefakefakefakefakefakefakefakefakefakefakefake";
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    try {
      const logged: string[] = [];
      const fakeApi = {
        setMyCommands: async () => {
          const error = Object.assign(new Error(`network failure with token ${FAKE_TOKEN}`), {
            error_code: 400,
            description: "Bad Request: commands list is invalid",
            method: "setMyCommands",
          });
          throw error;
        },
      };
      const result = await registerCommandMenu({ api: fakeApi } as unknown as FakeBot, (message) => {
        logged.push(message);
      });
      assert.equal(result.ok, false);
      assert.equal(result.errors.length, 2);
      for (const entry of [...logged, ...result.errors]) {
        assert.ok(!entry.includes(FAKE_TOKEN), "token leaked into a logged/returned error");
      }
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });

  it("does not crash bot startup when registration fails", async () => {
    const bot = {
      api: {
        setMyCommands: async () => {
          throw new Error("query is too old and response timeout expired or query ID is invalid");
        },
      },
    };
    const result = await registerCommandMenu(bot as unknown as FakeBot);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
  });

  it("produces Telegram-ready command payloads", () => {
    const payload = toTelegramCommands(SOLVO_COMMANDS);
    for (const entry of payload) {
      assert.equal(typeof entry.command, "string");
      assert.equal(typeof entry.description, "string");
      assert.match(entry.command, /^[a-z0-9_]{1,32}$/);
    }
  });
});


