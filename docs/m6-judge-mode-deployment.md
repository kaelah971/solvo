# M6 / M6.1 — Judge Mode + Deployment

## Purpose

Judge Mode is a **self-serve public** real-execution environment so
hackathon judges can independently verify Solvo — open @SolvoAgentBot and
complete one tiny real Base USDC payment — **without contacting the project
owner**.

- It is **NOT sandbox** — real Base USDC moves.
- Since M6.1 it is **public**: any Telegram user can complete ONE successful
  real judge payment (`/judgepay`) under strict abuse limits. No allowlist is
  required.
- It is **NOT** the development operator path and **NOT** the community
  workspace.
- Only `/judgepay` is public. `/pay` and `/batch` never execute publicly
  (sandbox / community approval behavior is unchanged).
- Every judge transaction is persisted, auditable, and returns proof
  (execution ID, tx hash, BaseScan link, amount, recipient, status).

Target flow:

```
JUDGE
→ opens @SolvoAgentBot
→ submits /judgepay <address> <amount> USDC
→ Solvo validates + applies the deterministic public judge policy
→ auto-approval happens only within strict caps (0.01 USDC per tx)
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
| `TELEGRAM_JUDGE_USER_IDS` | OPTIONAL admin override allowlist (numeric IDs). Empty = public self-serve; non-empty = only these admins can execute | empty |
| `JUDGE_PER_TX_LIMIT_USDC` | per-transaction cap | `0.01` |
| `JUDGE_DAILY_LIMIT_USDC` | global daily cap | `0.25` |
| `JUDGE_LIFETIME_LIMIT_USDC` | global lifetime cap | `1.00` |
| `JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER` | per-Telegram-user successful execution cap | `1` |
| `KEEPERHUB_JUDGE_INTEGRATION_ID` | optional KeeperHub wallet integration id | empty |

`KEEPERHUB_JUDGE_INTEGRATION_ID` is only forwarded if the KeeperHub MCP's
`execute_transfer` schema advertises an integration selector at runtime. The
current schema does not (verified via `listTools`/`list_integrations`), so it
is a no-op until the platform supports per-integration direct execution.

All vars are documented in `.env.example`.

## Public access and admin override

- **Public (default):** with `TELEGRAM_JUDGE_USER_IDS` EMPTY, any Telegram
  user can execute one real capped judge payment. No contact with the project
  owner is needed.
- **Admin override:** setting `TELEGRAM_JUDGE_USER_IDS` to numeric IDs locks
  `/judgepay` down to those admins only (useful for a monitored final demo or
  abuse control). Admins are exempt from the per-user success cap so the
  operator can run multiple proofs, but remain subject to the per-tx, daily,
  and lifetime caps.

Usernames and display names are never accepted as authority.

## Judge caps (M6.1 defaults)

| Cap | Default | Meaning |
|---|---|---|
| Per transaction | 0.01 USDC | hard per-payment cap |
| Global daily | 0.25 USDC | all judge spend (UTC day) |
| Global lifetime | 1.00 USDC | all judge spend since enablement |
| Per user | 1 successful payment | one completed real judge payment per Telegram user |

Caps count conservative in-flight states (`approved`, `simulating`,
`submitted`, `confirming`, `completed`, `execution_unknown`) toward
daily/lifetime spend. The daily, lifetime, and per-user caps are re-checked
inside the persistence transaction (no TOCTOU within the architecture's
guarantees). The seeded judge workspace limits in
`migrations/0007_judge_mode.sql` + `0008_judge_public_limits.sql` match the
defaults.

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

## Policy limits (M6.1)

AUTO-APPROVE only when **every** gate passes; otherwise BLOCK with a plain
reason and nothing persisted/submitted:

- `JUDGE_MODE_ENABLED=true`
- public self-serve: admin allowlist EMPTY, OR Telegram numeric user ID ∈
  `TELEGRAM_JUDGE_USER_IDS` (admin-restricted mode)
- amount > 0
- amount ≤ 0.01 USDC (10,000 base units)
- daily judge spend after this payment ≤ 0.25 USDC (250,000 base units)
- lifetime judge spend after this payment ≤ 1.00 USDC (1,000,000 base units)
- public user has not already completed their 1 allowed successful payment
  (admins exempt)
- chain 8453 (Base) and token = canonical Base USDC
  (`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`)
- judge workspace active

There is **no** manual approval step in Judge Mode. No usernames, no display
names, no token/network choice, no batch, no aliases, no claim links, no
natural language.

## Telegram commands

| Command | Behavior |
|---|---|
| `/judgepay <address> <amount> USDC` | Public judge payment under caps (any user, max 0.01 USDC, one per user). |
| `/status <payout_id>` | Judge payouts show mode, amount, recipient, state, execution ID, tx hash, BaseScan link, daily + lifetime spend, my-payments count, funds-moved note. The CALLER'S OWN payout is always visible; other users get "not found"; admins may inspect any. |
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

- Public judge execution is limited to `/judgepay` under hard caps; `/pay`
  and `/batch` real execution remain unchanged (sandbox / community approval).
- Admin allowlist (when set) is numeric IDs only, server-side.
- No public web route can execute funds; `/judge` is informational.
- Deterministic parser + policy; no LLM.
- Idempotency keys are unique per chat+message+`judgepay`; duplicates never
  execute twice.
- Daily, lifetime, and per-user caps are re-checked inside the persistence
  transaction (no TOCTOU within the architecture's guarantees).
- Conservative cap accounting: counts `approved`, `simulating`, `submitted`,
  `confirming`, `completed`, `execution_unknown`; excludes
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

Read-only. Reports: Judge Mode enabled/disabled, PUBLIC SELF-SERVE vs ADMIN
RESTRICTED access mode, admin ID count, per-tx/daily/lifetime caps, per-user
success cap, DB OK, judge workspace state/limits, today's + lifetime judge
spend, KeeperHub readiness + wallet, Telegram bot identity, webhook state,
and `READY FOR JUDGE TEST YES/NO`. Never executes a payment.

## How judges test safely (self-serve)

1. Judge opens @SolvoAgentBot and sends
   `/judgepay <recipient-wallet> 0.01 USDC` — no allowlist, no contact with
   the project owner.
2. Solvo replies with `JUDGE PAYMENT REQUEST` → `CHECK` → `EXECUTE` → `PROVE`
   (execution ID, tx hash, BaseScan link, amount, recipient, status).
3. Judge runs `/status <payout_id>` to re-inspect (their own payout).
4. Judge verifies the transfer on BaseScan.

Each Telegram user can complete ONE successful judge payment; a second
attempt is blocked with a plain reason. Blocked attempts return
`JUDGE PAYMENT BLOCKED / Reason: … / Nothing was submitted.`

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
