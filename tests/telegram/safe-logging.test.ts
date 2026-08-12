import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSecrets, serializeBotError } from "../../src/server/telegram/safe-logging.ts";

const FAKE_TOKEN = "1234567890:AAHfakefakefakefakefakefakefakefakefakefakefakefake";

describe("redactSecrets", () => {
  it("redacts the exact configured TELEGRAM_BOT_TOKEN value", () => {
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    try {
      const output = redactSecrets(`request failed with token ${FAKE_TOKEN} in the payload`);
      assert.doesNotMatch(output, new RegExp(FAKE_TOKEN));
      assert.match(output, /\[REDACTED\]/);
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });

  it("redacts any string matching the Telegram bot-token shape", () => {
    const tokenShaped = "9876543210:" + "A".repeat(35);
    assert.match(tokenShaped, /\d{8,10}:[A-Za-z0-9_-]{35}/);
    const output = redactSecrets(`error: token="${tokenShaped}" inside the log`);
    assert.doesNotMatch(output, new RegExp(tokenShaped));
    assert.match(output, /\[REDACTED:BOT_TOKEN\]/);
  });

  it("redacts bearer tokens, database URLs and KeeperHub keys", () => {
    const output = redactSecrets(
      "Authorization: Bearer sk-live-abcdef12345 | postgres://user:pass@host:5432/db | kh_orgsecretkey123",
    );
    assert.doesNotMatch(output, /sk-live-abcdef12345/);
    assert.doesNotMatch(output, /user:pass/);
    assert.doesNotMatch(output, /kh_orgsecretkey123/);
    assert.match(output, /Bearer \[REDACTED\]/);
    assert.match(output, /postgres:\/\/\[REDACTED\]/);
  });

  it("keeps legitimate proof values (tx hashes, execution ids) intact", () => {
    const output = redactSecrets(
      "tx 0x2b16b9e9ddd541f10e803a4030c40b4845b22fdd34ee0754e9289e47ab179463 execution zh56o2bm327e2xwpzjmkx",
    );
    assert.match(output, /0x2b16b9e9ddd541f10e803a4030c40b4845b22fdd34ee0754e9289e47ab179463/);
    assert.match(output, /zh56o2bm327e2xwpzjmkx/);
  });
});

describe("serializeBotError", () => {
  it("emits only sanitized scalar fields, never the context object", () => {
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    try {
      const apiError = Object.assign(new Error("query is too old and response timeout expired or query ID is invalid"), {
        error_code: 400,
        description: "Bad Request: query is too old and response timeout expired or query ID is invalid",
        method: "answerCallbackQuery",
      });
      const output = serializeBotError(apiError, { updateId: 42, action: "approve", payoutId: "abc-123" });
      assert.match(output, /query is too old/);
      assert.match(output, /error_code: 400/);
      assert.match(output, /method: answerCallbackQuery/);
      assert.match(output, /update_id: 42/);
      assert.match(output, /callback_action: approve/);
      assert.match(output, /payout_id: abc-123/);
      assert.doesNotMatch(output, new RegExp(FAKE_TOKEN));
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });

  it("redacts a token that appears inside an error message or stack", () => {
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    try {
      const error = new Error(`connection failed for token ${FAKE_TOKEN}`);
      error.stack = `Error: connection failed for token ${FAKE_TOKEN}\n    at fake.js:1:1`;
      const output = serializeBotError(error, {});
      assert.doesNotMatch(output, new RegExp(FAKE_TOKEN));
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });

  it("never serializes a context-like object with an api token field", () => {
    const previous = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
    try {
      const ctxLike = {
        api: { token: FAKE_TOKEN },
        update: { update_id: 7 },
      };
      const error = new Error("boom");
      const output = serializeBotError(error, { updateId: ctxLike.update.update_id });
      assert.doesNotMatch(output, new RegExp(FAKE_TOKEN));
      assert.match(output, /update_id: 7/);
      assert.doesNotMatch(output, /ctx|api:/);
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = previous;
    }
  });
});
