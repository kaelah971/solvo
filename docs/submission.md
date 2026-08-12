# Solvo — KeeperHub "The Last Mile" Hackathon Submission

## Product summary

Solvo is a conversational treasury execution agent. A payment instruction —
a Telegram command or a community request — becomes a validated, simulated,
executed, and independently provable Base USDC transaction through KeeperHub.
Solvo persists every step, enforces deterministic policy per mode, never
auto-retries an unknown outcome, and never fabricates proof.

Modes:

- **Sandbox** — simulation only, no funds move.
- **Development** — allowlisted operator real execution (0.10 USDC/tx cap).
- **Community** — group payouts require a human approval by an owner/approver
  (separation of duty enforced).
- **Judge** — restricted real execution for allowlisted hackathon judges via
  `/judgepay` (0.10 USDC/tx, 1.00 USDC/day caps).

## KeeperHub usage

- MCP tools: `execute_transfer` (simulate + execute), `get_direct_execution_status`
  (read-only status/receipts), `list_integrations` / `get_wallet_integration`
  (wallet discovery), `list_action_schemas` (chain support).
- Organization API key (`kh_…`) server-side only; never logged.
- All verification scripts use read-only tools (status + public RPC) and never
  call `execute_transfer`.

## Milestone proof summary

| Milestone | What was proven | Proof artifacts |
|---|---|---|
| M1 | Real KeeperHub execution on Base mainnet | `docs/keeperhub-execution-proof.md` |
| M2 | Persisted execution state (payouts, items, attempts, audit) | `docs/m2-persisted-execution-state.md` |
| M3 | Telegram single-payment agent (sandbox + dev) | `docs/m3-telegram-agent-foundation.md` |
| M4 | Community workspace + human approval | `docs/m4-community-approval.md` |
| M5 | Batch payouts (2 recipients, real mainnet) | `docs/m5-batch-payouts.md` (`npm run m5:verify-proof`) |
| M5.1 | Audit integrity hardening (timestamps, hash length, payout stamps) | `docs/m5-batch-payouts.md` |
| M6 | Judge Mode + deployment readiness | `docs/m6-judge-mode-deployment.md` |

### Important transaction proof links

- **M1 direct proof** — execution `idk1qp7e6x326xd61sa30`,
  tx `0x8a56df12a94a25c97cfb71cc3a86a14f2a65c65298833ff0489ffb865be43201`
  https://basescan.org/tx/0x8a56df12a94a25c97cfb71cc3a86a14f2a65c65298833ff0489ffb865be43201
  (verified by `npm run m3:verify-proof`)
- **M3 Telegram proof** — persisted in Supabase (`payout_items.transaction_hash`);
  verify with `/status <payout_id>` in Telegram.
- **M4 community proof** — community approval flow; human-approved payouts
  persisted and auditable via `/status`.
- **M5 batch proof** — payout `08c6567f-551e-43db-818a-413b78c885b4`,
  two items, 0.01 USDC each, aggregate 0.02 USDC:
  - endurance tx `0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda`
    https://basescan.org/tx/0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda
  - blossom tx `0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071`
    https://basescan.org/tx/0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071
  - re-verify read-only at any time: `npm run m5:verify-proof`

## Deployed URL

<To be filled after deployment — see Deployment below>

- Web: https://<deployed-domain>
- Telegram webhook: https://<deployed-domain>/api/telegram/webhook
- Bot: https://t.me/SolvoAgentBot

## Final judge test procedure

1. Operator sets `JUDGE_MODE_ENABLED=true` and
   `TELEGRAM_JUDGE_USER_IDS=<judge numeric id>` on the deployed environment.
2. Operator runs `npm run judge:doctor` → confirm `READY FOR JUDGE TEST: YES`.
3. Operator funds the executing KeeperHub wallet with Base USDC (and Base ETH
   for gas) — today the configured org wallet
   `0x3A77CbC62e8dAdbAF6ff29Bd082dc3f71b1c150E`; a separate KeeperHub org
   wallet is recommended for the final judge proof (see isolation note).
4. Judge opens the bot and sends:
   `/judgepay <judge-recipient-wallet> 0.01 USDC`
5. Expected: `JUDGE AUTO-APPROVED` → `✓ KeeperHub simulation passed` →
   execution completed → `PROVE` block with execution ID, tx hash, BaseScan
   link, amount, recipient, status.
6. Judge runs `/status <payout_id>`; output shows judge mode, state, caps,
   execution ID, tx hash, BaseScan link, and funds-moved note.
7. Judge verifies on BaseScan: success, exact amount, recipient, sender =
   configured KeeperHub wallet, chain 8453.
8. Daily cap reflects the new spend (`DAILY SPEND` line in `/status`).

## Demo script

1. `/start` — bot intro.
2. `/pay <address> 0.01 USDC` from a non-allowlisted account — sandbox
   simulation, no funds move.
3. `/workspace init`, `/member add <id> approver`, `/recipient add <alias>
   <address>` in a group — community setup.
4. From a member account: `/pay <alias> 0.01 USDC` → approve from the
   approver account → real transfer + proof.
5. `/batch` with two lines → one approval → per-item transfers → `BATCH
   COMPLETE` receipt.
6. From a judge account: `/judgepay <address> 0.01 USDC` → `JUDGE
   AUTO-APPROVED` → proof.
7. `/status <payout_id>` at any point.

## Environment safety notes

- Real execution only for: allowlisted development users, community
  approvers, and allowlisted judges. Everything else is sandbox.
- Caps: 0.10 USDC/tx and 1.00 USDC/day in development and judge modes;
  community workspaces carry their own per-tx/daily limits.
- Idempotency: duplicate Telegram delivery never executes twice; KeeperHub
  idempotency keys are derived from the persisted item.
- `execution_unknown` is never auto-retried; nothing is ever rebroadcast.
- No secrets in this repository (`.env` is git-ignored); never log the bot
  token, webhook secret, KeeperHub key, database URL, or private keys.

## What is sandbox vs real

| Surface | Funds move? |
|---|---|
| Sandbox workspace (`/pay` non-allowlisted) | No — simulation only |
| Development workspace (`/pay` allowlisted) | Yes — real Base USDC, capped |
| Community workspace (group `/pay`, `/batch` + approval) | Yes — after human approval |
| Judge Mode (`/judgepay` allowlisted) | Yes — real Base USDC, capped |
| Web pages (/, /judge, /sandbox, …) | Never — informational only |

## Deployment

Steps (Vercel recommended for the Next.js app + webhook):

1. Push the repository to GitHub.
2. Import into Vercel; framework preset Next.js (works out of the box).
3. Set production env vars (see `docs/m6-judge-mode-deployment.md` and
   `.env.example`): `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_DEV_USER_IDS`,
   `JUDGE_MODE_ENABLED`, `TELEGRAM_JUDGE_USER_IDS`, `KEEPERHUB_API_KEY`,
   `NEXT_PUBLIC_TELEGRAM_BOT_URL` (https://t.me/SolvoAgentBot).
4. Deploy, then set the Telegram webhook:
   `npm run telegram:set-webhook -- --url https://<domain>/api/telegram/webhook`
5. Verify with `npm run telegram:doctor` and `npm run judge:doctor`.

No credentials appear in this document.
