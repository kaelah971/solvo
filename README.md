This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Solvo — KeeperHub "The Last Mile" Hackathon Submission

Solvo is a conversational treasury execution agent: a payment instruction
becomes a validated, simulated, executed and independently provable Base USDC
transaction through KeeperHub.

- **Web:** https://solvo-beryl.vercel.app
- **Bot:** https://t.me/SolvoAgentBot
- **Submission doc:** `docs/submission.md` (proof links, judge test
  procedure, demo script, safety notes)
- **Judge Mode:** `docs/m6-judge-mode-deployment.md`

**Real proof links (Base mainnet, chain 8453):**

- M5 batch (2 recipients, 0.02 USDC aggregate):
  https://basescan.org/tx/0x94323245ce213e6038e7a0b937aa62a73d5b46af962c2509a00f688b38ac8dda
  and
  https://basescan.org/tx/0x9d7d9503dcc716bb6a9192d0e8f80bc9a7483c51c342f98f1f735e2422212071
- Final public self-serve judge proof (0.01 USDC):
  https://basescan.org/tx/0x81b61704780fa0d8a983bf15d01c6043ee7f42cd730499649de23137d932c25c

**Read-only verification:**

```bash
npm run m3:verify-proof   # M1/M3 direct execution proof
npm run m5:verify-proof   # M5 batch proof
npm run judge:verify-proof  # final public judge proof
npm run judge:doctor      # judge readiness (no payments)
```

No secrets appear in this repository.

## Table of Contents

- [Quickstart for judges and community admins](#quickstart-for-judges-and-community-admins)
- [Telegram setup](#2-telegram-setup)
- [Workspace setup](#4-telegram-workspace-setup)
- [Members and approvers](#5-add-members-and-approvers)
- [Recipient aliases](#6-add-recipient-aliases-and-wallets)
- [Payouts](#7-request-a-payout)
- [Dashboard](#8-dashboard-access)
- [KeeperHub surfaces](#3-keeperhub-surfaces-used)
- [Production setup](#11-production-setup-notes)

## Quickstart for judges and community admins

### 1. Open Solvo

- **Website:** https://solvo-beryl.vercel.app
- **Telegram bot:** https://t.me/SolvoAgentBot
- **GitHub:** https://github.com/kaelah971/solvo

### 2. Add Solvo to a Telegram group

1. Open the Telegram group where the community/team coordinates payouts.
2. Tap the group name at the top of the chat.
3. Choose **Add Members / Add Users**.
4. Search for `@SolvoAgentBot`.
5. Add the bot to the group.
6. Make sure the bot can read messages/commands in the group.
7. If Telegram asks for permissions, allow the bot to receive commands.

> Solvo community workspace commands are meant to be used **inside the
> group**, not in a private DM.

### 3. Initialize the workspace

```
/workspace init
```

- Run this in the Telegram group.
- The initializer becomes the workspace owner if allowed by configuration.
- Production deployments may restrict workspace initialization with
  `TELEGRAM_ALLOWED_DEV_USER_IDS`.

### 4. Add team members

```
/member add <telegram_numeric_user_id> member
/member list
```

- Use Telegram **numeric user IDs**, not `@usernames`.
- Members can request payouts.
- Members cannot approve their own payout.

### 5. Add approvers

```
/member add <telegram_numeric_user_id> approver
/member list
```

- Approvers can approve eligible pending requests.
- The requester cannot approve their own payout.
- This preserves separation of duty.

### 6. Add recipient aliases and wallets

```
/recipient add blossom 0x85522bdE267d05bf8CE8813F97c75417b7894A33
/recipient list
```

- Aliases are **workspace-scoped**.
- The alias must be added before `/pay blossom` works.
- Aliases are **not Telegram usernames**.
- Saving a recipient does not move funds.

### 7. Request a payout

```
/pay blossom 0.01 USDC
```

or:

```
/pay 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486 0.01 USDC
```

- In a community group, `/pay` creates a **pending approval request** — it
  does **not** execute immediately.
- Another eligible approver must approve.
- Solvo currently supports **Base mainnet USDC only**.

### 8. Use addressed commands when the group has many bots

**If your Telegram group already has multiple bots, use Solvo-addressed
commands so Telegram routes the command clearly to Solvo:**

```
/pay@SolvoAgentBot blossom 0.01 USDC
/dashboard@SolvoAgentBot
/recipient@SolvoAgentBot list
/member@SolvoAgentBot list
/workspace@SolvoAgentBot init
```

**The normal commands also work when there is no bot-command conflict:**

```
/pay blossom 0.01 USDC
/dashboard
/recipient list
/member list
```

### 9. Approve and prove

- An eligible approver approves the pending request from Telegram.
- Solvo submits approved Base USDC execution through the **KeeperHub MCP**.
- Solvo stores execution status, the KeeperHub execution ID, the tx hash when
  available, and proof/audit events.
- **Completed** means the execution pipeline recorded proof.
- **Prepared** does not mean paid.
- **Approved** does not mean executed.

### 10. Open the dashboard

```
/dashboard
```

or:

```
/dashboard@SolvoAgentBot
```

- Active workspace members receive a short-lived **one-time dashboard link**.
- The dashboard is **read-only in M12**.
- It shows overview, approvals, payouts, batches, claims, recipients, members,
  policies, agent runs, and audit.
- If a valid session is missing, no workspace data is shown.

### 11. Optional public judge proof

```
/judgepay <wallet> 0.01 USDC
```

- This is the capped Judge Mode proof path.
- Base mainnet USDC only.
- One successful payment per user may be enforced depending on deployment
  config.

## How to use Solvo

### 1. Supported network and asset

- **Execution support today: Base mainnet (chain 8453) USDC only.**
- More chains and assets are future work; anything else is declined with a
  clear message.

### 2. Telegram setup

Add `@SolvoAgentBot` to the group:

1. Open the Telegram group where the community/team coordinates payouts.
2. Tap the group name at the top of the chat.
3. Choose **Add Members / Add Users**.
4. Search for `@SolvoAgentBot`, add it, and allow it to receive commands.

When the group has several bots, commands addressed to Solvo work exactly
like the plain forms (bot-username matching is case-insensitive):

```
/workspace@SolvoAgentBot init
/member@SolvoAgentBot list
/recipient@SolvoAgentBot list
/pay@SolvoAgentBot blossom 0.01 USDC
/dashboard@SolvoAgentBot
```

### 3. KeeperHub surfaces used

- **MCP** — the bot talks to KeeperHub through the MCP adapter.
- **Direct KeeperHub execution through MCP** — execution happens only after
  an owner/approver approves, through the existing execution pipeline.
- **Audit trail / proof** — every request, approval, and execution is
  recorded; proof (tx hashes) comes only from the execution pipeline.
- **Not used in this version:** KeeperHub CLI, Workflow Builder, x402/MPP.

### 4. Telegram workspace setup

In the Telegram group where the community coordinates payouts, run:

```
/workspace init
```

- Run it **inside the group** (private chats are not community workspaces).
- The initializer becomes **owner** if their numeric Telegram ID is in
  `TELEGRAM_ALLOWED_DEV_USER_IDS` (the authorized initializer allowlist).
- Re-running it is idempotent — it returns the existing workspace.

### 5. Add members and approvers

```
/member add <telegram_numeric_user_id> member
/member add <telegram_numeric_user_id> approver
/member list
/member remove <telegram_numeric_user_id>
```

Roles:

- **owner** — can manage members/recipients and approve eligible requests.
- **approver** — can approve eligible requests and manage recipients.
- **member** — can request payouts but cannot approve.
- **Requesters cannot approve their own payout** (separation of duty is
  enforced server-side).

Notes:

- **Numeric Telegram user IDs are required — not `@usernames`** (usernames
  cannot authorize actions). Get an ID from `@userinfobot` or the bot's
  replies.
- If someone is not added as an active member, their group commands are
  unavailable or denied.

### 6. Add recipient aliases and wallets

```
/recipient add blossom 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486
/recipient list
```

- Aliases are **workspace-scoped** — they only exist in the group where they
  were added.
- `/pay blossom 0.01 USDC` only works **after** `blossom` has been added as a
  recipient alias in that workspace.
- Aliases are **not Telegram usernames**.
- Saving a recipient does not move funds.

### 7. Request a payout

```
/pay blossom 0.01 USDC
/pay 0x76D7a718CcDc1c132c52D4C05eA0c2FA8e657486 0.01 USDC
```

- In community groups, `/pay` creates a **pending approval request** — it
  does **not** execute immediately.
- Another eligible approver must approve it; **self-approval is blocked**.
- Unknown alias? The bot replies: *Recipient alias not found. Add it with
  `/recipient add <alias> <wallet>`.*

### 8. Dashboard access

```
/dashboard
```

- Active workspace members get a short-lived **one-time dashboard link** via
  an inline "Open dashboard" button.
- The dashboard is **read-only** in M12.
- It shows: overview, approvals, payouts, batches, claims, recipients,
  members, policies, agent runs, and audit.
- Without a valid session it shows no workspace data.

### 9. Claim links

```
/claimpay 0.01 USDC
/claimstatus <claim-id>
```

- Claim links collect the recipient wallet **later** — the recipient enters
  their wallet on the claim page.
- **Wallet entered does not mean funds moved.**
- Approval/execution are still required before anything moves.

### 10. Judge Mode

```
/judgepay <wallet> 0.01 USDC
```

- Capped public proof path (Base USDC only).
- One successful payment per user is enforced when that config is enabled
  (`JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER`).

### 11. Production setup notes

Before live dashboard use, the two pending migrations must be applied:

```bash
npm run db:migrate   # applies 0013 (claim reissue) + 0014 (dashboard login tokens)
```

Required environment:

- `SOLVO_DASHBOARD_COOKIE_SECRET` — required in production for dashboard
  sessions; without it production refuses all dashboard cookies.
- `NEXT_PUBLIC_APP_URL` — the deployed app URL, e.g.
  `https://solvo-beryl.vercel.app`.

Telegram wiring:

```bash
npm run telegram:set-webhook -- --url https://solvo-beryl.vercel.app/api/telegram/webhook
npm run telegram:commands   # register the bot command menu
```

## Roadmap

### Shipped

- M1 KeeperHub real execution proof
- M2 persisted execution state
- M3 Telegram agent foundation
- M4 community workspace + human approval
- M5 batch payouts + audit integrity
- M6 judge mode + deployment readiness
- M7 claim links
- M8 S1 deterministic agent core
- M8 S2 optional model provider layer
- M8 S3 Telegram conversational UX
- M9 agent hardening / real-world language QA (216-phrase corpus, mutation
  and tolerance hardening, live-style treasury phrases)
- M10 natural-language batch / distribute (explicit 2–10 recipient batch
  phrases — uniform "each", exact split totals, explicit per-recipient
  amounts; one `pending_approval` payout + N payout_items; idempotent
  duplicate delivery; no funds move until owner/approver approval; KeeperHub
  execution only after approval through the existing execution pipeline)
- M11 smarter claim links (claim status read model; `/claimstatus <id>` +
  natural-language claim status phrases; web claim state UX for
  pending/claimed/expired/rejected/approved/completed/unavailable; expiry
  visibility; reissue service — reissue creates a NEW claim row + new token,
  the old claim is never resurrected; no-leak same-workspace/member gate;
  pipeline-only proof; adversarial/truthfulness hardening)
- M12 web admin dashboard (read-only operator console — shipped scope below)

**M8 S3 shipped scope (exactly what is implemented and tested):**

- natural-language payment sentence shapes in community group chats
  (`SOLVO_AGENT_ENABLED=true`), routed only on deterministic parse failure
- alias and 0x-address payments via the workspace recipient directory
- claim-link creation from natural language
- status lookups that read the payout pipeline
- memo/reason capture into prepared payout items (sanitized, 140-char cap)
- truthful reply contract (no fabricated hashes, proof, or completion claims)
- no auto-execution — every prepared payment stays `pending_approval`
- approval by an owner or approver is still required
- Judge Mode is not reachable through natural language
- the model provider remains opt-in and default-off
  (`SOLVO_AGENT_PROVIDER=static` is the default; no model calls are made
  unless an operator explicitly enables the provider)

**M10 shipped scope (exactly what is implemented and tested):**

- natural-language batch phrases in community group chats with an explicit
  batch signal and 2–10 recipients, each resolving to a workspace alias or a
  valid 0x address (all-or-clarify: one unresolved recipient clarifies the
  whole request, never a partial batch)
- uniform per-recipient amounts (`pay blossom and endurance 0.01 USDC each`)
- exact split totals (`split 0.05 USDC between blossom and endurance`;
  non-divisible totals clarify, never round)
- explicit per-recipient amounts (`pay blossom 0.01 USDC and endurance 0.02
  USDC`)
- persists ONE `pending_approval` payout with N `payout_items` (canonical M5
  batch shape, `source_type = telegram_batch`, audit metadata marks
  `telegram_natural_language_batch`; no schema change)
- Telegram reply lists recipients, total, and approval-required state, with
  APPROVE BATCH / REJECT buttons
- duplicate delivery of the same message is idempotent (same payout, no
  duplicate items/audits, truthful current state reply)
- status of a prepared batch reads the payout row, never the agent run
- no funds move until an owner or approver approves; KeeperHub execution
  happens only after approval through the existing execution pipeline
- hostile mutations (approval bypass, execute-now, fabrication, policy
  bypass, external access) decline with zero artifacts (640+ mutation checks
  per layer)
- not shipped: CSV upload, "pay everyone"/"pay all contributors"/group
  recipients, claim-link batches, private/DM batches, Judge Mode batches,
  auto-approval, or direct execution from natural language — all remain
  declined or clarified with zero artifacts

**M11 shipped scope (exactly what is implemented and tested):**

- claim status read model (`getClaimStatusForMember`, effective statuses
  pending/claimed/approved/rejected/expired/completed/unknown, computed
  expiry, same-workspace active-member gate, generic no-leak output)
- `/claimstatus <claim-id>` Telegram command + natural-language claim status
  phrases (`check claim <id>`, `what happened to claim <id>`, …) — read-only,
  no raw token/hash ever shown
- web claim state UX on `/claim/[token]`: valid, already-claimed, expired,
  rejected, approved/payment-prepared, completed (proof only from the payout
  pipeline), not-confirmed, and unavailable — wallet submit records the
  destination only
- expiry visibility everywhere (expired is computed, never stored; expired
  claims cannot be claimed or approved)
- reissue service (`reissueClaimLink`): creates a NEW claim row + new token;
  the old claim is never resurrected and its token stays unusable; no
  payout/approval/execution during reissue
- pipeline-only proof: completion + tx hashes come only from the payout
  pipeline, never from claim rows or agent_runs (forged-run/forged-metadata
  immunity tested)
- adversarial/truthfulness hardening: hostile claim phrases decline with zero
  artifacts; no-leak, no-token-reveal, and banned-term contracts locked
- not shipped: claim-link batches, CSV/bulk claim links, Judge Mode claim
  links, auto-approval, direct execution from claim entry, raw-token
  re-display, or claim destination editing — all remain declined or deferred

**M12 shipped scope (exactly what is implemented and tested):**

Design/spec: `docs/m12-web-admin-dashboard-design.md`; claim-link behavior
reuses the M11 contract (`docs/m11-smarter-claim-links-design.md`).

- personalized Telegram `/dashboard` login (one-time 10-minute login links,
  hash-only persisted tokens, single use)
- signed `solvo_dash_session` cookie (HMAC-SHA256, HttpOnly,
  SameSite=Strict, Secure in production, 7-day TTL)
- workspace membership re-check from the repository on every request —
  removed/inactive members lose access even with a valid cookie
- `/app` overview (pending approvals, claim links, prepared vs completed
  totals, failed/unknown, active members, recent audit events + agent
  requests — never any number from `agent_runs`)
- `/app/approvals` (read-only decision queue: pending payouts, pending batch
  payouts, claimed claim links; role capability copy + separation-of-duty
  warnings)
- `/app/payouts` and `/app/payouts/[id]`
- `/app/batches` and `/app/batches/[id]`
- `/app/claims` and `/app/claims/[id]`
- `/app/recipients` (full wallets owner/approver-only, masked for members)
- `/app/members` (masked identities, role/status badges)
- `/app/policies` (mode, limits, approval requirement, spent/remaining today,
  judge/sandbox notes — read-only)
- `/app/agent-runs` and `/app/agent-runs/[id]` (observability only)
- `/app/audit` (safe whitelisted event timeline)
- read-only operator dashboard end to end — no page can approve, reject,
  execute, retry, reissue, add, edit, or delete
- pipeline-only proof — completed labels and tx hashes appear only from the
  payout pipeline; completed-without-hash and not-confirmed never show proof
- no raw claim token redisplay — no token, token hash, or token prefix ever
  appears in any dashboard page or model
- no cross-workspace leaks — generic unavailable/not-found screens for every
  denied shape; unknown and foreign ids collapse to identical output
- no web execution/action bypass — dashboard imports no KeeperHub/MCP/
  execution/Telegram-webhook/model-provider surface (source-contract tested)

**M12 explicitly does NOT ship:**

- web approve/reject actions
- web claim reissue action
- recipient add/edit/delete
- member add/remove/role change
- policy limit edits
- CSV/bulk imports
- claim-link batches
- retry/recovery console
- KeeperHub workflow companion
- x402/paid reports
- raw SQL/query builder
- direct KeeperHub execution from the web

**M12 deployment notes:**

- Migration `0014_dashboard_login_tokens.sql` must be applied before live
  `/dashboard` login-token creation (`npm run db:migrate`).
- Migration `0013_claim_reissue.sql` must be applied before live claim
  reissue audit recording.
- `SOLVO_DASHBOARD_COOKIE_SECRET` is required in production for dashboard
  sessions; without it, production refuses all dashboard cookies.

### In progress

- M8 final integration/review (S3 slice gate complete)
- production operator enablement (enabling `SOLVO_AGENT_ENABLED` and, if
  desired, the model provider) — not yet done

### Next

- M13 retry/recovery console
- M14 KeeperHub workflow companion
- M15 x402/paid workflow surface

### Later

Deferred/optional:

- richer model provider support
- public sandbox/community testing
- claim-link batches / bulk claim links (designed in
  `docs/m11.6-claim-link-batches-design.md`; implementation deferred —
  batch-signal phrases decline with zero artifacts until then)

**Safety note:** the agent prepares payment requests only. Owners/approvers
still approve. KeeperHub execution happens only after approval. Transaction
proof comes from the execution pipeline, never from the model or agent_runs.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
