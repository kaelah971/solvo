# M3 — Telegram Agent Foundation

## Goal

Make Solvo usable from Telegram for the first real end-to-end agent flow:

```
TELEGRAM INSTRUCTION
→ INTERPRET
→ VALIDATE
→ PERSIST REQUEST
→ POLICY CHECK
→ APPROVAL DECISION
→ KEEPERHUB SIMULATION
→ REAL EXECUTION
→ OBSERVE
→ PERSIST OUTCOME
→ TELEGRAM PROOF
```

Two modes only: **sandbox** (public, simulated) and **development** (real Base
USDC for allowlisted Telegram user IDs, capped at 0.10 USDC per transaction).

## Architecture

```
Telegram (webhook or polling)
  → src/server/telegram/bot.ts        grammY glue (message routing, editing)
  → src/server/telegram/parsing.ts    deterministic command + NL parser
  → src/server/telegram/flows/pay-flow.ts    orchestration (both modes)
  → src/server/telegram/flows/status-flow.ts /status
  → src/server/telegram/policy.ts     deterministic policy evaluation
  → src/server/db/*                   M2 repositories (server-only)
  → src/server/execution/execution-service.ts   M2 execution service
  → src/server/keeperhub/*            M1 KeeperHub adapter (real gateway)
```

The Telegram handlers orchestrate domain services; they do not contain
KeeperHub execution logic.

## Bot setup

1. Create a bot with [@BotFather](https://t.me/BotFather) → `/newbot`. Copy the token.
2. Set `TELEGRAM_BOT_TOKEN` in `.env`.
3. Get your numeric user ID from [@userinfobot](https://t.me/userinfobot).
4. Add it to `TELEGRAM_ALLOWED_DEV_USER_IDS` (comma-separated) for real execution.
5. (Webhook deployments) set `TELEGRAM_WEBHOOK_SECRET` and call
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/api/telegram/webhook&secret_token=<SECRET>`.
6. (Optional) set `NEXT_PUBLIC_TELEGRAM_BOT_URL=https://t.me/<username>` for the marketing CTA.

Never log the token. `TELEGRAM_*` variables are server-only.

## Environment variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token (required for the bot) |
| `TELEGRAM_WEBHOOK_SECRET` | Webhook secret, verified timing-safe against `X-Telegram-Bot-Api-Secret-Token` |
| `TELEGRAM_ALLOWED_DEV_USER_IDS` | Comma-separated numeric Telegram IDs allowed to run real development execution |
| `NEXT_PUBLIC_TELEGRAM_BOT_URL` | Public deep link for the marketing site CTA |
| `DATABASE_URL`, `KEEPERHUB_API_KEY` | Existing M2/M1 credentials (server-only) |

## Sandbox vs development mode

Mode is resolved from the Telegram numeric user ID:
`resolveMode(userId, allowlist)` → development if allowlisted, else sandbox.

- **Sandbox** — validation, persistence, policy and a simulated decision path.
  Final message always states `SIMULATION COMPLETE` / `NO FUNDS WERE MOVED`.
  Never calls KeeperHub simulation or execution. No tx hash or execution ID
  is ever fabricated.
- **Development** — only allowlisted numeric user IDs. Runs the full M2
  execution service: persist → policy → KeeperHub simulation →
  execute_transfer → poll → persist hash/proof → Telegram proof message.
  Hard cap 0.10 USDC per transaction. No daily limit in M3.

## Parser behavior

`/pay <address> <amount> USDC` and limited natural language:

- `Send 0.01 USDC to 0x...`
- `Pay 0x... 0.01 USDC`
- `send 0.05 usdc to 0x...`

Rules: Base USDC only; address must be a valid EVM address (checksum checked
later in the flow); amounts must be positive; no username-based recipients
(`Pay Alex 5 USDC` → explicit-address prompt); ambiguous text → guidance to
use `/pay`. No LLM is used.

## Policy rules (deterministic)

`evaluatePolicy({mode, workspaceMode, userId, amountBaseUnits, chainId, tokenAddress, workspaceActive, allowedDevUserIds})`:

- chain must be Base (8453) and token the canonical Base USDC
- workspace must be active
- sandbox → auto-approve as simulation
- development → auto-approve only when allowlisted, amount ≤ 0.10 USDC
- everything else → blocked (no manual approval workflow exists in M3;
  `approval_required` is a reserved decision, never emitted as working)

## Telegram identity model

Only the numeric user ID (`ctx.from.id`) is trusted for authorization —
never usernames, display names or chat names. The numeric ID is stored as
`payouts.requester_id`. Authorization is checked server-side in the policy
module; message routing is not the security boundary.

## Idempotency

Duplicate Telegram deliveries are handled by a stable Solvo-side idempotency
key derived from the Telegram identity:

```
tg:<chatId>:<messageId>:pay   (falls back to the update id when no message id)
```

It is the unique `payout_items.idempotency_key`. A second delivery of the
same update returns the existing payout and starts no duplicate execution.
KeeperHub-side idempotency (M2) additionally prevents duplicate broadcasts
after crashes or ambiguous outcomes.

## Webhook vs polling

- Webhook: `POST /api/telegram/webhook` (Next.js route, node runtime). Verifies
  the secret token with a timing-safe comparison when configured, accepts
  Telegram update JSON only, returns 4xx on malformed input. No GET handler.
- Polling for local development: `npm run telegram:dev` (long polling).
  Never run webhook and polling simultaneously.

## Failure behavior

- Validation: `The destination address is invalid. Nothing was submitted.`
- Policy: `This payment is outside the execution policy. Nothing was submitted.`
- Simulation: `KeeperHub simulation failed. No transaction was broadcast.`
- Execution: `The transaction was not completed. Review is required before retrying.`
- Unknown: `KeeperHub accepted the request, but the final state could not be
  confirmed. Solvo will not automatically send another transaction.`

`/status <payout_id>` reads persisted M2 state and explicitly shows
`NO FUNDS WERE MOVED` or `Execution state is unknown. Solvo will not
automatically retry this payment.` It never rebroadcasts.

## Security boundaries

- No public real execution: only allowlisted numeric user IDs, only through
  Telegram updates, only Base USDC, only ≤ 0.10 USDC.
- No browser-triggered transfers (the webhook route only processes Telegram
  updates through grammY).
- Webhook secret verified timing-safe; malformed updates rejected.
- No Telegram usernames as wallet identities.
- No automatic retries after ambiguous state.
- Rate limiting is deferred (documented as future work).

## Developer commands

| Command | Purpose |
|---|---|
| `npm run telegram:dev` | Long-polling bot for local development |
| `npm run telegram:doctor` | Checks token, bot identity, webhook state, env mode, allowlist, DB, KeeperHub |
| `npm test` / `npm run test:db` | Offline / DB integration tests (never move funds) |

## Command menu registration

Telegram's slash-command suggestions (`/` in the chat) are registered
automatically — no manual BotFather maintenance is required.

**Source of truth:** `src/server/telegram/commands.ts` (`SOLVO_COMMANDS`). A
command must NOT be added there before its implementation is live; the
invariant is enforced by `validateCommands` and `tests/telegram/command-menu.test.ts`
(exact implemented set, no deferred commands, no duplicates, Telegram-valid
names/descriptions).

**Scoped menus** (via `bot.api.setMyCommands`):

- default scope → private-safe set: `/start /help /pay /status`
- `all_group_chats` scope → full set: `/start /help /pay /status /workspace /member /recipient /batch`

**Polling mode** (`npm run telegram:dev`): registration runs once at startup
before polling begins and logs `TELEGRAM COMMAND MENU    REGISTERED` (or a
sanitized `REGISTRATION FAILED — menu may be stale`; polling continues either
way).

**Webhook/deployed mode:** serverless routes must not perform network calls at
boot or per-update, so registration is an explicit one-time bootstrap:
`npm run telegram:commands` (idempotent, only calls `setMyCommands`, run once
after each deploy).

**Adding a future command:** implement it first, then add one entry to
`SOLVO_COMMANDS`; the menu, `/help` command list (derived from the same
source) and tests stay in sync automatically.

## Safe sandbox test

1. `npm run telegram:dev` (or set the webhook).
2. Message the bot: `/start`, then `/help`.
3. Send `/pay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.01 USDC`
   — expect `SIMULATION COMPLETE` / `NO FUNDS WERE MOVED`.
4. Send `Send 0.01 USDC to 0x742d35Cc6634C0532925a3b844Bc454e4438f44e` — same result.

## Deliberate real development test

Only after `npm run telegram:doctor` passes, the operator is allowlisted, and
the development wallet holds Base USDC:

1. Message the bot: `/pay 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 0.01 USDC`
2. Expect the CHECK → EXECUTE → PROVE progression and a final message with the
   KeeperHub execution ID and transaction hash.
3. Verify with `/status <payout_id>`.

This is the only new real-payment surface in M3 and requires explicit operator
action.

## Real Mainnet Execution Proof

First successful real Solvo Telegram → KeeperHub → Base USDC execution,
independently verified on Base mainnet, KeeperHub, and Supabase.

- **Date:** 2026-08-11
- **Network:** Base mainnet (chain id 8453)
- **Amount:** 0.01 USDC (10000 base units)
- **Recipient:** `0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486`
- **KeeperHub execution ID:** `idk1qp7e6x326xd61sa30`
- **Transaction hash:** `0x8a56df12a94a25c97cfb71cc3a86a14f2a65c65298833ff0489ffb865be43201`
- **Basescan:** https://basescan.org/tx/0x8a56df12a94a25c97cfb71cc3a86a14f2a65c65298833ff0489ffb865be43201
- **Final persisted state:** payout `completed` / payout item `completed`
  (payout `d5be5e42-5894-4d8a-9255-ec9c33077fd2`, item
  `40c60ddb-dfa7-48f7-b922-a057ded39058`, idempotency key `tg:<chat>:m13:pay`)
- **Sender (on-chain):** KeeperHub wallet `0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E`
  (execution was gas-sponsored; the outer transaction was relayed by KeeperHub)

Verified lifecycle (audit trail, Supabase):

```
request_created → approval_granted → simulation_started
→ simulation_passed → execution_submitted → execution_completed
```

The execution was performed through KeeperHub (`execute_transfer`), which
simulated, sponsored and relayed the transaction; Solvo never signs or
broadcasts directly. Telegram displayed the proof message ("Payment completed.
Transaction proof available.") only after KeeperHub reported `completed` with
the verified transaction hash. On-chain verification confirms one canonical
Base USDC `Transfer` event of exactly 10000 base units from the KeeperHub
wallet to the recipient, receipt status `success` (block 49841993), and
KeeperHub reports `completed` with the same hash and `sponsored: true`.

**Sandbox proof (safe public behavior):** a non-allowlisted user sending the
same instruction is routed to sandbox: request → policy → simulated decision
path, final message `SIMULATION COMPLETE` / `NO FUNDS WERE MOVED`, no KeeperHub
call, no transaction hash, no execution ID ever fabricated. Real execution
remains restricted to allowlisted development user IDs, capped at 0.10 USDC.

## Deferred

Batch payouts, claim links, judge mode, community roles/approval UI,
LLM-based interpretation, daily limits, rate limiting, message-editing
reliability guarantees.
