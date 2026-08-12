# M9 — Real-World Language QA

Status: **In progress** (M9.1 phrase corpus + behavioral lock complete).

## What the corpus covers

`tests/fixtures/agent-real-world-phrases.ts` holds 90 natural-language phrases
for Solvo's Telegram agent, each with an **honest, verified** expected outcome
(literally asserted by `tests/agent/real-world-phrases.test.ts` and
`tests/telegram/agent-real-world-routing.test.ts` at three layers:
extraction/interpreter, planner, and Telegram routing).

Categories:

1. Clean supported payments (alias/address, memos, reimburse/tip/give)
2. Claim-link phrases (create/make/claim)
3. Status phrases (check/track/verify/status/inspect/receipt + conversational
   status marked future)
4. Missing-field phrases (clarification, never a guess)
5. Unsupported token/chain (ETH, SOL, BTC, fiat codes NGN/USD, Celo, Solana)
6. Hostile / bypass phrases (skip/ignore/bypass approval, fabricated
   completion, fake proof, tx-hash demands, KeeperHub calls)
7. Judge-mode confusion (NL never reaches Judge Mode)
8. Batch/distribute future phrases (must never silently become single
   payments)
9. Ambiguous real-world phrasing (settle/sort/reward/ordinary words)
10. Typos and noise (documented honestly, not overfitted)
11. Slash commands (always bypass the agent)
12. Community-only / DM / disabled scope

## Supported now

- alias and 0x-address payments with optional memos
- claim-link creation
- status lookups (`check status`, `track`, `verify`, `status`, `inspect`,
  `receipt` + a payout id) — read-only, no-leak on unknown ids
- clarifications for missing amount/recipient/currency/payout-id
- safe declines for unsupported tokens/chains, hostile text, and judge-like
  phrasing
- unresolved names fall back to a one-time claim link (never a payout)

## Intentionally blocked

- unsupported tokens/chains — never silently defaulted to USDC/Base
  (including fiat codes such as `NGN`/`USD`)
- multi-recipient phrases — ambiguous clarification, **never** a single
  payment to the first name
- fabricated success ("mark this as completed", "fake the proof") — declined
- Judge Mode — slash-command only (`/judgepay`); NL never reaches it
- batch/distribute, memory ("the person I paid last week"), and arbitrary
  real-world verbs (settle/sort/reward) — declined or clarified
- leading-dot amounts (`.01`) — treated as malformed, the user is asked for
  a well-formed amount instead of a misread value

**Hard rule: unsupported/future phrases must never silently become payment
requests.** Every corpus entry that does not produce a prepared payment or
claim is asserted to leave zero artifacts: no payout, no payout_item, no
claim, no approval/execution audits, no execution attempts, no hashes.

## Deferred (M10 / M11 / M12+)

- natural-language batch/distribute (M10) — currently multi-recipient
  phrases clarify and `split`/`distribute`/`batch` prefixes are not verbs.
  `batch pay blossom 0.01 USDC` is flagged in the corpus as a known hazard
  that M10 must block explicitly.
- conversational status questions ("what happened to …", "is this payment
  approved yet …") — currently declined; a later slice can map them to
  `inspect_payment_status`.
- conversational memory, arbitrary verbs, fuzz-tolerant typo recovery — the
  corpus documents current behavior without overfitting; M9.2 can explore
  safe tolerance windows.

## Example safe outcomes

- `pay blossom 0.01 USDC for design work` → PAYMENT REQUEST PREPARED,
  APPROVAL REQUIRED, "No funds have moved.", memo `design work` on the
  payout item.
- `create a claim link for 0.05 USDC` → CLAIM LINK CREATED, "No funds move
  until an owner or approver approves the exact claimed destination."
- `pay blossom and mike 0.01 USDC` → I NEED ONE MORE DETAIL (ambiguous
  recipient) — never a single payment.
- `pay blossom 10 NGN` → I COULDN'T SAFELY PROCESS THAT (unsupported token)
  — never a 10 USDC request.
- `check status <id>` → STATUS FOUND with `pending_approval` / waiting for
  approval wording, or a generic no-leak "couldn't find" reply.

## Judge Mode note

Judge Mode remains slash-command only. Natural-language text containing
"judge", "judgepay", or judge-role claims is declined or clarified by the
agent and can never create a payout, claim, or execution artifact.
