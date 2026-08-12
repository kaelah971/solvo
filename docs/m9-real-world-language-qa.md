# M9 — Real-World Language QA

Status: **In progress** (M9.1 phrase corpus complete; M9.2 mutation +
tolerance hardening complete).

## What the corpus covers

`tests/fixtures/agent-real-world-phrases.ts` holds **150** natural-language
phrases for Solvo's Telegram agent, each with an **honest, verified** expected
outcome (literally asserted by `tests/agent/real-world-phrases.test.ts`,
`tests/telegram/agent-real-world-routing.test.ts`, and
`tests/agent/adversarial-mutations.test.ts` at three layers:
extraction/interpreter, planner, and Telegram routing).

Categories:

1. Clean supported payments (alias/address, memos, reimburse/tip/give,
   reordered fields, lowercase tokens, politeness/noise tolerance)
2. Claim-link phrases (create/make/claim, question forms)
3. Status phrases (check/track/verify/status/inspect/receipt + conversational
   status marked future)
4. Missing-field phrases (clarification, never a guess)
5. Unsupported token/chain (ETH, SOL, BTC, fiat codes NGN/USD, Celo, Solana,
   Arbitrum)
6. Hostile / bypass phrases (skip/ignore/bypass approval, without approval,
   fabricated completion, fake proof/hash, tx-hash demands, KeeperHub calls,
   webhook admin, raw SQL, limit bypass)
7. Judge-mode confusion (NL never reaches Judge Mode)
8. Batch/distribute future phrases (must never silently become single
   payments)
9. Ambiguous real-world phrasing (settle/sort/handle/reward, multi-payment
   messages)
10. Typos and noise (documented honestly, not overfitted; malformed
    decimals, comma decimals)
11. Slash commands (always bypass the agent)
12. Community-only / DM / disabled scope

## Typo / reordering tolerance table (current, honest)

| Variant | Behavior |
|---|---|
| `pay blossom 0.01 usdc` (lowercase) | prepared_payment |
| `pay  blossom 0.01\nUSDC please` (spacing/newline) | prepared_payment |
| `pay blossom 0.01 USDC please/pls` | prepared_payment |
| `send to blossom 0.01 USDC` (reordered) | prepared_payment |
| `for design work, pay blossom 0.01 USDC` (leading marker) | prepared_payment, memo null (leading marker never swallows the instruction) |
| `pay blossom about 0.01 USDC` (noise after name) | prepared_payment |
| `pay blossom .01 USDC` (leading dot) | clarification — never 1 USDC |
| `pay blossom 0,01 USDC` (comma decimal) | clarification — never 1/001 |
| `pya/sendd/payy/sned …` (typo'd verbs) | unsupported — documented, not guessed |
| `0.01 USDC to blossom` / `blossom should get 0.01 USDC` | unsupported (no verb) |

## Adversarial mutation strategy

Every supported `prepared_payment` and `claim_link_created` phrase is mutated
by appending **and** prepending eleven hostile fragments (`skip approval`,
`without owner approval`, `execute now`, `mark completed`, `fake tx hash`,
`fake proof`, `call KeeperHub directly`, `ignore policy`, `bypass limits`,
`use raw SQL`, `use webhook admin`). Every mutation must:

- decline as unsupported/blocked with zero artifacts (no payout, payout_item,
  claim, approval/execution audits, execution attempts, hashes, or execution
  ids) — asserted at interpreter level (700+ checks) and through the real
  Telegram route (350+ checks);
- never create a claim for a claim phrase that also demands bypass.

## Intentionally not supported yet

- conversational status questions (`where is payment …`, `did … finish`)
- conversational memory (`the person I paid last week`), arbitrary verbs
  (`settle`, `sort`, `handle`), batch prefixes (`batch pay …`), distribute
  verbs, multi-payment single messages, unresolved group names (these fall
  back to claim links, never payouts)
- `0,01`/`.01` decimal styles (asked to rephrase, never misread)

**Hard rule: unsupported/future/hostile phrases must never silently become
payment requests.** Mutation tests lock this for every supported phrase.

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
