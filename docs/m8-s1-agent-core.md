# M8 — Agentic Payment Orchestrator: S1 Deterministic Core

Status: **COMPLETE** (commits 5d0118d → 6921f84 + hardening).

## What S1 shipped

The deterministic safety and orchestration substrate a model can later use.
At the end of S1:

```
Telegram group text (non-command, feature-flagged)
→ deterministic candidate extraction
→ IntentInterpreter abstraction (StaticIntentInterpreter; provider seam for S2)
→ schema-validated AgentInterpretation (fail-closed via safeInterpretation)
→ deterministic AgentPlanner
→ bounded tool registry (read-only / validation only)
→ application-owned bridges (prepare payment / claim link / status)
→ agent_runs observability (idempotent, rate-limited, redacted)
→ safe conversational replies
```

No real LLM, no model API key, no KeeperHub access from agent code, no
model-controlled execution, no new Judge execution surface, and no real
payment were introduced or executed in S1.

## Module map (src/server/agent/)

| Module | Responsibility |
|---|---|
| `types.ts` | Bounded contracts: `AgentAction`, `PaymentIntent`, candidates with provenance, `AgentPlan`, `AgentRunStatus` (exactly nine recording states), `MissingFieldKey` |
| `schema.ts` | Strict, dependency-free validators; candidate provenance enforcement; fail-closed |
| `extraction.ts` | Deterministic candidate extraction (amounts, tokens, chains, addresses, aliases, payout ids, claim amounts) with raw/normalized/validation-status provenance |
| `interpreter.ts` | `IntentInterpreter` interface + `safeInterpretation` fail-closed gate |
| `static-interpreter.ts` | `StaticIntentInterpreter` (S1 production) + `HostileInterpreter`/`HOSTILE_PAYLOADS` (test-only) |
| `config.ts` | `SOLVO_AGENT_*` env; default-off; typed errors; redacted summary |
| `tools.ts` | Bounded registry: `resolve_recipient`, `inspect_payment_policy`, `inspect_payment_status`, `validate_claim_request` — read-only/validation only, DI via `AgentToolContext` |
| `planner.ts` | Deterministic decision engine (clarify / prepared payment / claim / status / blocked / unsupported) |
| `redact.ts` | `hashAgentInput` (SHA-256) + `redactAgentRawText` (secrets scrubbed, truncated) |
| `bridges/prepare-payment.ts` | Application-owned: creates `pending_approval` payout + item; links run; APPROVE/REJECT buttons |
| `bridges/create-claim-link.ts` | Application-owned: creates M7 claim link (hash-only token); links run |
| `bridges/status-result.ts` | Non-mutating status conversion |
| `service.ts` | `runAgentOrchestration`: config gate → validation → rate limits → serialized idempotent run creation → extract → interpret → plan → bridge → terminal run record |
| `messages.ts` | Safe conversational reply formatting (no internals, no secrets) |
| `telegram/flows/agent-flow.ts` | Telegram entry: community-only, member-gated, slash-excluded |

## Authority model (locked)

- The model proposes; deterministic code disposes. Every interpretation is
  schema-validated, and amounts/recipients must come from deterministically
  extracted candidates.
- Money intents end as `pending_approval` payouts or claim links — never
  execution. The existing approval callback pipeline (`approval-flow.ts`,
  `claim/service.ts`) is the ONLY approval→execution path, and `/judgepay`
  the only Judge execution surface.
- `agent_runs` is observability only: nine recording statuses, no payout/claim
  states, no transaction hashes, no execution ids. Payout/claim persistence
  is the single source of money truth.
- Agent code imports no KeeperHub client, execution service, judge flow,
  webhook admin, or model SDK (source-contract enforced in
  `tests/security/agent-execution-boundary.test.ts`).

## Enabling

`SOLVO_AGENT_ENABLED=false` (default) preserves existing behavior exactly.
Set `SOLVO_AGENT_ENABLED=true` to route non-command text in community group
chats through the deterministic agent flow (pending-approval payouts, claim
links, and status lookups only).

## Verification (S1 gate)

- `npm test`: 799/799 (agent + telegram + all M1–M7 regression suites)
- `npm run test:db`: 29/29 (migration 0012 applied)
- `npm run lint`: 0 errors (2 pre-existing UI warnings)
- `npx tsc --noEmit`: clean
- `npm run build`: PASS
- `npm run telegram:doctor`: PASS
- `npm run judge:doctor`: READY FOR JUDGE TEST
- No real payment executed; no webhook/menu mutation performed.

## Next phase

S2 — real model provider behind the same `IntentInterpreter` interface
(env-gated, fail-closed, deterministic fakes for tests), then S3
conversational UX polish. Deferred scope is listed in the M8 plan §19.
