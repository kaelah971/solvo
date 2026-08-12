# M6 — Judge Mode + Deployment

## Purpose

Judge Mode is a restricted **real-execution** environment so hackathon judges
can independently verify Solvo without the founder operating the backend.

- It is **NOT sandbox** — real Base USDC moves for authorized judges.
- It is **NOT public** — only allowlisted Telegram numeric IDs can execute.
- It is **NOT** the development operator path or the community workspace.
- Every judge transaction is persisted, auditable, and returns proof
  (execution ID, tx hash, BaseScan link, amount, recipient, status).

Target flow:

```
JUDGE
→ opens the Solvo Telegram bot
→ is recognized as an authorized judge (numeric Telegram allowlist)
→ submits /judgepay <address> <amount> USDC
→ Solvo validates + applies the deterministic judge policy
→ auto-approval happens only within strict caps
→ KeeperHub simulates → executes
→ Solvo persists proof
→ Telegram returns the tx hash and execution receipt
→ judge inspects proof via /status and BaseScan
```

## Environment variables

Server-side only. Never use `NEXT_PUBLIC_` for these. Never log them.

| Variable | Meaning | Default |
|---|---|---|
| `JUDGE_MODE_ENABLED` | `"true"` enables the judge boundary | `false` |
| `TELEGRAM_JUDGE_USER_IDS` | comma-separated numeric Telegram IDs of judges | empty |
| `JUDGE_PER_TX_LIMIT_USDC` | per-transaction cap | `0.10` |
| `JUDGE_DAILY_LIMIT_USDC` | daily cap | `1.00` |
| `KEEPERHUB_JUDGE_INTEGRATION_ID` | optional KeeperHub wallet integration id | empty |

`KEEPERHUB_JUDGE_INTEGRATION_ID` is only forwarded if the KeeperHub MCP's
`execute_transfer` schema advertises an integration selector at runtime. The
current schema does not (verified via `listTools`/`list_integrations`), so it
is a no-op until the platform supports per-integration direct execution.

All vars are documented in `.env.example`.

## Judge allowlist setup

1. Ask the judge for their Telegram numeric ID (e.g. via @userinfobot).
2. Set `TELEGRAM_JUDGE_USER_IDS=111111111,222222222` in the deployment env.
3. Set `JUDGE_MODE_ENABLED=true`.
4. Run `npm run judge:doctor` and confirm `READY FOR JUDGE TEST: YES`.

Usernames and display names are never accepted as authority. The allowlist is
the only identity primitive.

## Wallet / isolation model

The current KeeperHub org exposes **one** web3 integration
(`ym7pkc73r1hhnu6fonfkp` → `0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E`),
and the MCP's `execute_transfer` accepts no integration selector today. Per
M6 section 2, Solvo does **not fake isolation**:

- Judge isolation is enforced in Solvo: a dedicated `judge` workspace
  (`00000000-0000-4000-8000-000000000003`), a deterministic judge policy, and
  the numeric Telegram allowlist.
- The current proof executions use the configured KeeperHub org wallet.
- The code is ready for a separate integration id via
  `KEEPERHUB_JUDGE_INTEGRATION_ID` the moment KeeperHub exposes per-integration
  direct execution (schema-discovered, never invented).
- Recommendation for the final live judge proof: use a **separate KeeperHub
  org/account** with its own funded wallet if the platform does not add
  integration selectors — that is the only platform-supported separation.

## Policy limits

AUTO-APPROVE only when **every** gate passes; otherwise BLOCK with a plain
reason and nothing persisted/submitted:

- `JUDGE_MODE_ENABLED=true`
- Telegram numeric user ID ∈ `TELEGRAM_JUDGE_USER_IDS`
- amount > 0
- amount ≤ 0.10 USDC (100,000 base units)
- daily judge spend after this payment ≤ 1.00 USDC (1,000,000 base units)
- chain 8453 (Base) and token = canonical Base USDC
  (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`)
- judge workspace active

There is **no** manual approval step in Judge Mode. No usernames, no display
names, no "anyone in the group", no token/network choice, no batch.

## Telegram commands

| Command | Behavior |
|---|---|
| `/judgepay <address> <amount> USDC` | Judge payment. Only allowlisted judges. |
| `/status <payout_id>` | Judge payouts show mode, amount, recipient, state, execution ID, tx hash, BaseScan link, daily spend, funds-moved note. Non-judges get "not found". |
| `/help` | Lists Judge Mode in the modes section. |

Natural language is **not** supported in Judge Mode (deferred). Aliases and
batch are **not** supported in Judge Mode.

Duplicate Telegram delivery (same chat + message id + `judgepay`) returns the
existing payout and never executes twice. `execution_unknown` is never
auto-retried; `/status` states this explicitly.

## Webhook deployment

Local dev uses polling; production must use the webhook route:

```
# local
npm run telegram:dev          # polling as @SolvoAgentBot (no webhook)

# production
npm run telegram:set-webhook -- --url https://<domain>/api/telegram/webhook
```

- `telegram:set-webhook` uses `TELEGRAM_BOT_TOKEN`, forwards
  `TELEGRAM_WEBHOOK_SECRET` when configured, verifies the webhook after
  setting, never prints the token, and is idempotent.
- `npm run telegram:clear-webhook` clears it (drop pending updates).
- Never leave polling and webhook active together.

## Security model

- Judge allowlist is numeric IDs only, server-side.
- No public web route can execute funds; `/judge` is informational.
- Deterministic parser + policy; no LLM.
- Idempotency keys are unique per chat+message+`judgepay`.
- Daily cap re-checked inside the persistence transaction (no TOCTOU within
  the architecture's guarantees).
- Conservative daily-cap accounting: counts `approved`, `simulating`,
  `submitted`, `confirming`, `completed`, `execution_unknown`; excludes
  cancelled/validation_failed/simulation_failed where funds did not move.
- Secrets are never logged (bot token, webhook secret, KeeperHub key,
  database URL, private keys).

## How to fund the judge wallet

The executing wallet is the configured KeeperHub org wallet
(`0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E` today). Fund it with:

- Base ETH for gas (KeeperHub sponsors gas in this org, but keep a small
  balance for safety), and
- Base USDC (canonical `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`) to cover
  judge tests (at least a couple of dollars).

For the final judge proof, prefer a separate KeeperHub org with its own
funded wallet (see isolation model).

## Judge doctor

```
npm run judge:doctor
```

Read-only. Reports: Judge Mode enabled/disabled, number of judge IDs, DB OK,
judge workspace state/limits, KeeperHub readiness + wallet, per-tx/daily
caps, today's judge spend, Telegram bot identity, webhook state, and
`READY FOR JUDGE TEST YES/NO`. Never executes a payment.

## How judges test safely

1. Judge opens the bot privately (or a group) and sends
   `/judgepay <recipient-wallet> 0.01 USDC`.
2. Solvo replies with `JUDGE PAYMENT REQUEST` → `CHECK` → `EXECUTE` → `PROVE`
   (execution ID, tx hash, BaseScan link, amount, recipient, status).
3. Judge runs `/status <payout_id>` to re-inspect.
4. Judge verifies the transfer on BaseScan.

Blocked attempts return `JUDGE PAYMENT BLOCKED / Reason: … / Nothing was
submitted.`

## What proof is returned

Every completed judge transaction returns: KeeperHub execution ID,
transaction hash, BaseScan link, amount, recipient, status. The same data is
persisted in `payouts` / `payout_items` (source type `judge_telegram`) with a
full `audit_events` lifecycle (`request_created`, `approval_granted` with
actor type `judge`, simulation/execution events).

## Verify on BaseScan

Open the returned link (`https://basescan.org/tx/<hash>`) and confirm:

- status success,
- USDC Transfer of exactly the requested amount,
- recipient address,
- sender = the configured KeeperHub wallet,
- chain = Base mainnet (8453).

## Known limitations

- One KeeperHub org wallet today; separate judge wallet not yet possible via
  the MCP (see isolation model).
- Natural language, aliases, and batch are intentionally unsupported in
  Judge Mode.
- No claim links, CSV upload, or dashboard (later milestones).
- Webhook mode requires a public HTTPS URL (Vercel recommended).

No credentials appear in this document.
