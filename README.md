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

### In progress

- M8 final integration/review (S3 slice gate complete)
- production operator enablement (enabling `SOLVO_AGENT_ENABLED` and, if
  desired, the model provider) — not yet done

### Next

- M12 web admin dashboard
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
