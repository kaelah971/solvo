import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeAddressedCommand, parseInstruction } from "../../src/server/telegram/parsing.ts";

const ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

describe("parseInstruction", () => {
  it("parses a valid /pay command", () => {
    const result = parseInstruction(`/pay ${ADDRESS} 0.01 USDC`);
    assert.equal(result.kind, "pay");
    if (result.kind === "pay") {
      assert.equal(result.address, ADDRESS);
      assert.equal(result.amount, "0.01");
      assert.equal(result.token, "USDC");
      assert.equal(result.sourceType, "telegram_command");
    }
  });

  it("accepts lowercase token in /pay", () => {
    const result = parseInstruction(`/pay ${ADDRESS} 0.01 usdc`);
    assert.equal(result.kind, "pay");
  });

  it("rejects /pay with an invalid address shape", () => {
    const result = parseInstruction("/pay 0x123 0.01 USDC");
    assert.equal(result.kind, "failure");
  });

  it("parses a slash alias payment: /pay <alias> <amount> USDC", () => {
    const result = parseInstruction("/pay blossom 0.01 USDC");
    assert.equal(result.kind, "pay_alias");
    if (result.kind === "pay_alias") {
      assert.equal(result.alias, "blossom");
      assert.equal(result.amount, "0.01");
      assert.equal(result.token, "USDC");
      assert.equal(result.sourceType, "telegram_command");
    }
  });

  it("parses the addressed alias form /pay@SolvoAgentBot <alias> <amount> USDC", () => {
    const opts = { botUsername: "SolvoAgentBot" };
    const result = parseInstruction("/pay@SolvoAgentBot blossom 0.01 USDC", opts);
    assert.equal(result.kind, "pay_alias");
    if (result.kind === "pay_alias") {
      assert.equal(result.alias, "blossom");
      assert.equal(result.amount, "0.01");
    }
  });

  it("accepts mixed-case aliases and lowercase tokens in slash alias pay", () => {
    const upper = parseInstruction("/pay Blossom 0.01 USDC");
    assert.equal(upper.kind, "pay_alias");
    if (upper.kind === "pay_alias") assert.equal(upper.alias, "Blossom");
    const lowerToken = parseInstruction("/pay blossom 0.01 usdc");
    assert.equal(lowerToken.kind, "pay_alias");
  });

  it("rejects slash alias pay with a missing or unsupported token", () => {
    const missing = parseInstruction("/pay blossom 0.01");
    assert.equal(missing.kind, "failure");
    const eth = parseInstruction("/pay blossom 0.01 ETH");
    assert.equal(eth.kind, "failure");
  });

  it("never treats an address as an alias in slash pay", () => {
    const result = parseInstruction(`/pay ${ADDRESS} 0.01 USDC`);
    assert.equal(result.kind, "pay");
    if (result.kind === "pay") assert.equal(result.address, ADDRESS);
  });

  it("rejects zero and negative amounts", () => {
    const zero = parseInstruction(`/pay ${ADDRESS} 0 USDC`);
    assert.equal(zero.kind, "pay");
    const negative = parseInstruction(`/pay ${ADDRESS} -0.01 USDC`);
    assert.equal(negative.kind, "failure");
  });

  it("rejects unsupported tokens", () => {
    const eth = parseInstruction(`/pay ${ADDRESS} 0.01 ETH`);
    assert.equal(eth.kind, "failure");
    const missing = parseInstruction(`/pay ${ADDRESS} 0.01`);
    assert.equal(missing.kind, "failure");
  });

  it("rejects amounts above the cap in /pay", () => {
    const result = parseInstruction(`/pay ${ADDRESS} 0.11 USDC`);
    assert.equal(result.kind, "pay");
    if (result.kind === "pay") assert.equal(result.amount, "0.11");
  });

  it("parses natural-language forms", () => {
    const forms = [
      `Send 0.01 USDC to ${ADDRESS}`,
      `Pay ${ADDRESS} 0.01 USDC`,
      `send 0.05 usdc to ${ADDRESS}`,
      `pay ${ADDRESS} 0.01 usdc`,
    ];
    for (const form of forms) {
      const result = parseInstruction(form);
      assert.equal(result.kind, "pay", `expected parse for: ${form}`);
      if (result.kind === "pay") {
        assert.equal(result.token, "USDC");
        assert.equal(result.sourceType, "telegram_natural_language");
      }
    }
  });

  it("rejects username-only recipients", () => {
    for (const text of ["Pay Alex 5 USDC", "Send 5 USDC to Alex", "pay @alex 0.01 USDC"]) {
      const result = parseInstruction(text);
      assert.equal(result.kind, "failure", `expected failure for: ${text}`);
      if (result.kind === "failure") {
        assert.match(result.hint, /explicit wallet address|Use \/pay/);
      }
    }
  });

  it("rejects ambiguous instructions and asks for /pay", () => {
    const result = parseInstruction("Send money to my friend");
    assert.equal(result.kind, "failure");
    if (result.kind === "failure") assert.match(result.hint, /\/pay/);
  });

  it("parses /status with an id", () => {
    const result = parseInstruction("/status some-payout-id");
    assert.equal(result.kind, "status");
    if (result.kind === "status") assert.equal(result.payoutId, "some-payout-id");
  });

  it("handles /status without an id", () => {
    const result = parseInstruction("/status");
    assert.equal(result.kind, "failure");
  });

  it("parses /start and /help", () => {
    assert.equal(parseInstruction("/start").kind, "start");
    assert.equal(parseInstruction("/help").kind, "help");
  });

  it("rejects unknown commands", () => {
    const result = parseInstruction("/distribute");
    assert.equal(result.kind, "failure");
  });

  it("rejects empty input", () => {
    assert.equal(parseInstruction("").kind, "failure");
  });
});

describe("M4 community commands", () => {
  it("parses /workspace init", () => {
    assert.equal(parseInstruction("/workspace init").kind, "workspace_init");
    assert.equal(parseInstruction("/workspace init ").kind, "workspace_init");
  });

  it("rejects unknown workspace subcommands", () => {
    const result = parseInstruction("/workspace rename Treasury");
    assert.equal(result.kind, "failure");
  });

  it("parses /member add with explicit and default roles", () => {
    const withRole = parseInstruction("/member add 123456789 approver");
    assert.equal(withRole.kind, "member_add");
    if (withRole.kind === "member_add") {
      assert.equal(withRole.telegramUserId, "123456789");
      assert.equal(withRole.role, "approver");
    }
    const defaultRole = parseInstruction("/member add 987654321");
    assert.equal(defaultRole.kind, "member_add");
    if (defaultRole.kind === "member_add") assert.equal(defaultRole.role, "member");
  });

  it("rejects usernames in /member add", () => {
    const result = parseInstruction("/member add @alex member");
    assert.equal(result.kind, "failure");
    if (result.kind === "failure") assert.match(result.hint, /numeric Telegram ID/);
  });

  it("parses /member remove and /member list", () => {
    const remove = parseInstruction("/member remove 123456789");
    assert.equal(remove.kind, "member_remove");
    const list = parseInstruction("/member list");
    assert.equal(list.kind, "member_list");
  });

  it("parses /recipient add and /recipient list", () => {
    const add = parseInstruction("/recipient add alice 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486");
    assert.equal(add.kind, "recipient_add");
    if (add.kind === "recipient_add") {
      assert.equal(add.alias, "alice");
      assert.equal(add.address, "0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486");
    }
    const list = parseInstruction("/recipient list");
    assert.equal(list.kind, "recipient_list");
  });

  it("parses lowercase alias natural language and rejects capitalized names", () => {
    const alias = parseInstruction("Send 5 USDC to alice");
    assert.equal(alias.kind, "pay_alias");
    if (alias.kind === "pay_alias") assert.equal(alias.alias, "alice");
    assert.equal(parseInstruction("Send 5 USDC to Alice").kind, "failure");
    assert.equal(parseInstruction("pay 5 usdc to @alice").kind, "failure");
  });
});

describe("addressed commands (@SolvoAgentBot)", () => {
  const BOT = "SolvoAgentBot";
  const opts = { botUsername: BOT };

  it("routes every implemented command with @SolvoAgentBot exactly like the plain form", () => {
    const pairs: Array<[string, string]> = [
      ["/start", "/start@SolvoAgentBot"],
      ["/help", "/help@SolvoAgentBot"],
      [`/pay ${ADDRESS} 0.01 USDC`, `/pay@SolvoAgentBot ${ADDRESS} 0.01 USDC`],
      ["/status some-payout-id", "/status@SolvoAgentBot some-payout-id"],
      ["/workspace init", "/workspace@SolvoAgentBot init"],
      ["/member add 123456789 approver", "/member@SolvoAgentBot add 123456789 approver"],
      ["/member remove 123456789", "/member@SolvoAgentBot remove 123456789"],
      ["/member list", "/member@SolvoAgentBot list"],
      [
        "/recipient add alice 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
        "/recipient@SolvoAgentBot add alice 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486",
      ],
      ["/recipient list", "/recipient@SolvoAgentBot list"],
      ["/batch\nalice 0.01 USDC\nbob 0.02 USDC", "/batch@SolvoAgentBot\nalice 0.01 USDC\nbob 0.02 USDC"],
    ];
    for (const [plain, addressed] of pairs) {
      assert.deepEqual(parseInstruction(addressed, opts), parseInstruction(plain), `addressed differs: ${addressed}`);
    }
  });

  it("keeps command arguments intact after normalization", () => {
    const status = parseInstruction("/status@SolvoAgentBot some-payout-id", opts);
    assert.equal(status.kind, "status");
    if (status.kind === "status") assert.equal(status.payoutId, "some-payout-id");

    const pay = parseInstruction(`/pay@SolvoAgentBot ${ADDRESS} 0.01 USDC`, opts);
    assert.equal(pay.kind, "pay");
    if (pay.kind === "pay") {
      assert.equal(pay.address, ADDRESS);
      assert.equal(pay.amount, "0.01");
      assert.equal(pay.token, "USDC");
      assert.equal(pay.sourceType, "telegram_command");
    }

    const member = parseInstruction("/member@SolvoAgentBot add 987654321 owner", opts);
    assert.equal(member.kind, "member_add");
    if (member.kind === "member_add") {
      assert.equal(member.telegramUserId, "987654321");
      assert.equal(member.role, "owner");
    }
  });

  it("preserves a multiline /batch@SolvoAgentBot body intact", () => {
    const body = "endurance 0.01 USDC\nblossom 0.02 USDC\n0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.01 USDC";
    const result = parseInstruction(`/batch@SolvoAgentBot\n${body}`, opts);
    assert.equal(result.kind, "batch");
    if (result.kind === "batch") assert.equal(result.body, body);
  });

  it("matches username case-insensitively (Telegram username semantics)", () => {
    assert.equal(parseInstruction("/batch@solvoagentbot\nalice 0.01 USDC", opts).kind, "batch");
    assert.equal(parseInstruction("/batch@SOLVOAGENTBOT\nalice 0.01 USDC", opts).kind, "batch");
    assert.equal(parseInstruction("/status@SolVoAgEnTbOt xyz", opts).kind, "status");
  });

  it("keeps command-name case behavior (grammY matches names case-sensitively)", () => {
    assert.equal(parseInstruction("/BATCH@SolvoAgentBot\nalice 0.01 USDC", opts).kind, "failure");
    assert.equal(parseInstruction("/Start@SolvoAgentBot", opts).kind, "failure");
    assert.equal(parseInstruction(`/Pay@SolvoAgentBot ${ADDRESS} 0.01 USDC`, opts).kind, "pay");
  });

  it("rejects commands addressed to another bot", () => {
    for (const text of [
      "/batch@SomeOtherBot\nalice 0.01 USDC",
      `/pay@SomeOtherBot ${ADDRESS} 0.01 USDC`,
      "/status@SomeOtherBot abc",
      "/start@SomeOtherBot",
    ]) {
      const result = parseInstruction(text, opts);
      assert.equal(result.kind, "failure", `expected failure for: ${text}`);
      if (result.kind === "failure") {
        assert.equal(result.reason, "Unknown command.");
        assert.match(result.hint, /Supported commands/);
      }
    }
  });

  it("rejects addressed commands when the bot username is unknown", () => {
    const result = parseInstruction("/batch@SomeOtherBot\nalice 0.01 USDC");
    assert.equal(result.kind, "failure");
    const ours = parseInstruction("/batch@SolvoAgentBot\nalice 0.01 USDC");
    assert.equal(ours.kind, "failure");
  });

  it("keeps plain commands and natural language working when a username is known", () => {
    assert.equal(parseInstruction("/batch\nalice 0.01 USDC", opts).kind, "batch");
    assert.equal(parseInstruction(`/pay ${ADDRESS} 0.01 USDC`, opts).kind, "pay");
    const nl = parseInstruction(`Send 0.01 USDC to ${ADDRESS}`, opts);
    assert.equal(nl.kind, "pay");
    if (nl.kind === "pay") assert.equal(nl.sourceType, "telegram_natural_language");
    assert.equal(parseInstruction("Send 5 USDC to alice", opts).kind, "pay_alias");
  });

  it("does not alter non-command text and is idempotent (no duplicate parse path)", () => {
    const plain = parseInstruction("/batch\nalice 0.01 USDC\nbob 0.02 USDC");
    const addressed = parseInstruction("/batch@SolvoAgentBot\nalice 0.01 USDC\nbob 0.02 USDC", opts);
    assert.deepEqual(addressed, plain);
    const again = normalizeAddressedCommand("/batch@SolvoAgentBot\nalice 0.01 USDC\nbob 0.02 USDC", BOT);
    if (again.rejected) {
      assert.fail("normalization rejected the bot's own addressed command");
    }
    const againText = again.text;
    const once = normalizeAddressedCommand(againText, BOT);
    assert.deepEqual(once, again);
    const natural = normalizeAddressedCommand("Send 5 USDC to @alex", BOT);
    assert.deepEqual(natural, { rejected: false, text: "Send 5 USDC to @alex" });
  });
});

describe("judgepay parsing", () => {
  it("parses a valid /judgepay command", () => {
    const result = parseInstruction(`/judgepay ${ADDRESS} 0.01 USDC`);
    assert.equal(result.kind, "judge_pay");
    if (result.kind === "judge_pay") {
      assert.equal(result.address, ADDRESS);
      assert.equal(result.amount, "0.01");
      assert.equal(result.token, "USDC");
    }
  });

  it("accepts lowercase token and mixed-case address", () => {
    const result = parseInstruction(`/judgepay ${ADDRESS} 0.01 usdc`);
    assert.equal(result.kind, "judge_pay");
  });

  it("supports the addressed form", () => {
    const plain = parseInstruction(`/judgepay ${ADDRESS} 0.01 USDC`);
    const addressed = parseInstruction(`/judgepay@SolvoAgentBot ${ADDRESS} 0.01 USDC`, {
      botUsername: "SolvoAgentBot",
    });
    assert.deepEqual(addressed, plain);
  });

  it("rejects invalid addresses", () => {
    const result = parseInstruction("/judgepay 0x123 0.01 USDC");
    assert.equal(result.kind, "failure");
  });

  it("rejects zero and negative amounts", () => {
    const zero = parseInstruction(`/judgepay ${ADDRESS} 0 USDC`);
    assert.equal(zero.kind, "judge_pay");
    const negative = parseInstruction(`/judgepay ${ADDRESS} -0.01 USDC`);
    assert.equal(negative.kind, "failure");
  });

  it("rejects unsupported tokens", () => {
    const eth = parseInstruction(`/judgepay ${ADDRESS} 0.01 ETH`);
    assert.equal(eth.kind, "failure");
    const missing = parseInstruction(`/judgepay ${ADDRESS} 0.01`);
    assert.equal(missing.kind, "failure");
  });

  it("rejects malformed /judgepay commands with a hint", () => {
    const bare = parseInstruction("/judgepay");
    assert.equal(bare.kind, "failure");
    if (bare.kind === "failure") assert.match(bare.hint, /judgepay/);
    const nonsense = parseInstruction("/judgepay send me money");
    assert.equal(nonsense.kind, "failure");
  });

  it("rejects /judgepay above the per-transaction cap at the policy layer, not the parser", () => {
    const result = parseInstruction(`/judgepay ${ADDRESS} 0.11 USDC`);
    assert.equal(result.kind, "judge_pay");
  });
});

describe("claimpay parsing (M7)", () => {
  it("parses a valid /claimpay command", () => {
    const result = parseInstruction("/claimpay 0.05 USDC");
    assert.equal(result.kind, "claim_pay");
    if (result.kind === "claim_pay") {
      assert.equal(result.amount, "0.05");
      assert.equal(result.token, "USDC");
    }
  });

  it("accepts lowercase token", () => {
    const result = parseInstruction("/claimpay 0.05 usdc");
    assert.equal(result.kind, "claim_pay");
  });

  it("supports the addressed form", () => {
    const plain = parseInstruction("/claimpay 0.05 USDC");
    const addressed = parseInstruction("/claimpay@SolvoAgentBot 0.05 USDC", { botUsername: "SolvoAgentBot" });
    assert.deepEqual(addressed, plain);
  });

  it("rejects missing, extra or malformed arguments", () => {
    assert.equal(parseInstruction("/claimpay").kind, "failure");
    assert.equal(parseInstruction("/claimpay 0.05").kind, "failure");
    assert.equal(parseInstruction("/claimpay 0.05 ETH").kind, "failure");
    assert.equal(parseInstruction("/claimpay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.05 USDC").kind, "failure");
    const malformed = parseInstruction("/claimpay 0.05 USDC extra");
    assert.equal(malformed.kind, "failure");
  });

  it("rejects /claimpay addressed to another bot", () => {
    const result = parseInstruction("/claimpay@SomeOtherBot 0.05 USDC", { botUsername: "SolvoAgentBot" });
    assert.equal(result.kind, "failure");
  });
});
