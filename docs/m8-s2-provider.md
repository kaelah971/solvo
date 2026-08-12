# M8 — Agentic Payment Orchestrator: S2 Real Model Provider

Status: **SHIPPED** (S2.1 provider adapter → S2.2 factory/config → S2.3 hostile
E2E hardening → S2.4 failure UX contract).

## What S2 shipped

An optional, feature-flagged OpenAI-compatible model provider behind the S1
`IntentInterpreter` seam:

```
SOLVO_AGENT_PROVIDER=openai_compatible (+ SOLVO_AGENT_API_KEY)
→ provider factory selects OpenAICompatibleIntentInterpreter
→ POST {SOLVO_AGENT_API_BASE_URL}/responses
  → text.format.json_schema (bounded interpretation schema, strict)
→ local re-validation with validateAgentInterpretation (never trust the schema)
→ the unchanged deterministic planner / bridges / approval / execution spine
```

## Provider is optional

- The provider is **off by default**. `SOLVO_AGENT_PROVIDER=static` (the
  default) needs no key, no network, and no model — the S1 deterministic
  interpreter keeps working byte-for-byte.
- `static` remains the safe fallback: any operator who does not explicitly
  opt in to a model provider gets the exact S1 behavior.
- A provider outage cannot degrade safety: every failure fails closed (see
  "Failure UX contract").

## What the model may and may not do

- The `openai_compatible` provider **only classifies intent**: it receives a
  sanitized workspace context, the user message, and the deterministic
  candidate lists, and returns a bounded structured interpretation.
- The model **never receives** KeeperHub tools, execution tools, approval
  tools, SQL/HTTP helpers, the tool registry, or Telegram/webhook surfaces —
  there is no model-callable tool list at all. The provider request body
  contains only the bounded JSON schema, the system/user prompts, and the
  model/token configuration (source-contract enforced by
  `tests/agent/provider-e2e-safety.test.ts`).
- Model output is **schema-constrained** (JSON Schema with
  `additionalProperties: false` at every level) **and locally re-validated**
  by the deterministic `validateAgentInterpretation`, which enforces
  candidate provenance: amounts, addresses, and aliases must be selections
  from the deterministic extraction. Fabricated wallets, amounts, hashes,
  completion claims, or smuggled fields are rejected.
- The API key lives only in the `Authorization` header; it never enters
  prompts, output, errors, run rows, or replies. Secret-shaped model output
  is rejected wholesale.
- Deterministic Solvo policy makes all final decisions: recipient
  resolution, policy, approval, separation of duty, persistence, claim
  creation, payout creation, KeeperHub execution, and transaction truth are
  unchanged application-owned code.

## Failure UX contract (locked)

For ANY provider failure — network error, timeout, 401, 403, 429, 5xx,
malformed JSON, empty output, refusal, secret-shaped output, schema
violation, hostile execution action — the system behaves identically:

| Property | Behavior |
|---|---|
| Money | No payout, no payout_item, no claim, no approval, no simulation, no execution, no tx hash, no KeeperHub execution id |
| Run record | `agent_run` persisted with status `failed` / error code `interpreter_error`; `error_message_redacted` is sanitized; interpretation/decision JSON never persisted on failure |
| Reply | "SORRY — I could not safely process that request. Nothing moved and no funds left the workspace." + deterministic slash-command fallbacks (`/pay <address> <amount> USDC`, `/claimpay <amount> USDC`, `/status <payment-id>`) |
| Never exposed | Raw provider response, stack traces, API key, model secrets, DB URL, KeeperHub keys, raw JSON, internal tool names, Judge Mode workarounds |

Failed model calls therefore **cannot move funds**: money intents only exist
as `pending_approval` payouts or claim links created by the deterministic
bridges, and execution requires the existing human approval pipeline or
`/judgepay` — never a model call.

Slash commands remain the deterministic fallback and are never affected by
provider state.

## Required environment (model provider)

Server-side only — **never `NEXT_PUBLIC_`**:

```
SOLVO_AGENT_ENABLED=true
SOLVO_AGENT_PROVIDER=openai_compatible
SOLVO_AGENT_API_KEY=sk-...            # required for the model provider
SOLVO_AGENT_MODEL=gpt-4o-mini         # provider model identifier
SOLVO_AGENT_API_BASE_URL=             # optional; defaults to https://api.openai.com/v1
SOLVO_AGENT_TIMEOUT_MS=5000           # model-call budget (500-15000)
SOLVO_AGENT_MAX_TOKENS=500            # structured-output cap (1-16384)
```

Do not put any of these in `NEXT_PUBLIC_` variables, and do not enable the
provider live until an operator explicitly chooses to (setting
`SOLVO_AGENT_PROVIDER=openai_compatible` AND `SOLVO_AGENT_API_KEY`). With
`static` or a missing key, nothing model-related is ever invoked.

## Tests

- `tests/agent/openai-compatible-interpreter.test.ts` — adapter contract,
  structured-output schema, prompt safety, fail-closed parsing (S2.1).
- `tests/agent/provider-factory.test.ts` — factory selection, config
  passthrough, defaultAgentDeps integration (S2.2).
- `tests/agent/provider-e2e-safety.test.ts` — hostile/malformed provider
  output through the full service; positive controls (S2.3).
- `tests/agent/provider-failure-contract.test.ts` — the failure UX contract
  and static fallback sanity (S2.4).
