# M5 — Batch Payouts

## Goal

A community treasurer submits ONE instruction with MULTIPLE recipients and
Solvo handles validation, one human approval, per-item simulation/execution
through the existing KeeperHub path, truthful per-item tracking, and a final
batch receipt.

## Syntax

```
/batch
alice 0.01 USDC
bob 0.02 USDC
0x76D7...7486 0.01 USDC
```

Also supported (deterministic, no LLM):

```
/batch
alice,0.01
bob,0.02 USDC
```

Line formats (per line):

- `<recipient> <amount> USDC`
- `<recipient>,<amount>` (optional trailing `USDC`)

`<recipient>` is a validated workspace alias (lowercase) or an explicit EVM
address. USDC only, Base 8453 only. Batch size cap: **20 recipients**.
`@username` lines are rejected — usernames never authorize.

## Validation

The complete batch is validated BEFORE anything is persisted or executed:

- every recipient resolves (alias exists, or explicit address is valid)
- every amount parses safely to USDC base units (BigInt arithmetic, no floats)
- amounts > 0, ≤ 0.10 USDC per item (existing item cap)
- token USDC, chain 8453
- workspace active; requester is an active member
- ≤ 20 lines

**Duplicate policy (deterministic):** any two lines resolving to the same
lowercase EVM address — whether duplicate explicit addresses, duplicate
aliases, or an alias plus its own address — reject the entire batch. Money is
never silently merged. One invalid row rejects the whole batch (nothing is
persisted).

## Persistence model

Reuses the existing M2 model with no new execution architecture:

```
ONE payout (source_type = telegram_batch, status = pending_approval)
  ├── payout_item (recipient A, memo = alias label)
  ├── payout_item (recipient B)
  └── payout_item (recipient C)
```

- payout stores requester, workspace, batch total (`total_amount_base_units`)
- each item stores its recipient, amount, status, execution ID, tx hash
- every item has a **unique Solvo idempotency key**:
  `tg:<chat>:m<messageId>:pay:batch:<index>`
- duplicate Telegram delivery of the same batch message returns the existing
  payout (looked up by the first item's key) — no second batch is created

## Approval semantics

The batch produces ONE preview:

```
BATCH PAYOUT

RECIPIENTS    3
TOTAL         0.04 USDC
NETWORK       BASE
REQUESTED BY  <numeric id>
APPROVAL      REQUIRED
PAYOUT ID     <short id>

- alice / 0x76d7a… / 0.01 USDC
- bob / 0x742d… / 0.02 USDC
- 0x1111111… / 0.01 USDC
```

with `[ APPROVE BATCH ] [ REJECT ]` inline buttons. Approval rules are
exactly M4: owner/approver only, requester cannot self-approve, wrong-chat and
stale callbacks rejected, duplicate callbacks safe, concurrent approvals →
exactly one winner (strict per-item DB transitions in one transaction).

**Callback ACK ordering is preserved:** cheap validation → `answerCallbackQuery`
immediately → atomic transition of ALL items + payout → sequential execution →
edit/reply with progress and the final receipt. Execution never blocks the
acknowledgement.

## Execution semantics

No new KeeperHub implementation. Every approved item goes through the
existing `ExecutionService → KeeperHubAdapter → simulate → execute → persist →
prove` pipeline, sequentially (bounded, never `Promise.all` over items). A
KeeperHub native batch primitive was investigated and deliberately NOT adopted
for M5: item-level audit + idempotency guarantees are preserved, and
sequential item execution is correct and simple.

**One item must never execute twice:** the `pending_approval → approved`
transition is strict per item (in one transaction); `executePayoutItem` returns
`completed` early for already-completed items without any KeeperHub call;
duplicate/concurrent approval tests prove single execution.

## Partial-failure semantics

A batch is not atomic. Each item is recorded exactly as it happened:

- all items completed → payout `completed`
- some completed, some not → payout **`partially_completed`** (new aggregate
  state, justified: no existing state truthfully describes "some moved"; it is
  payout-level only, terminal, and items keep their own states)
- none completed, none executed (all simulation failures) → payout
  `simulation_failed`
- none completed, some executed-but-failed → `execution_failed`
- any item `execution_unknown` (and none completed) → `execution_unknown`

The batch executor runs item executions with payout-level sync disabled
(`syncPayoutState: false`, an opt-in ExecutionService option that leaves all
M2–M4 behavior unchanged) so no single item's outcome can win the aggregate;
the executor settles the payout state itself at the end. Transaction hashes
are never fabricated.

## Retry rules

No automatic retry in M5. A retry pass can only operate on eligible
failed/unexecuted items, and completed items are provably never re-executed
(early `completed` short-circuit with zero KeeperHub calls — tested).
Item-level retry tooling is deferred; a failed batch can be re-submitted as a
new request.

## Policy enforcement

Checked at two boundaries:

1. **Request creation** (`evaluateBatchRequest`): workspace active, member,
   chain/token, every item ≤ per-transaction limit, and batch total + current
   daily spend ≤ daily limit (20 × 0.08 USDC cannot bypass a 1.00 USDC daily
   limit — tested).
2. **Approval** (`evaluateBatchApproval`, re-evaluated inside the same
   transaction as the strict item transitions): same checks against fresh
   daily-spend sums — no TOCTOU.

M4 rules are not weakened: owner/approver only, separation of duty,
wrong-chat/stale rejection all apply.

## Audit behavior

Item-level lifecycle events are preserved for every item
(`request_created`, `simulation_started`, `simulation_passed`,
`execution_submitted`, `execution_completed`, …). Batch-level additions:

- `approval_granted` on the payout with `itemCount` + `totalBaseUnits`
- one aggregate event at settlement (`execution_completed`,
  `batch_partially_completed`, `execution_failed`, `execution_unknown` or
  `simulation_failed`) with completed/total counts

Actor IDs are numeric Telegram IDs only.

## Status

`/status <payout_id>` for batch payouts shows: aggregate state, requested
count, completed count, not-done count, requested total, transferred total,
and per-item lines (label, address, amount, status, execution ID, tx hash).
Single-payment status is unchanged.

## Manual proof procedure (operator — do NOT execute automatically)

1. Create a group, add @SolvoAgentBot, `/workspace init` as the dev operator.
2. `/member add <numeric_id> approver` and `/member add <numeric_id> member`.
3. `/recipient add alice 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486`,
   `/recipient add bob 0x742d35Cc6634C0532925a3b844Bc454e4438f44e`.
4. From the member account:

```
/batch
alice 0.01 USDC
bob 0.01 USDC
0x1111111111111111111111111111111111111111 0.01 USDC
```

5. Approve from the **approver account** (never the requester) → expect one
   approval, three simulations, at most three KeeperHub executions, exactly
   one transfer per item, final `BATCH COMPLETE` receipt.
6. Verify with `/status <payout_id>` and against KeeperHub/Basescan.

## Real Batch Mainnet Proof (2026-08-12)

A real 2-recipient batch was executed on Base mainnet and independently
cross-verified read-only. Re-run the proof at any time:

```
npm run m5:verify-proof
```

(Read-only: Supabase SELECTs, KeeperHub `get_direct_execution_status` only,
public Base RPC. It never calls `execute_transfer` and never writes.)

- Date: 2026-08-12 (UTC)
- Network: Base mainnet, chain ID 8453
- Command (from the member account): `/batch` with `endurance 0.01 USDC` and
  `blossom 0.01 USDC`
- Recipients: 2, 0.01 USDC each
- Aggregate requested: 0.02 USDC = 20,000 base units
- Payout ID: `08c6567f-551e-43db-818a-413b78c885b4` (source
  `telegram_batch`, workspace mode `community`)
- Payout items:
  - `5b331545-136e-44c3-b0fd-67834a253398` — endurance
  - `2e7f2b1e-91ec-4d40-ba87-84db8e6d851f` — blossom
- KeeperHub executions:
  - `ns7lystu5m67kgpm795o4` (endurance) — completed, transfer, sponsored,
    receipt verified, block 49,863,520, gas 67,350
  - `p4xptjnoxzu9lh99bra19` (blossom) — completed, transfer, sponsored,
    receipt verified, block 49,863,527, gas 84,438
- Transactions (canonical Base USDC, exactly 10,000 base units each, sender
  = configured KeeperHub wallet `0x3A77…150E`):
  - endurance: `0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda`
    → https://basescan.org/tx/0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda
  - blossom: `0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071`
    → https://basescan.org/tx/0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071
- Final aggregate state: `completed` — 2/2 items completed, 0.02 USDC
  transferred, 0 USDC not transferred
- Separation of duty: requester numeric ID ≠ approving owner numeric ID
  (exactly one `approval_granted`, actor `workspace_owner`; requester is a
  `member`). IDs are redacted here; see the audit trail with repo access.
- Cross-verification (all agree):
  - Supabase: source `telegram_batch`, exactly 2 items, 10,000 base units
    each, 20,000 total, both `completed`, one execution ID and one tx hash
    per item, unique Telegram idempotency keys
    (`tg:<chat>:m44:pay:batch:0|1`), one `succeeded` execution-phase attempt
    per item in `execution_attempts`, truthful 13-event audit lifecycle
    (`request_created` ×2 → `approval_required` → `approval_granted` →
    per-item `simulation_started`/`simulation_passed`/
    `execution_submitted`/`execution_completed` → aggregate
    `execution_completed` 2/2). No `execution_confirming` was emitted (both
    executions completed synchronously).
  - KeeperHub: both executions `completed`, `type=transfer`, `sponsored`,
    receipts `verified=true` / `success`, tx hashes identical to Supabase.
  - Base mainnet: both receipts `0x1` (success), canonical Base USDC
    (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`) Transfer logs, exactly one
    transfer per tx, 10,000 base units each, recipients match the persisted
    recipients, aggregate 0.02 USDC.
- Duplicate execution: none. One Telegram approval produced exactly two
  independently provable KeeperHub transfers; no item executed twice and no
  duplicate payout item exists for either idempotency key.
- Hash transcription note: the observed Telegram receipt quoted the blossom
  hash as `0x9d7d…2207` (63 hex digits after `0x`). That string is not a
  valid Base tx hash (odd digit count) and is stored nowhere; the canonical
  hash is `0x9d7d…2071` (64 hex digits after `0x`, satisfying the existing
  DB CHECK `transaction_hash ~ '^0x[0-9a-f]{64}$'`), confirmed identically
  in Supabase, KeeperHub, and on-chain. The receipt renderer emits hashes
  verbatim and does not truncate, so the mismatch was a manual transcription
  artifact, not a code defect. Verified programmatically: the canonical
  hash's hex body is exactly 64 characters (`^[0-9a-f]{64}$` matches), so
  the transaction_hash constraint remains unchanged.

No credentials, tokens, keys, or full Telegram identity information appear
in this section.

## M5.1 audit integrity hardening (2026-08-12)

- **Tx hash length:** the canonical blossom hash
  `0x9d7d…2071` has exactly **64 hex digits** after the `0x` prefix
  (verified programmatically: `^[0-9a-f]{64}$` matches). The existing DB
  CHECK `transaction_hash ~ '^0x[0-9a-f]{64}$'` is correct and unchanged.
  The observed Telegram receipt quoted a 63-hex-digit string (odd digit
  count) which is invalid on Base.
- **Audit event ordering:** `audit_events.created_at` previously defaulted
  to `now()`, which is transaction-scoped (`transaction_timestamp`). Events
  appended inside one transaction (e.g. `execution_submitted` then
  `execution_completed` on the synchronous KeeperHub completion path) shared
  an identical `created_at`, so their sort order was decided by a random-UUID
  `id` tiebreaker and could surface as completed-before-submitted. Migration
  `0006_audit_clock_timestamp.sql` changes the default to `clock_timestamp()`
  (per-statement), so the truthful invariant
  `simulation_started < simulation_passed < execution_submitted <
  execution_completed` sorts correctly. The write order was already correct;
  only the timestamp semantics were ambiguous.
- **Payout-level timestamps:** `payouts.approved_at` / `completed_at` /
  `cancelled_at` are now populated at the repository choke points:
  `createPayout` stamps them when a payout is created already in that state
  (M3 auto-approve), and `transitionPayoutState` stamps them when a payout
  transitions into `approved` / `completed` / `cancelled` (M4 approval,
  M5 batch settlement, execution sync). Stamps are never overwritten
  (`COALESCE`). Historical payouts (including the 2026-08-12 real batch)
  are left untouched — their timestamps were never captured and are not
  fabricated retroactively.
- Regression tests: DB-level audit-order-within-one-transaction test,
  execution-service submitted-before-completed test, payout timestamp
  population test, and the programmatic 64-hex hash invariant inside
  `npm run m5:verify-proof`.

No credentials, tokens, keys, or full Telegram identity information appear
in this section.

## Deferred

CSV upload, `/distribute` dashboard flow, item-level retry tooling,
KeeperHub native batch adoption (revisit when it offers atomicity + audit
parity), batch progress throttling, per-recipient daily limits.

No credentials appear in this document.
