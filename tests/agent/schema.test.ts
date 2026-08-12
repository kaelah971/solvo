import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyAgentAction,
  AGENT_ACTIONS,
  AGENT_INTENT_KINDS,
  AGENT_PLAN_ACTIONS,
  AGENT_RUN_STATUSES,
  isAgentRunStatus,
  type AgentInput,
  type AgentInterpretation,
  type AgentPlan,
  type AgentResult,
  type PaymentCandidates,
  type PaymentIntent,
} from "../../src/server/agent/types.ts";
import {
  validateAgentInput,
  validateAgentInterpretation,
  validateAgentPlan,
  validateAgentResult,
} from "../../src/server/agent/schema.ts";

const VALID_ADDRESS = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const VALID_ADDRESS_LOWER = VALID_ADDRESS.toLowerCase();

function validCandidates(): PaymentCandidates {
  return {
    amounts: [{ sourceField: "raw_amount", raw: "20", normalized: "20", validationStatus: "valid" }],
    tokens: [{ sourceField: "raw_token", raw: "USDC", normalized: "usdc", validationStatus: "valid" }],
    chains: [{ sourceField: "workspace_config", raw: "8453", normalized: "8453", validationStatus: "valid" }],
    addresses: [
      { sourceField: "raw_address", raw: VALID_ADDRESS, normalized: VALID_ADDRESS_LOWER, validationStatus: "valid" },
    ],
    aliases: [{ sourceField: "raw_alias", raw: "daniel", normalized: "daniel", validationStatus: "valid" }],
    payoutIds: [],
    claimAmounts: [],
  };
}

function validInput(): AgentInput {
  return {
    surface: "telegram",
    chatId: "-100777",
    userId: "123456",
    messageId: 42,
    rawText: "Send Daniel 20 USDC",
    timestampIso: "2026-08-12T00:00:00.000Z",
    workspace: {
      id: "ws-1",
      mode: "community",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      aliases: ["daniel", "alice"],
      perTransactionLimitUsdc: "1.00",
      dailyLimitUsdc: "10.00",
      workspaceActive: true,
    },
    flags: { workspaceMode: "community", isMember: true },
    candidates: validCandidates(),
  };
}

function validIntent(): PaymentIntent {
  return {
    action: "pay",
    amount: "20",
    currency: "USDC",
    recipient: { raw: "daniel", kind: "alias", address: null, alias: "daniel" },
    memo: null,
    missingFields: [],
    candidates: validCandidates(),
    source: "natural_language",
    batch: null,
  };
}

function validInterpretation(): AgentInterpretation {
  return {
    intent: validIntent(),
    intentKind: "prepare_payment",
    summary: "Send 20 USDC to daniel",
    provider: "static",
  };
}

function validPlan(action: "prepare_payment" | "create_claim_link" | "inspect_payment_status"): AgentPlan {
  switch (action) {
    case "prepare_payment":
      return { action: "prepare_payment", payout: { recipientAddress: VALID_ADDRESS, amountBaseUnits: "20000000", memo: null } };
    case "create_claim_link":
      return { action: "create_claim_link", claim: { amountBaseUnits: "20000000" } };
    case "inspect_payment_status":
      return { action: "inspect_payment_status", payoutId: "pay_123" };
  }
}

function validResult(): AgentResult {
  return {
    intent: validIntent(),
    plan: validPlan("prepare_payment"),
    candidates: validCandidates(),
    reply: { text: "Preparing a payment for approval.", buttons: [] },
    safetyFlags: [],
  };
}

describe("agent schema contracts", () => {
  describe("AgentInput validation", () => {
    it("accepts a valid telegram input", () => {
      const result = validateAgentInput(validInput());
      assert.equal(result.ok, true);
    });

    it("accepts a null messageId (update-id fallback surface)", () => {
      const input = { ...validInput(), messageId: null };
      const result = validateAgentInput(input);
      assert.equal(result.ok, true);
    });

    it("rejects a missing chatId", () => {
      const input = { ...validInput() };
      delete (input as Partial<AgentInput>).chatId;
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
      assert.match(result.reason, /chatId/);
    });

    it("rejects a missing userId", () => {
      const input = { ...validInput() };
      delete (input as Partial<AgentInput>).userId;
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
      assert.match(result.reason, /userId/);
    });

    it("rejects a non-numeric messageId", () => {
      const result = validateAgentInput({ ...validInput(), messageId: "42" });
      assert.equal(result.ok, false);
    });

    it("rejects a non-ISO timestamp", () => {
      const result = validateAgentInput({ ...validInput(), timestampIso: "not-a-date" });
      assert.equal(result.ok, false);
      assert.match(result.reason, /timestamp/);
    });

    it("rejects an unknown surface", () => {
      const result = validateAgentInput({ ...validInput(), surface: "slack" });
      assert.equal(result.ok, false);
    });

    it("rejects missing candidates", () => {
      const input = { ...validInput() };
      delete (input as Partial<AgentInput>).candidates;
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
    });

    it("rejects non-object raw input", () => {
      for (const raw of [null, "text", 42, []]) {
        assert.equal(validateAgentInput(raw).ok, false);
      }
    });

    it("rejects a workspace carrying an extra secret key", () => {
      const input = { ...validInput(), workspace: { ...validInput().workspace, apiKey: "kh_secret" } };
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
    });

    it("rejects a top-level secret key", () => {
      const input = { ...validInput(), apiKey: "sk-secret" } as unknown;
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
    });

    it("rejects unknown flags", () => {
      const input = { ...validInput(), flags: { workspaceMode: "community", isMember: true, admin: true } };
      const result = validateAgentInput(input);
      assert.equal(result.ok, false);
    });
  });

  describe("PaymentIntent validation", () => {
    it("accepts a valid intent", () => {
      const result = validateAgentInterpretation(validInterpretation());
      assert.equal(result.ok, true);
    });

    it("rejects an unknown action", () => {
      for (const action of ["execute_transfer", "transfer", "refund", "withdraw"]) {
        const intent = { ...validIntent(), action };
        const result = validateAgentInterpretation({ ...validInterpretation(), intent });
        assert.equal(result.ok, false, `action ${action} must be rejected`);
      }
    });

    it("rejects an unsupported currency", () => {
      const intent = { ...validIntent(), currency: "ETH" };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects an invented amount not present in candidates", () => {
      const intent = { ...validIntent(), amount: "50" };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
      assert.match(result.reason, /amount/);
    });

    it("rejects a hostile amount fabricated by an interpreter", () => {
      const intent = { ...validIntent(), amount: "999" };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects malformed amounts", () => {
      for (const amount of ["abc", "0", "0.0", "-1", "1e6", "20.0000001", "1_000"]) {
        const intent = { ...validIntent(), amount };
        const result = validateAgentInterpretation({ ...validInterpretation(), intent });
        assert.equal(result.ok, false, `amount ${amount} must be rejected`);
      }
    });

    it("accepts an amount matching the candidate normalized value", () => {
      const intent = { ...validIntent(), amount: "20" };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, true);
    });

    it("accepts an amount matching the candidate raw value", () => {
      const candidates = { ...validCandidates(), amounts: [{ sourceField: "raw_amount", raw: "20.0", normalized: "20", validationStatus: "valid" }] };
      const intent = { ...validIntent(), amount: "20.0", candidates };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, true);
    });

    it("rejects an invented recipient address not present in candidates", () => {
      const intent = { ...validIntent(), recipient: { raw: "0xEVIL000000000000000000000000000000000000", kind: "address", address: "0xEVIL000000000000000000000000000000000000", alias: null } };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("accepts an address matching a candidate case-insensitively", () => {
      const intent = { ...validIntent(), recipient: { raw: VALID_ADDRESS_LOWER, kind: "address", address: VALID_ADDRESS_LOWER, alias: null } };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, true);
    });

    it("rejects an invented alias not present in candidates", () => {
      const intent = { ...validIntent(), recipient: { raw: "eve", kind: "alias", address: null, alias: "eve" } };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("accepts an alias matching a candidate case-insensitively", () => {
      const intent = { ...validIntent(), recipient: { raw: "DANIEL", kind: "alias", address: null, alias: "DANIEL" } };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, true);
    });

    it("accepts a claim intent whose amount comes from claimAmounts", () => {
      const candidates = {
        ...validCandidates(),
        claimAmounts: [
          { sourceField: "raw_amount" as const, raw: "5", normalized: "5", validationStatus: "valid" as const },
        ],
      };
      const intent: PaymentIntent = { ...validIntent(), action: "claim_pay", amount: "5", candidates, recipient: null };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent, intentKind: "create_claim_link" });
      assert.equal(result.ok, true);
    });

    it("rejects unknown missingFields keys", () => {
      const intent = { ...validIntent(), missingFields: ["chain"] };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects a memo longer than 140 characters", () => {
      const intent = { ...validIntent(), memo: "x".repeat(141) };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects candidates with a non-array category", () => {
      const intent = { ...validIntent(), candidates: { ...validCandidates(), amounts: "20" } };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects a candidate with an unknown validation status", () => {
      const candidates = { ...validCandidates(), amounts: [{ sourceField: "raw_amount", raw: "20", normalized: "20", validationStatus: "bogus" }] };
      const intent = { ...validIntent(), candidates };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects a candidate whose sourceField does not match its category", () => {
      const candidates = { ...validCandidates(), addresses: [{ sourceField: "raw_alias", raw: VALID_ADDRESS, normalized: VALID_ADDRESS_LOWER, validationStatus: "valid" }] };
      const intent = { ...validIntent(), candidates };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects a non-natural-language source", () => {
      const intent = { ...validIntent(), source: "command" };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });

    it("rejects non-object intents", () => {
      for (const raw of [null, "pay", 42, []]) {
        assert.equal(validateAgentInterpretation({ ...validInterpretation(), intent: raw }).ok, false);
      }
    });
  });

  describe("AgentInterpretation validation", () => {
    it("rejects an intentKind inconsistent with the action", () => {
      const result = validateAgentInterpretation({ ...validInterpretation(), intentKind: "create_claim_link" });
      assert.equal(result.ok, false);
      assert.match(result.reason, /intentKind/);
    });

    it("requires intentKind unsupported when action is unknown", () => {
      const intent = { ...validIntent(), action: "unknown", amount: null, recipient: null, missingFields: [] };
      const good = validateAgentInterpretation({ ...validInterpretation(), intent, intentKind: "unsupported" });
      const bad = validateAgentInterpretation({ ...validInterpretation(), intent, intentKind: "prepare_payment" });
      assert.equal(good.ok, true);
      assert.equal(bad.ok, false);
    });

    it("rejects an empty summary", () => {
      const result = validateAgentInterpretation({ ...validInterpretation(), summary: "" });
      assert.equal(result.ok, false);
    });

    it("rejects an empty provider", () => {
      const result = validateAgentInterpretation({ ...validInterpretation(), provider: "" });
      assert.equal(result.ok, false);
    });

    it("accepts a clarify_missing_fields intent with non-empty missing fields", () => {
      const intent: PaymentIntent = { ...validIntent(), action: "pay", amount: null, recipient: null, missingFields: ["amount", "recipient"] };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent, intentKind: "clarify_missing_fields" });
      assert.equal(result.ok, true);
    });

    it("rejects a clarify_missing_fields intent without missing fields", () => {
      const result = validateAgentInterpretation({ ...validInterpretation(), intentKind: "clarify_missing_fields" });
      assert.equal(result.ok, false);
      assert.match(result.reason, /missingFields/);
    });

    it("accepts payout_id as a missing-field key", () => {
      const intent: PaymentIntent = { ...validIntent(), action: "status", amount: null, currency: null, recipient: null, missingFields: ["payout_id"] };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent, intentKind: "clarify_missing_fields" });
      assert.equal(result.ok, true);
    });
  });

  describe("AgentPlan validation", () => {
    it("accepts all five supported plan actions", () => {
      const plans: AgentPlan[] = [
        { action: "ask_clarifying_question", missingFields: ["amount"], question: "How much should I send?" },
        validPlan("prepare_payment"),
        validPlan("create_claim_link"),
        validPlan("inspect_payment_status"),
        { action: "decline_unsupported", reason: "No verified recipient." },
      ];
      for (const plan of plans) {
        const result = validateAgentPlan(plan);
        assert.equal(result.ok, true, JSON.stringify(plan));
      }
    });

    it("rejects unknown plan actions", () => {
      for (const action of ["send_money", "transfer", "refund", "call_tool", "run"]) {
        const result = validateAgentPlan({ action });
        assert.equal(result.ok, false, `plan action ${action} must be rejected`);
      }
    });

    it("rejects execution-like plan actions", () => {
      for (const action of ["execute_transfer", "execute_approved_payment"]) {
        const result = validateAgentPlan({ action });
        assert.equal(result.ok, false, `plan action ${action} must be rejected`);
      }
    });

    it("rejects direct KeeperHub tool-call plan actions", () => {
      for (const action of ["direct_keeperhub_call", "keeperhub_call"]) {
        const result = validateAgentPlan({ action });
        assert.equal(result.ok, false);
      }
    });

    it("rejects arbitrary HTTP/SQL plan actions", () => {
      for (const action of ["raw_sql", "arbitrary_http_request", "fetch", "shell"]) {
        const result = validateAgentPlan({ action });
        assert.equal(result.ok, false);
      }
    });

    it("rejects an ask_clarifying_question plan without missing fields", () => {
      const result = validateAgentPlan({ action: "ask_clarifying_question", missingFields: [], question: "Which?" });
      assert.equal(result.ok, false);
    });

    it("rejects an ask_clarifying_question plan with an empty question", () => {
      const result = validateAgentPlan({ action: "ask_clarifying_question", missingFields: ["amount"], question: "" });
      assert.equal(result.ok, false);
    });

    it("rejects a prepare_payment plan with a malformed recipient address", () => {
      for (const recipientAddress of ["0xzzz", "0x1234", "abc", "0x742d35Cc6634C0532925a3b844Bc454e4438f4"]) {
        const result = validateAgentPlan({ action: "prepare_payment", payout: { recipientAddress, amountBaseUnits: "20000000", memo: null } });
        assert.equal(result.ok, false, `address ${recipientAddress} must be rejected`);
      }
    });

    it("accepts a lowercase and checksummed 40-hex recipient address", () => {
      for (const recipientAddress of [VALID_ADDRESS, VALID_ADDRESS_LOWER]) {
        const result = validateAgentPlan({ action: "prepare_payment", payout: { recipientAddress, amountBaseUnits: "20000000", memo: null } });
        assert.equal(result.ok, true);
      }
    });

    it("rejects a prepare_payment plan with invalid base units", () => {
      for (const amountBaseUnits of ["0", "-5", "1e6", "abc", "20.5"]) {
        const result = validateAgentPlan({ action: "prepare_payment", payout: { recipientAddress: VALID_ADDRESS, amountBaseUnits, memo: null } });
        assert.equal(result.ok, false, `base units ${amountBaseUnits} must be rejected`);
      }
    });

    it("rejects a prepare_payment plan with an oversized memo", () => {
      const result = validateAgentPlan({ action: "prepare_payment", payout: { recipientAddress: VALID_ADDRESS, amountBaseUnits: "20000000", memo: "x".repeat(141) } });
      assert.equal(result.ok, false);
    });

    it("rejects a prepare_payment plan with an unknown extra key", () => {
      const result = validateAgentPlan({ action: "prepare_payment", payout: { recipientAddress: VALID_ADDRESS, amountBaseUnits: "20000000", memo: null, execute: true } });
      assert.equal(result.ok, false);
    });

    it("rejects a create_claim_link plan with invalid base units", () => {
      const result = validateAgentPlan({ action: "create_claim_link", claim: { amountBaseUnits: "0" } });
      assert.equal(result.ok, false);
    });

    it("accepts an inspect_payment_status plan with a null payoutId", () => {
      const result = validateAgentPlan({ action: "inspect_payment_status", payoutId: null });
      assert.equal(result.ok, true);
    });

    it("rejects a decline_unsupported plan with an empty reason", () => {
      const result = validateAgentPlan({ action: "decline_unsupported", reason: "" });
      assert.equal(result.ok, false);
    });
  });

  describe("AgentResult validation", () => {
    it("accepts a valid prepare_payment result", () => {
      const result = validateAgentResult(validResult());
      assert.equal(result.ok, true);
    });

    it("accepts a valid create_claim_link result", () => {
      const result = validateAgentResult({ ...validResult(), plan: validPlan("create_claim_link") });
      assert.equal(result.ok, true);
    });

    it("accepts a valid inspect_payment_status result", () => {
      const result = validateAgentResult({ ...validResult(), plan: validPlan("inspect_payment_status") });
      assert.equal(result.ok, true);
    });

    it("parses an unsupported intent into a safe decline result", () => {
      const result = validateAgentResult({
        intent: null,
        plan: { action: "decline_unsupported", reason: "I could not interpret that." },
        candidates: validCandidates(),
        reply: { text: "I could not interpret that.", buttons: [] },
        safetyFlags: ["unsupported_intent"],
      });
      assert.equal(result.ok, true);
    });

    it("rejects a result whose plan contains an execution action", () => {
      const result = validateAgentResult({ ...validResult(), plan: { action: "execute_transfer" } });
      assert.equal(result.ok, false);
    });

    it("rejects a result carrying a secret key", () => {
      for (const key of ["apiKey", "privateKey", "token", "secret"]) {
        const result = validateAgentResult({ ...validResult(), [key]: "should-not-exist" });
        assert.equal(result.ok, false, `${key} must be rejected`);
      }
    });

    it("rejects a reply button missing callbackData", () => {
      const result = validateAgentResult({ ...validResult(), reply: { text: "ok", buttons: [{ text: "APPROVE" }] } });
      assert.equal(result.ok, false);
    });

    it("rejects non-string safety flags", () => {
      const result = validateAgentResult({ ...validResult(), safetyFlags: [42] });
      assert.equal(result.ok, false);
    });
  });

  describe("AgentRunStatus recording states", () => {
    it("accepts exactly the nine recording states", () => {
      const expected = [
        "received",
        "interpreted",
        "planned",
        "needs_clarification",
        "prepared",
        "claim_created",
        "blocked",
        "unknown",
        "failed",
      ];
      assert.equal(AGENT_RUN_STATUSES.length, expected.length);
      assert.deepEqual([...AGENT_RUN_STATUSES].sort(), [...expected].sort());
      assert.deepEqual([...AGENT_RUN_STATUSES], expected);
      for (const state of expected) {
        assert.equal(isAgentRunStatus(state), true);
      }
    });

    it("rejects payout-machine states so agent_runs never duplicates payment truth", () => {
      for (const state of ["approved", "pending_approval", "simulating", "submitted", "confirming", "completed", "executed", "execution_failed"]) {
        assert.equal(isAgentRunStatus(state), false, `${state} must not be an agent run status`);
      }
    });
  });

  describe("bounded vocabularies", () => {
    it("exposes bounded action, intent and plan vocabularies", () => {
      assert.deepEqual(AGENT_ACTIONS, ["pay", "claim_pay", "status", "unknown", "batch_pay"]);
      assert.deepEqual(AGENT_INTENT_KINDS, ["prepare_payment", "create_claim_link", "inspect_payment_status", "clarify_missing_fields", "unsupported", "prepare_batch_payment"]);
      assert.deepEqual(AGENT_PLAN_ACTIONS, ["ask_clarifying_question", "prepare_payment", "create_claim_link", "inspect_payment_status", "decline_unsupported"]);
    });

    it("classifies every agent action into a bounded intent kind", () => {
      assert.equal(classifyAgentAction("pay"), "prepare_payment");
      assert.equal(classifyAgentAction("claim_pay"), "create_claim_link");
      assert.equal(classifyAgentAction("status"), "inspect_payment_status");
      assert.equal(classifyAgentAction("unknown"), "unsupported");
    });
  });

  describe("determinism and candidate provenance", () => {
    it("preserves candidate provenance through validation", () => {
      const input = validInput();
      const result = validateAgentInput(input);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.value.candidates, input.candidates);
        assert.equal(result.value.candidates.amounts[0].raw, "20");
        assert.equal(result.value.candidates.amounts[0].normalized, "20");
        assert.equal(result.value.candidates.amounts[0].validationStatus, "valid");
        assert.equal(result.value.candidates.addresses[0].sourceField, "raw_address");
      }
    });

    it("is deterministic: repeated validation produces identical output", () => {
      const first = validateAgentResult(validResult());
      const second = validateAgentResult(validResult());
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (first.ok && second.ok) {
        assert.equal(JSON.stringify(first.value), JSON.stringify(second.value));
        assert.equal(JSON.stringify(first.value), JSON.stringify(validResult()));
      }
    });

    it("never synthesizes timestamps or identifiers inside the parser", () => {
      const result = validateAgentInput(validInput());
      assert.equal(result.ok, true);
      if (result.ok) {
        const serialized = JSON.stringify(result.value);
        assert.doesNotMatch(serialized, /Date\(/);
        assert.equal(result.value.timestampIso, "2026-08-12T00:00:00.000Z");
      }
    });

    it("rejects candidate values that are not strings", () => {
      const candidates = { ...validCandidates(), aliases: [{ sourceField: "raw_alias", raw: 42, normalized: "daniel", validationStatus: "valid" }] };
      const intent = { ...validIntent(), candidates };
      const result = validateAgentInterpretation({ ...validInterpretation(), intent });
      assert.equal(result.ok, false);
    });
  });
});
