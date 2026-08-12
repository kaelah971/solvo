# M4 — Community Workspace + Human Approval

## Goal

Make Solvo usable inside a Telegram group as a controlled treasury agent:

```
MEMBER REQUEST
→ VALIDATE
→ POLICY
→ APPROVAL REQUIRED
→ AUTHORIZED APPROVER ACTS
→ KEEPERHUB EXECUTION
→ PROOF RETURNED TO GROUP
```

M4 proves that automation has boundaries: no community payout moves funds
until an authorized owner/approver explicitly approves it, and the requester
can never approve their own payout.

## Workspace model

A Telegram group/supergroup maps to exactly one community workspace, keyed by
the **numeric Telegram chat ID** (`workspaces.telegram_chat_id`, durable and
unique). Repeated group messages never create duplicate workspaces.

- `mode = community`
- `chain_id = 8453` (Base mainnet), canonical Base USDC
- `per_transaction_limit_base_units = 100000` (0.10 USDC) on init
- `daily_limit_base_units = 1000000` (1.00 USDC/day) on init
- `approval_policy = requires_approval`

## Role model

| Role | Can create requests | Can approve | Can manage roles | Can add recipients |
|---|---|---|---|---|
| OWNER | yes | yes | yes | yes |
| APPROVER | yes | yes | no | yes |
| MEMBER | yes | no | no | no (may list) |

Authorization always uses **Telegram numeric user IDs**. Usernames and display
names are never authority.

**Separation of duty (critical):** the requester of a restricted payout can
never approve it — even when the requester is an owner or approver
(`requester_id != approval_actor_id`). Self-approval policies are deferred.

## Setup flow

- `/workspace init` — group chats only; the caller must be a configured
  Solvo development operator (`TELEGRAM_ALLOWED_DEV_USER_IDS`). Creates the
  community workspace and makes the caller OWNER. Idempotent: a second run
  returns the existing workspace without duplicating it and without granting
  new roles. Telegram group admins are not inferred as financial owners.

## Member management (owner only)

- `/member add <numeric_id> member`
- `/member add <numeric_id> approver`
- `/member add <numeric_id> owner` (safe path for promoting a second owner)
- `/member remove <numeric_id>`
- `/member list`

Rules: owner-only; usernames rejected (`@alex` → explicit error); the final
owner cannot be removed; removals are soft (status `removed`) so the audit
history is preserved; re-adding a removed member reactivates them.

## Recipient directory

- `/recipient add <alias> <0x...>` — owner/approver only; EVM address validated
  and stored normalized (lowercase); alias is metadata, not identity; a
  duplicate alias in the same workspace is rejected; the same wallet may be
  registered under multiple aliases.
- `/recipient list` — any active member.

Telegram usernames never resolve to wallets.

## Request flow

In an initialized group, any active member can send:

- `/pay <address> <amount> USDC`
- `Send 5 USDC to alice` — only when `alice` is an existing validated alias;
  unknown or capitalized names are never resolved (they fail with an explicit
  address hint).

Every community request becomes `pending_approval` — **no amount is
auto-approved**, no matter how small. The preview message shows the irreversible
details explicitly, including the destination address:

```
PAYMENT REQUEST

TO          <alias if present>
ADDRESS     0x...
AMOUNT      5 USDC
NETWORK     BASE
REQUESTED   <requester numeric id>
APPROVAL    REQUIRED
PAYOUT ID   <8-char reference>
```

## Approval flow

The preview carries two inline buttons: **APPROVE** and **REJECT**. Callback
payloads contain only safe identifiers (`solvo:approve:<payout_id>`,
`solvo:reject:<payout_id>`) — no secrets, no authorization data.

Server-side callback verification (all against Telegram numeric IDs):

1. callback payload parses (action + payout id)
2. callback chat == workspace `telegram_chat_id` (wrong-chat rejected)
3. actor is an **active** member with role owner or approver
4. payout is currently `pending_approval` (stale/consumed callbacks rejected)
5. approval actor != requester (separation of duty)
6. approval-time policy passes (per-tx limit, daily limit, workspace active)

The state transition is executed atomically in the database with a strict
transition (`pending_approval → approved`), so concurrent approvals from two
approvers can never double-execute: exactly one wins; the other receives
"This request has already been handled." Duplicate callbacks are idempotent.

Approved payouts reuse the existing M2 execution service unchanged:
`approved → simulating → submitted → (confirming) → completed`, through
`Solvo ExecutionService → KeeperHubAdapter → KeeperHub`. No execution logic
was duplicated in the callback handler.

Rejection: `pending_approval → cancelled` with `approval_rejected` audit;
no simulation, no execution; message: `PAYMENT NOT APPROVED` / `No transaction
was submitted.`

## Callback acknowledgement ordering

Telegram callback queries must be acknowledged within seconds or Telegram
rejects them (`query is too old and response timeout expired or query ID is
invalid`). The bot acknowledges the callback **before** any KeeperHub work:

1. parse the payload
2. cheap KeeperHub-free validation (DB reads only): payout exists, chat
   matches, actor is an active owner/approver, payout is `pending_approval`,
   not self-approval, approval-time policy
3. `answerCallbackQuery` promptly — "Approval received. Processing payment."
   (or the specific rejection answer for already-handled / unauthorized /
   self-approval)
4. atomic approval transition (with the daily-limit re-check inside the same
   transaction) + KeeperHub simulation/execution + persistence
5. edit/send the final group message (edit → reply fallback)

Execution correctness never depends on `answerCallbackQuery` or message
editing succeeding: Telegram API failures are logged sanitized and swallowed,
so the polling process keeps running and the payment state stays truthful.

## Error isolation and secret-safe logging

`bot.catch` handles all update errors with a sanitized serializer
(`src/server/telegram/safe-logging.ts`). The full grammY Context / Api objects
are never logged or serialized — `ctx.api` carries the bot token. The
serializer emits only: error name, method, Telegram `error_code`, sanitized
description, `update_id`, callback action / payout id, and a redacted stack
trace. Any text that matches the configured `TELEGRAM_BOT_TOKEN` (exact value
or the Telegram token shape), `Bearer` credentials, `postgres://` URLs or
`kh_` KeeperHub keys is redacted before it reaches a log.

## Progress messages

The group sees operational facts: `APPROVED BY TREASURY ROLE` → `CHECK`
(destination, authority, policy) → `EXECUTE` (simulation passed, submitted) →
`PROVE` (execution ID + tx hash). The preview message is edited in place when
possible; correctness never depends on editing succeeding.

## Status

`/status <payout_id>` — community members may inspect payouts **of their own
workspace only**. Returns amount, destination, requester, approval state
(including `APPROVED BY <ROLE> (<actor>)` from the audit trail), execution
state, KeeperHub execution ID, tx hash, proof link, and whether funds moved.
Cross-workspace access is rejected.

## Policy

Deterministic, no LLM:

- Request time (`evaluateCommunityRequest`): inactive workspace → blocked;
  non-member → blocked; unsupported chain/token → blocked; invalid amount →
  blocked; above per-transaction limit → blocked; otherwise
  **approval_required**.
- Approval time (`evaluateCommunityApproval`, inside the transition
  transaction): workspace must be active; actor must be owner/approver; actor
  != requester; per-transaction limit; **daily limit** — sum of
  approved/simulating/submitted/confirming/completed/execution_unknown base
  units since UTC day start, checked atomically inside the same transaction
  (no TOCTOU).

## Audit events

`workspace_initialized`, `member_added`, `member_removed`, `role_changed`,
`recipient_added`, `request_created`, `approval_required`, `approval_granted`,
`approval_rejected`, `simulation_started`, `simulation_passed`,
`execution_submitted`, `execution_confirming`, `execution_completed`,
`execution_failed`, `execution_unknown`. Append-only; actor numeric IDs are
recorded internally and redacted in public documentation.

## Security guarantees (tested)

- non-member cannot create a community payout
- member cannot approve
- approver can approve another member's request
- requester cannot self-approve even when approver
- owner can manage roles; approver cannot
- usernames cannot authorize actions
- callback from the wrong chat/workspace rejected
- stale callback rejected
- duplicate callback cannot re-execute
- two concurrent approvals cannot double-execute
- rejected payout cannot execute
- completed payout cannot execute again
- execution_unknown never auto-rebroadcasts (M2 behavior preserved)

## Sandbox behavior (M3, unchanged)

Non-allowlisted private chats still get `SIMULATION COMPLETE` /
`NO FUNDS WERE MOVED`. Public groups cannot reach the development KeeperHub
wallet; community workspaces only execute after explicit approval.

## Test setup (offline)

All offline tests use the in-memory repository and a fake KeeperHub gateway:
`npm test`. `npm run test:db` runs the opt-in Postgres integration tests
(membership/chat/alias uniqueness, atomic approval transition, concurrent
approval protection, cross-workspace isolation, audit trail). No offline test
touches the Telegram or KeeperHub network, and none moves funds.

## Deliberate live community proof procedure (operator, manual)

Do NOT run this automatically. The operator performs it manually:

1. Create a Telegram test group and add @SolvoAgentBot.
2. `npm run telegram:dev` (polling) — ensure `npm run telegram:doctor` shows
   `COMMUNITY MODE AVAILABLE`.
3. As the dev operator, run `/workspace init` in the group → workspace created,
   operator becomes OWNER.
4. Add a second test account: `/member add <numeric_id> approver`.
5. From the member account (or a third account), send
   `/pay 0x... 0.01 USDC` → preview with APPROVE/REJECT buttons.
6. Approve **from the approver account** (not the requester) → one real
   KeeperHub execution of 0.01 USDC on Base mainnet, proof returned to the
   group with execution ID + tx hash.
7. Verify with `/status <payout_id>` and against Basescan/KeeperHub.

## Deferred

Batch CSV payouts, claim links, judge mode, LLM interpretation, community
approval UIs beyond inline buttons, self-approval policies, admin dashboard,
rate limiting, dynamic per-role limits.

No credentials, tokens or database URLs appear in this document.
