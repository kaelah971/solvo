import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactSecrets } from "../../src/server/telegram/safe-logging.ts";
import { generateClaimToken } from "../../src/server/claim/token.ts";
import { parseCallbackData } from "../../src/server/telegram/community-messages.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";
import { parseUsdcAmount } from "../../src/server/keeperhub/amount.ts";

describe("M8 secret & token redaction", () => {
  it("redacts claim URLs containing raw tokens from any log text", () => {
    const token = generateClaimToken();
    const url = `https://solvo.example/claim/${token}`;
    const redacted = redactSecrets(`user opened ${url} and the request failed`);
    assert.ok(!redacted.includes(token), "raw claim token must never reach logs");
    assert.ok(!redacted.includes("claim/" + token));
    assert.match(redacted, /\[REDACTED:CLAIM_TOKEN\]/);
  });

  it("redacts claim URLs inside JSON/error payloads and nested objects", () => {
    const token = generateClaimToken();
    const payload = JSON.stringify({ link: `https://x.example/claim/${token}`, nested: { deep: `claim/${token}` } });
    const redacted = redactSecrets(payload);
    assert.ok(!redacted.includes(token));
    assert.ok(!redacted.includes(`claim/${token}`));
    assert.match(redacted, /\[REDACTED:CLAIM_TOKEN\]/);
  });

  it("keeps legitimate non-token strings intact", () => {
    const text = "payout 3d8826cd-4ed3-45b5-ba6d-22a0286d6db8 tx 0x81b61704780fa0d8a983bf15d01c6043ee7f42cd730499649de23137d932c25c";
    assert.equal(redactSecrets(text), text);
  });

  it("redacts bot tokens, bearer headers, db urls and keeperhub keys", () => {
    const botToken = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"; // 9 digits : 35 chars
    const out = redactSecrets(
      `token ${botToken} ` +
        "Bearer abc.def.ghi postgresql://user:pass@host/db kh_supersecret123456",
    );
    assert.ok(!out.includes(botToken));
    assert.ok(!out.includes("Bearer abc.def.ghi"));
    assert.ok(!out.includes("postgresql://user:pass@host/db"));
    assert.ok(!out.includes("kh_supersecret123456"));
  });
});

describe("M8 malformed callback data", () => {
  it("rejects malformed, oversized and unknown-action callback payloads", () => {
    assert.equal(parseCallbackData(""), null);
    assert.equal(parseCallbackData("garbage"), null);
    assert.equal(parseCallbackData("solvo:approve:"), null);
    assert.equal(parseCallbackData("solvo:approve:not-a-uuid"), null);
    assert.equal(parseCallbackData(`solvo:approve:${"a".repeat(400)}`), null);
    assert.equal(parseCallbackData("solvo:hack:3d8826cd-4ed3-45b5-ba6d-22a0286d6db8"), null);
    assert.equal(parseCallbackData("solvo:claimhack:3d8826cd-4ed3-45b5-ba6d-22a0286d6db8"), null);
    assert.equal(parseCallbackData("solvo:approve:3d8826cd-4ed3-45b5-ba6d-22a0286d6db8;DROP TABLE payouts"), null);
  });

  it("parses only the exact payout and claim payloads", () => {
    const payout = parseCallbackData("solvo:approve:3d8826cd-4ed3-45b5-ba6d-22a0286d6db8");
    assert.deepEqual(payout, { action: "approve", payoutId: "3d8826cd-4ed3-45b5-ba6d-22a0286d6db8" });
    const claim = parseCallbackData("solvo:claimreject:3d8826cd-4ed3-45b5-ba6d-22a0286d6db8");
    assert.deepEqual(claim, { action: "claim_reject", claimId: "3d8826cd-4ed3-45b5-ba6d-22a0286d6db8" });
  });
});

describe("M8 Telegram input hardening (parser level)", () => {
  it("handles empty commands, huge amounts and unicode whitespace truthfully", () => {
    assert.equal(parseInstruction("").kind, "failure");
    assert.equal(parseInstruction("   ").kind, "failure");
    // The parser passes the token through; the amount VALIDATION layer rejects
    // huge values without crashing.
    const huge = parseInstruction(`/pay 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 ${"9".repeat(400)} USDC`);
    assert.equal(huge.kind, "pay");
    assert.equal(parseUsdcAmount("9".repeat(400)).ok, false, "huge amounts must fail amount validation");
    const unicode = parseInstruction(`/pay\u00A00x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486\u00A00.01\u00A0USDC`);
    assert.equal(unicode.kind, "pay", "unicode whitespace is treated as whitespace");
    const extra = parseInstruction(`/pay 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC extra`);
    assert.equal(extra.kind, "failure");
  });

  it("handles command addressing correctly for every command", () => {
    const opts = { botUsername: "SolvoAgentBot" };
    assert.equal(parseInstruction("/pay@SolvoAgentBot 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC", opts).kind, "pay");
    assert.equal(parseInstruction("/pay@EvilBot 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC", opts).kind, "failure");
    assert.equal(parseInstruction("/claimpay@EvilBot 0.05 USDC", opts).kind, "failure");
    assert.equal(parseInstruction("/judgepay@EvilBot 0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486 0.01 USDC", opts).kind, "failure");
    assert.equal(parseInstruction("/batch@EvilBot\nalice 0.01 USDC", opts).kind, "failure");
  });

  it("rejects unknown payouts and claims at the flow layer without leaking details", async () => {
    const { handleStatusInstruction } = await import("../../src/server/telegram/flows/status-flow.ts");
    const { MemoryRepository } = await import("../../src/server/db/memory-repository.ts");
    const repo = new MemoryRepository();
    const reply = await handleStatusInstruction("00000000-0000-4000-8000-000000000000", repo, {
      userId: "1",
      chatId: "-1",
    });
    assert.equal(reply.found, false);
    assert.match(reply.text, /not found/i);
  });
});
