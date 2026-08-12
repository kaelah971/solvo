import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatAgentServiceResult } from "../../src/server/agent/messages.ts";
import type { AgentServiceResult } from "../../src/server/agent/service.ts";

const PAYOUT_ID = "payout-123";
const CLAIM_ID = "claim-456";
const ADDRESS = "0x742d35cc6634c0532925a3b844bc454e4438f44e";
const CLAIM_URL = "https://solvo.example/claim/abcdefghijklmnopqrstuvwxyz012345";
const STATUS_UUID = "550e8400-e29b-41d4-a716-446655440000";

const BANNED_INTERNAL = [
  "tool",
  "planner",
  "candidate",
  "schema",
  "llm",
  "model",
  "interpreter",
  "extraction",
  "agent_run",
  "json",
  "raw",
  "provider",
  "stack",
  "trace",
  "typeerror",
  "sql",
  "keeperhub call",
  "execution service",
  "resolve_recipient",
  "inspect_payment_policy",
  "inspect_payment_status",
  "validate_claim_request",
  "prepare_payment",
  "create_claim_link",
  "decline_unsupported",
  "intentKind",
  "intent_kind",
  "candidates",
];
const BANNED_SECRETS = ["kh_", "sk-", "BEGIN PRIVATE KEY", "postgres://", "TELEGRAM_BOT_TOKEN", "DATABASE_URL", "apiKey", "bot token"];
const BANNED_EXECUTION = ["transactionHash", "keeperhub_execution_id", "executionId"];

function assertSafe(text: string, label: string): void {
  for (const banned of BANNED_INTERNAL) {
    assert.equal(text.toLowerCase().includes(banned.toLowerCase()), false, `${label}: contains ${banned}`);
  }
  for (const banned of BANNED_SECRETS) {
    assert.equal(text.toLowerCase().includes(banned.toLowerCase()), false, `${label}: contains ${banned}`);
  }
  for (const banned of BANNED_EXECUTION) {
    assert.equal(text.includes(banned), false, `${label}: contains ${banned}`);
  }
  assert.equal(text.includes("{"), false, `${label}: looks like raw JSON`);
  assert.equal(text.includes("\\n\""), false, `${label}: looks like raw JSON`);
}

describe("agent reply builders", () => {
  it("formats the disabled outcome truthfully without implying failure", () => {
    const reply = formatAgentServiceResult({ outcome: "disabled" });
    assert.match(reply.text, /disabled/i);
    assert.match(reply.text, /conversational/i);
    assert.equal(/failed|error/i.test(reply.text), false);
    assert.equal(reply.buttons, undefined);
    assertSafe(reply.text, "disabled");
  });

  it("formats rate_limited without revealing internal thresholds", () => {
    const reply = formatAgentServiceResult({ outcome: "rate_limited", reason: "Agent-run limit reached for this hour or day. Try again later." });
    assert.match(reply.text, /limit/i);
    assert.match(reply.text, /later/i);
    assert.equal(reply.text.includes("25"), false);
    assert.equal(reply.text.includes("10"), false);
    assertSafe(reply.text, "rate_limited");
  });

  it("formats a payout duplicate without action language", () => {
    const reply = formatAgentServiceResult({ outcome: "duplicate", payoutId: PAYOUT_ID, claimId: null });
    assert.match(reply.text, /already prepared/i);
    assert.match(reply.text, /approval/i);
    assert.equal(/sending|execut|paid|moved/i.test(reply.text), false);
    assertSafe(reply.text, "duplicate payout");
  });

  it("formats a claim duplicate without reconstructing the token", () => {
    const reply = formatAgentServiceResult({ outcome: "duplicate", payoutId: null, claimId: CLAIM_ID });
    assert.match(reply.text, /already created/i);
    assert.match(reply.text, /cannot be shown again/i);
    assert.equal(reply.text.includes("abcdefghijklmnopqrstuvwxyz012345"), false);
    assert.equal(reply.text.includes(CLAIM_ID), false);
    assertSafe(reply.text, "duplicate claim");
  });

  it("formats a generic duplicate", () => {
    const reply = formatAgentServiceResult({ outcome: "duplicate", payoutId: null, claimId: null });
    assert.match(reply.text, /already processed/i);
    assertSafe(reply.text, "duplicate generic");
  });

  it("asks only about the amount when amount is missing", () => {
    const reply = formatAgentServiceResult({ outcome: "needs_clarification", missingFields: ["amount"], question: "Please provide: amount." });
    assert.match(reply.text, /how much/i);
    assert.match(reply.text, /20 USDC/i);
    assert.equal(/recipient|who/i.test(reply.text), false);
    assertSafe(reply.text, "clarify amount");
  });

  it("asks only about the recipient when recipient is missing", () => {
    const reply = formatAgentServiceResult({ outcome: "needs_clarification", missingFields: ["recipient"], question: "Please provide: recipient." });
    assert.match(reply.text, /who/i);
    assert.equal(/how much/i.test(reply.text), false);
    assertSafe(reply.text, "clarify recipient");
  });

  it("asks for the payment id when payout_id is missing", () => {
    const reply = formatAgentServiceResult({ outcome: "needs_clarification", missingFields: ["payout_id"], question: "Please provide: payout_id." });
    assert.match(reply.text, /payment/i);
    assert.match(reply.text, /status/i);
    assertSafe(reply.text, "clarify payout_id");
  });

  it("formats prepared_payment with approval requirement and no funds moved", () => {
    const result: AgentServiceResult = {
      outcome: "prepared_payment",
      prepared: {
        outcome: "created",
        payoutId: PAYOUT_ID,
        itemId: "item-1",
        amountBaseUnits: "20000000",
        recipientAddress: ADDRESS,
        recipientAlias: "daniel",
        state: "pending_approval",
        approvalRequired: true,
        buttons: [
          { text: "APPROVE", callbackData: `approve:${PAYOUT_ID}` },
          { text: "REJECT", callbackData: `reject:${PAYOUT_ID}` },
        ],
      },
    };
    const reply = formatAgentServiceResult(result);
    assert.match(reply.text, /approval/i);
    assert.match(reply.text, /no funds have moved/i);
    assert.match(reply.text, /20/i);
    assert.match(reply.text, /daniel/i);
    assert.equal(/paid|completed|sent/i.test(reply.text), false);
    assert.equal(/executed|transferred/i.test(reply.text), false);
    assert.equal(reply.buttons?.length, 2);
    assert.equal(reply.buttons?.[0].text, "APPROVE");
    assertSafe(reply.text, "prepared_payment");
  });

  it("prepared payment names the owner/approver gate and the after-approval KeeperHub step", () => {
    const result: AgentServiceResult = {
      outcome: "prepared_payment",
      prepared: {
        outcome: "created",
        payoutId: PAYOUT_ID,
        itemId: "item-1",
        amountBaseUnits: "10000",
        recipientAddress: ADDRESS,
        recipientAlias: "daniel",
        state: "pending_approval",
        approvalRequired: true,
        buttons: [],
      },
    };
    const reply = formatAgentServiceResult(result);
    assert.match(reply.text, /owner or approver/i);
    assert.match(reply.text, /approval required/i);
    assert.match(reply.text, /keeperhub execution happens only after approval/i);
    assert.equal(reply.text.includes("payment sent"), false);
    assert.equal(reply.text.includes("completed"), false);
    assertSafe(reply.text, "prepared payment gates");
  });

  it("claim link copy explains the recipient wallet step and the exact-destination approval gate", () => {
    const result: AgentServiceResult = {
      outcome: "claim_link_created",
      claim: {
        outcome: "created",
        claimId: CLAIM_ID,
        claimUrl: CLAIM_URL,
        tokenPrefix: "abcdefgh",
        amountBaseUnits: "50000",
        currencySymbol: "USDC",
        chainId: "8453",
        tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        expiresAt: "2026-08-19T13:00:00.000Z",
        state: "created",
        approvalBehavior: "x",
      },
    };
    const reply = formatAgentServiceResult(result);
    assert.match(reply.text, /opens the link and enters a wallet address/i);
    assert.match(reply.text, /owner or approver must approve the exact claimed destination/i);
    assert.match(reply.text, /before keeperhub execution/i);
    assert.equal(/\bpaid\b|completed|claim .*paid/i.test(reply.text), false);
    assertSafe(reply.text, "claim gates");
  });

  it("unsupported copy lists all four safe example shapes", () => {
    const reply = formatAgentServiceResult({ outcome: "unsupported", reason: "Unsupported token or chain." });
    assert.match(reply.text, /Send 0\.01 USDC to 0x\.\.\./i);
    assert.match(reply.text, /Pay blossom 0\.01 USDC/i);
    assert.match(reply.text, /Create a claim link for 0\.05 USDC/i);
    assert.match(reply.text, /Check status <payment-id>/i);
    assertSafe(reply.text, "unsupported examples");
  });

  it("failed copy offers deterministic slash-command fallbacks and never mentions judge mode", () => {
    const reply = formatAgentServiceResult({ outcome: "failed", reason: "interpreter_error: kh_secret_marker" });
    assert.match(reply.text, /\/pay <address> <amount> USDC/i);
    assert.match(reply.text, /\/claimpay <amount> USDC/i);
    assert.match(reply.text, /\/status <payment-id>/i);
    assert.equal(reply.text.includes("judgepay"), false);
    assert.equal(/judge/i.test(reply.text), false);
    assertSafe(reply.text, "failed fallbacks");
  });

  it("formats prepared_payment without buttons when none are provided", () => {
    const result: AgentServiceResult = {
      outcome: "prepared_payment",
      prepared: {
        outcome: "created",
        payoutId: PAYOUT_ID,
        itemId: "item-1",
        amountBaseUnits: "10000",
        recipientAddress: ADDRESS,
        recipientAlias: null,
        state: "pending_approval",
        approvalRequired: true,
        buttons: [],
      },
    };
    const reply = formatAgentServiceResult(result);
    assert.equal(reply.buttons?.length, 0);
    assertSafe(reply.text, "prepared_payment no buttons");
  });

  it("formats claim_link_created with the URL only when provided", () => {
    const withUrl: AgentServiceResult = {
      outcome: "claim_link_created",
      claim: {
        outcome: "created",
        claimId: CLAIM_ID,
        claimUrl: CLAIM_URL,
        tokenPrefix: "abcdefgh",
        amountBaseUnits: "50000",
        currencySymbol: "USDC",
        chainId: "8453",
        tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        expiresAt: "2026-08-19T13:00:00.000Z",
        state: "created",
        approvalBehavior: "Recipient submits a wallet address; an owner or approver approves the exact destination before anything moves.",
      },
    };
    const reply = formatAgentServiceResult(withUrl);
    assert.equal(reply.text.includes(CLAIM_URL), true);
    assert.match(reply.text, /0\.05/i);
    assert.match(reply.text, /no funds move/i);
    assert.match(reply.text, /expires/i);
    assert.equal(/paid|sent|moved/i.test(reply.text), false);
    assertSafe(reply.text, "claim with url");

    const withoutUrl: AgentServiceResult = {
      outcome: "claim_link_created",
      claim: { ...withUrl.claim, outcome: "existing", claimUrl: null },
    };
    const reply2 = formatAgentServiceResult(withoutUrl);
    assert.equal(reply2.text.includes(CLAIM_URL), false);
    assert.match(reply2.text, /cannot be shown again/i);
    assertSafe(reply2.text, "claim without url");
  });

  it("formats status_visible with safe state and no retry promise", () => {
    const result: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null },
    };
    const reply = formatAgentServiceResult(result);
    assert.match(reply.text, /pending_approval/i);
    assert.match(reply.text, /1/i);
    assert.equal(/retry|will try|automatically/i.test(reply.text), false);
    assertSafe(reply.text, "status_visible");
  });

  it("status copy only claims completion when the result provides a completed time", () => {
    const pending: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null },
    };
    const pendingReply = formatAgentServiceResult(pending);
    assert.equal(/completed|executed|transferred/i.test(pendingReply.text), false);
    assertSafe(pendingReply.text, "status pending");

    const completed: AgentServiceResult = {
      outcome: "status_visible",
      status: { outcome: "visible", payoutId: STATUS_UUID, state: "completed", itemCount: 1, completedAt: "2026-08-12T13:00:00.000Z" },
    };
    const completedReply = formatAgentServiceResult(completed);
    assert.match(completedReply.text, /completed/i);
    assert.match(completedReply.text, /13:00:00/i);
    assertSafe(completedReply.text, "status completed");
  });

  it("formats status_not_found with a generic no-leak message", () => {
    const reply = formatAgentServiceResult({ outcome: "status_not_found", payoutId: STATUS_UUID });
    assert.match(reply.text, /couldn't find/i);
    assert.equal(reply.text.includes(STATUS_UUID), false);
    assert.equal(/workspace|other|exists/i.test(reply.text), false);
    assertSafe(reply.text, "status_not_found");
  });

  it("formats blocked concisely", () => {
    const reply = formatAgentServiceResult({ outcome: "blocked", reason: "This payment is above the workspace per-transaction limit." });
    assert.match(reply.text, /limit/i);
    assert.ok(reply.text.length < 400);
    assertSafe(reply.text, "blocked");
  });

  it("formats unsupported with safe examples", () => {
    const reply = formatAgentServiceResult({ outcome: "unsupported", reason: "I could not interpret that instruction." });
    assert.match(reply.text, /couldn't|could not/i);
    assert.match(reply.text, /Send 0\.01 USDC/i);
    assert.match(reply.text, /Create a claim link/i);
    assert.match(reply.text, /Check status/i);
    assert.equal(reply.text.includes("I could not interpret that instruction."), true);
    assertSafe(reply.text, "unsupported");
  });

  it("formats failed with a brief apology and no internals", () => {
    const reply = formatAgentServiceResult({ outcome: "failed", reason: "interpreter_error: kh_secret_marker" });
    assert.match(reply.text, /sorry/i);
    assert.match(reply.text, /nothing moved/i);
    assert.equal(reply.text.includes("kh_secret_marker"), false);
    assert.equal(reply.text.includes("interpreter_error"), false);
    assert.equal(/stack|trace|sql/i.test(reply.text), false);
    assertSafe(reply.text, "failed");
  });

  it("never emits raw JSON in any outcome", () => {
    const results: AgentServiceResult[] = [
      { outcome: "disabled" },
      { outcome: "rate_limited", reason: "x" },
      { outcome: "duplicate", payoutId: PAYOUT_ID, claimId: null },
      { outcome: "needs_clarification", missingFields: ["amount"], question: "q" },
      {
        outcome: "prepared_payment",
        prepared: { outcome: "created", payoutId: PAYOUT_ID, itemId: "i", amountBaseUnits: "10000", recipientAddress: ADDRESS, recipientAlias: null, state: "pending_approval", approvalRequired: true, buttons: [] },
      },
      {
        outcome: "claim_link_created",
        claim: { outcome: "created", claimId: CLAIM_ID, claimUrl: CLAIM_URL, tokenPrefix: "abcdefgh", amountBaseUnits: "50000", currencySymbol: "USDC", chainId: "8453", tokenAddress: "0x", expiresAt: "2026-08-19T13:00:00.000Z", state: "created", approvalBehavior: "x" },
      },
      { outcome: "status_not_found", payoutId: STATUS_UUID },
      { outcome: "blocked", reason: "x" },
      { outcome: "unsupported", reason: "x" },
      { outcome: "failed", reason: "x" },
    ];
    for (const result of results) {
      const reply = formatAgentServiceResult(result);
      assertSafe(reply.text, result.outcome);
      assert.equal(reply.text.includes('"'), false, `${result.outcome}: contains quotes`);
      assert.equal(reply.text.includes("\\n"), false, `${result.outcome}: contains escapes`);
    }
  });

  it("no message contains banned internal terms in any outcome", () => {
    const results: AgentServiceResult[] = [
      { outcome: "disabled" },
      { outcome: "rate_limited", reason: "x" },
      { outcome: "duplicate", payoutId: PAYOUT_ID, claimId: null },
      { outcome: "duplicate", payoutId: null, claimId: CLAIM_ID },
      { outcome: "needs_clarification", missingFields: ["amount", "recipient", "currency", "workspace", "payout_id"], question: "q" },
      {
        outcome: "prepared_payment",
        prepared: { outcome: "created", payoutId: PAYOUT_ID, itemId: "i", amountBaseUnits: "10000", recipientAddress: ADDRESS, recipientAlias: "daniel", state: "pending_approval", approvalRequired: true, buttons: [] },
      },
      {
        outcome: "claim_link_created",
        claim: { outcome: "created", claimId: CLAIM_ID, claimUrl: CLAIM_URL, tokenPrefix: "abcdefgh", amountBaseUnits: "50000", currencySymbol: "USDC", chainId: "8453", tokenAddress: "0x", expiresAt: "2026-08-19T13:00:00.000Z", state: "created", approvalBehavior: "x" },
      },
      { outcome: "status_visible", status: { outcome: "visible", payoutId: STATUS_UUID, state: "pending_approval", itemCount: 1, completedAt: null } },
      { outcome: "status_not_found", payoutId: STATUS_UUID },
      { outcome: "blocked", reason: "x" },
      { outcome: "unsupported", reason: "x" },
      { outcome: "failed", reason: "x" },
    ];
    for (const result of results) {
      assertSafe(formatAgentServiceResult(result).text, result.outcome);
    }
  });

  it("never implies payment completion for prepared outcomes", () => {
    const prepared: AgentServiceResult = {
      outcome: "prepared_payment",
      prepared: { outcome: "created", payoutId: PAYOUT_ID, itemId: "i", amountBaseUnits: "10000", recipientAddress: ADDRESS, recipientAlias: null, state: "pending_approval", approvalRequired: true, buttons: [] },
    };
    const reply = formatAgentServiceResult(prepared);
    assert.equal(/\bpaid\b|completed|\bsent\b/.test(reply.text), false);
    assert.match(reply.text, /no funds have moved/i);
    assert.equal(/(?<!no )funds have moved/i.test(reply.text), false);
  });

  it("never implies a claim is paid", () => {
    const claim: AgentServiceResult = {
      outcome: "claim_link_created",
      claim: { outcome: "created", claimId: CLAIM_ID, claimUrl: CLAIM_URL, tokenPrefix: "abcdefgh", amountBaseUnits: "50000", currencySymbol: "USDC", chainId: "8453", tokenAddress: "0x", expiresAt: "2026-08-19T13:00:00.000Z", state: "created", approvalBehavior: "x" },
    };
    const reply = formatAgentServiceResult(claim);
    assert.equal(/\bpaid\b|completed|funds.*moved/.test(reply.text), false);
  });

  it("is deterministic: repeated formatting deep-equals", () => {
    const result: AgentServiceResult = {
      outcome: "prepared_payment",
      prepared: { outcome: "created", payoutId: PAYOUT_ID, itemId: "i", amountBaseUnits: "10000", recipientAddress: ADDRESS, recipientAlias: "daniel", state: "pending_approval", approvalRequired: true, buttons: [] },
    };
    const first = formatAgentServiceResult(result);
    const second = formatAgentServiceResult(result);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
  });

  it("messages.ts imports no execution, KeeperHub, Telegram bot, or model modules", () => {
    const source = readFileSync("src/server/agent/messages.ts", "utf8");
    const imports = source
      .split("\n")
      .filter((line) => line.trim().startsWith("import"))
      .join("\n");
    for (const forbidden of ["execution-service", "keeperhub", "judge", "mcp-client", "telegram/bot", "webhook", "openai", "anthropic", "ai-sdk", "node:http"]) {
      assert.equal(imports.includes(forbidden), false, forbidden);
    }
  });
});
