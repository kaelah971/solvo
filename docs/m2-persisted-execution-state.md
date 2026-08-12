# M2 — Persisted Execution State

## Goal

Give Solvo durable execution memory before Telegram and agent orchestration are
added. M2 implements the deterministic persistence half of

```
REQUEST → VALIDATE → APPROVE → SIMULATE → SUBMIT → CONFIRM → PROVE
```

No Telegram, no LLM reasoning, no public execution endpoints, no batch wiring,
no claim execution, no judge environment. KeeperHub remains the execution layer.

## Database approach

**Supabase Postgres accessed through a direct Postgres client
([postgres.js](https://github.com/porsager/postgres), `postgres` package).**

Why, given the PRD names Supabase and `@supabase/supabase-js`:

- The repo had no existing database layer, so there was nothing to preserve.
- Migrations need raw SQL; `supabase-js` has no arbitrary-SQL surface (only
  PostgREST and RPC), which would force the Supabase CLI into every dev
  workflow. postgres.js runs the committed SQL migrations directly.
- M2 needs multi-statement transactions (state transition + audit event,
  execution persistence + completion audit). postgres.js supports
  `BEGIN/COMMIT` natively; supabase-js would require Postgres functions.
- Access is server-only by construction: a connection string, no PostgREST
  exposure, no client SDK anywhere in the frontend.

The target host is still Supabase Postgres; the connection string is the
pooler URL. `DATABASE_URL` is the only database variable.

## Schema (migrations/0001_initial.sql, 0002_seed_development_workspace.sql)

- `workspaces` — mode (`sandbox|development|personal|community|judge`),
  chain/token, per-transaction and daily limits (integer base units, nullable),
  approval policy, status.
- `payouts` — one logical payment request; source type
  (`direct|claim_link|batch_csv|m1_proof`), total in integer base units,
  currency, chain/token, approval/completion/cancellation timestamps.
- `payout_items` — one recipient line; recipient stored normalized
  (CHECK `recipient_address = lower(recipient_address)`), amount as integer
  base units, KeeperHub execution id, tx hash (CHECK `0x[0-9a-f]{64}`),
  explorer URL, `attempt_count`, **unique `idempotency_key`**.
- `execution_attempts` — every simulation/execution attempt; phase
  (`simulation|execution`), status (`running|succeeded|failed|unknown`),
  simulation result and raw KeeperHub status as jsonb, error code/message,
  timestamps; unique `(payout_item_id, attempt_number)`.
- `audit_events` — append-only; workspace/payout/item refs, event type enum,
  actor type/id, jsonb metadata, created_at. No updates or deletes in normal
  application logic.
- Enum columns: `solvo_workspace_mode`, `solvo_execution_state`,
  `solvo_payout_source_type`, `solvo_attempt_phase`, `solvo_attempt_status`,
  `solvo_audit_event_type`, `solvo_audit_actor_type`.
- `set_updated_at()` trigger on workspaces/payouts/payout_items.
- Indexes on the natural lookup paths (workspace+created, status, item,
  execution id, idempotency).
- `schema_migrations` tracks applied versions.

## State model (src/server/execution/state-machine.ts)

Explicit typed states and a transition table. No silent coercion: every
transition is validated, and the repository enforces the allowed-from set at
the database boundary (UPDATE … WHERE status::text = ANY(from)).

```
draft → validated → pending_approval → approved → simulating → submitted → confirming → completed
```

Failure states: `validation_failed`, `simulation_failed`, `execution_failed`,
`retrying`, `execution_unknown`; `cancelled` from pre-execution states.
Terminal: `completed`, `cancelled`.

Enforced rules: cannot submit before approved; cannot execute before
simulation succeeds; `simulation_failed` never auto-transitions to
`submitted`; a completed real execution requires a transaction hash;
`submitted` persists the KeeperHub execution ID; `confirming` is non-terminal;
`execution_unknown` is distinct from `failed`; retries increment
`attempt_count`.

## Idempotency model

Two layers:

1. **Solvo-side:** `payout_items.idempotency_key` is UNIQUE. `createPayoutItem`
   uses `INSERT … ON CONFLICT (idempotency_key) DO NOTHING` then reads back,
   so duplicate logical requests return the existing item and never create a
   second.
2. **KeeperHub-side:** before any broadcast the service derives the KeeperHub
   idempotency key deterministically from persisted data
   (`sha256(itemIdempotencyKey|chain|recipient|amount|token)`), so a replay
   after a crash matches the original work.

Repeated processing of an item that already has a KeeperHub execution ID
**reconciles** by calling `get_direct_execution_status` — it never broadcasts
again. A non-terminal/unknown existing execution stops with an observable
outcome.

## Crash / restart safety

- Crash after simulation, before execute: state is `submitted`-less
  (`simulating` or `simulation_failed`); safe to resume manually.
- Crash between execute accept and local persistence: the item is in
  `submitted` with no execution ID. The service treats this as ambiguous —
  marks `execution_unknown` with an audit event and **never rebroadcasts**.
- Ambiguous/transport outcomes: `execution_unknown`, no automatic retry, no
  rebroadcast. The stored KeeperHub execution ID (when present) is used for
  later reconciliation.
- No exactly-once guarantees are claimed; KeeperHub idempotency keys make
  safe re-attempts possible when the operator supplies a new logical task.

## Execution service (src/server/execution/execution-service.ts)

`executePayoutItem(id)` composes repository + KeeperHub gateway
(`KeeperHubExecutionGateway` interface; `KeeperHubAdapter` implements it):

1. load item + payout + workspace
2. permit only from `approved` (or reconcile existing executions);
   reject terminal/failure states and chain/token mismatches
3. create execution attempt (attempt_number = latest + 1), `simulating`
4. simulate via KeeperHub; persist simulation result; stop on failure
   (`simulation_failed`)
5. transition `submitted`, call `execute_transfer` with the derived key
6. persist the KeeperHub execution ID immediately
7. terminal completed → persist hash + explorer, `completed`
8. terminal failed → `execution_failed`
9. otherwise `confirming`, then poll until terminal; ambiguity →
   `execution_unknown`

Every multi-write step (transition + attempt update + audit) runs inside one
database transaction via `repo.transaction`.

No public route exposes this. It is server-only code invoked by future
server-side orchestration.

## Audit model

Append-only `audit_events`. Event types used in M2: `simulation_started`,
`simulation_passed`, `simulation_failed`, `execution_submitted`,
`execution_confirming`, `execution_completed`, `execution_failed`,
`execution_unknown`, `m1_proof_imported`. Metadata contains operational facts
only — never API keys, private keys or bearer tokens. Tests assert no secret
prefixes appear in metadata.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (db commands) | Postgres connection string (Supabase pooler with `?sslmode=require`, or local) |
| `KEEPERHUB_API_KEY` | yes (execution) | Existing M1 credential |
| `KEEPERHUB_MCP_URL` | no | Existing M1 default |
| `KEEPERHUB_USDC_TOKEN_ADDRESS` | no | Existing M1 default |

Server-only. Never `NEXT_PUBLIC_`. See `.env.example`.

## Migration process

```
npm run db:migrate    # applies migrations/ in order, tracked in schema_migrations
npm run db:check      # connection, table counts, unique-idempotency constraint, migration status
```

## Development workspace setup

`0002_seed_development_workspace.sql` creates one development workspace
(fixed UUID, mode `development`, Base 8453, Base USDC, per-tx limit
100000 base units = 0.10 USDC, daily 1.00 USDC, policy `auto`). This is
configuration, not fake activity. No payouts, hashes, attempts or audit rows
are seeded.

## M1 proof import

```
npm run db:import-m1-proof
```

Records the REAL M1 KeeperHub execution (sender
`0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E`, recipient
`0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486`, 0.01 USDC, execution
`jivl3joxkavd1crhf3ec3`, tx
`0x7de8f6d09c38698c6c2a016a14265aa703723b54e1f61286f4c492cfef316089`) as a
completed payout + item + attempt with `m1_proof` provenance, plus audit
events including `m1_proof_imported`. Idempotent: re-running returns the
existing item. This is real proof data with development/M1 provenance and is
not shown on any public route.

## Testing commands

- `npm test` — offline unit tests (state machine, money, idempotency,
  execution service with a fake KeeperHub gateway, audit). Never touches the
  network or funds.
- `npm run test:db` — opt-in integration tests against `DATABASE_URL`;
  create temporary development records, verify constraints and transitions,
  clean up after themselves. Never calls KeeperHub.

## Limitations / deferred

- Single-recipient direct items; batch semantics only as far as the schema
  naturally allows.
- `retrying` exists in the state model but M2 performs no automatic retries
  and no retry scheduler.
- No approval UI/policy engine; items must be created in `approved` (or the
  operator transitions them) before execution.
- No distributed locking; idempotency keys + guarded transitions are the
  duplicate-safety mechanism.
- Frontend intentionally untouched; `/receipt/[id]` stays truthful/not-found.
