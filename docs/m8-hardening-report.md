# M8 — Security, Concurrency & Release Hardening Report

Milestone scope: attack the M1–M7 implementation and prove Solvo cannot
double-execute, bypass approvals/limits/caps, reuse or mutate claim links,
leak secrets, cross environments, expose a public drain path, regress Judge
Mode, or fabricate success states. No product features were built and no real
payment was executed.

## Summary

- **Verdict: PASS WITH DOCUMENTED NON-BLOCKING RISKS**
- Bugs found and fixed: 4 (see below).
- Tests added: 68 (`tests/security/*` 61 + `tests/db/concurrency.test.ts` 7).
- Full suite: `npm test` 462/462, `npm run test:db` 27/27, lint 0 errors,
  TypeScript clean, build PASS, judge:doctor READY, telegram:doctor PASS.
  Concurrency suites re-run 3× — deterministic.

## Vulnerabilities / bugs discovered and fixed

| # | Finding | Fix | Where |
|---|---|---|---|
| 1 | Daily-cap sums race in READ COMMITTED: two approvals/claims/judge payments of DIFFERENT intents could both read the same spend and jointly overspend the daily cap ("check-then-insert"). | `lockWorkspaceForUpdate` (workspace row `FOR UPDATE`) taken as the first statement of every capacity-reserving transaction (payout approval, batch approval, claim approval, judge persistence), serializing per-workspace cap accounting. | `repository.ts`, `postgres-repository.ts`, `approval-flow.ts`, `claim/service.ts`, `judge-flow.ts` |
| 2 | Concurrent duplicate Telegram delivery created orphan payout rows and could race the same intent (creation flows ignored the `created` flag from `createPayoutItem`). | `lockIdempotencyKey` (Postgres advisory transaction lock keyed by the idempotency key) + in-transaction re-lookup + honoring `created:false` in every creation flow (`/pay`, community `/pay`, `/batch`, `/judgepay`, `/claimpay`). | creation flows + repos |
| 3 | `transitionClaimStatus` trusted the caller's from-list: `cancelled→executed` etc. was possible in both repositories. | Authoritative lifecycle graph (`CLAIM_TRANSITIONS`) enforced in SQL (`status='created' AND to IN (...)` …) and in the memory repo. | `db/types.ts`, both repositories |
| 4 | `setClaimPayoutId` was unguarded — a second payout could be attached or a payout attached pre-approval. | Guarded update (`status='approved' AND payout_id IS NULL`) + partial unique index on `payout_id` (migration 0011). | repos + migration |
| 5 | Malformed KeeperHub responses (unparseable JSON) were classified as definite rejections, understating ambiguity. | Ambiguous-outcome classifier extended (`malformed|unexpected token|parse|syntaxerror|invalid json`…) → `execution_unknown`, never success, never rebroadcast. | `execution-service.ts` |
| 6 | Memory repository `transaction` did not roll back on failure and could clobber overlapping transaction state — violating Postgres parity. | Memory transactions are serialized (mirroring the Postgres locks) and snapshot-rollback on failure; batch payout settlement wrapped in transactions (also a crash-safety improvement). | `memory-repository.ts`, `batch-execution.ts` |
| 7 | Raw claim tokens embedded in `claim/<token>` strings could reach logs. | `redactSecrets` pattern `\bclaim\/[A-Za-z0-9_-]{32}\b` → `[REDACTED:CLAIM_TOKEN]`; claim URLs are only ever shown to the requester at creation. | `safe-logging.ts` |

## Threat / invariant coverage (selected)

- **Duplicate execution (A–J):** same callback twice, concurrent, two
  approvers, retry after completion, retry in-flight (gated barrier), dup
  update ids, dup `/pay`, dup `/batch`, dup `/claimpay`, dup claim approval —
  at most one payout, one execution, one final state, one audit success;
  duplicates return truthful idempotent responses. Memory-level (barrier-gated)
  and Postgres-level (Promise.all of real transactions).
- **Claim tokens:** 14 adversarial cases (random/unknown/malformed/altered/
  expired-at-boundary/just-after/claimed/cancelled/approved/executed/
  simultaneous different wallets/same wallet/mutation/replay) — the guarded
  `claimClaimLink` UPDATE is the authority; Postgres test proves exactly one
  concurrent winner and immutable destination.
- **SoD:** requester self-approval (payout + claim), claimant-not-approver,
  non-member, member-without-role, other-workspace approver, wrong chat,
  forged ids, already-handled states — all rejected at validation time.
- **Limits/concurrency:** two payouts over cap (one winner), two claim
  approvals racing allowance (one winner), batch+single race (one winner) —
  Postgres; near-boundary/max/over-max/zero/negative/decimal-precision/
  casing/whitespace/token-chain combos at parser+policy.
- **State machine:** all illegal claim transitions and payout transitions
  rejected (tests + DB graph).
- **Execution truthfulness:** no invented hash, unknown ≠ success, failed
  stays failed, transient ≠ completed, BaseScan link only with a real hash,
  metadata matches approved values, retry-after-completion zero calls.
- **Redaction:** claim URLs (nested/JSON), bot token, bearer, DB URL,
  KeeperHub key; legitimate strings untouched.
- **Isolation:** community never inherits judge auto-approval; judge config
  can't reach community; `/claimpay` unavailable outside community; judge
  workspace rejects `/claimpay`; `/judgepay` is the only public surface.
- **Telegram inputs:** empty/huge/unicode/extra args, addressing, malformed/
  oversized/unknown-action callbacks, unknown ids → truthful non-sensitive
  failures.
- **Claim web:** direct action without page, long inputs, stale-page race,
  no amount/currency/chain/token mutation, no payout-id/approval/execution
  force, repeated/concurrent submissions.
- **Failure recovery:** DB insert failure rolls back (no orphan), Telegram
  failure never corrupts state, malformed KeeperHub → unknown, restart
  reconcile without rebroadcast, failing messengers still complete execution.

## Residual risks (non-blocking)

1. **Execution `execution_unknown` window:** if a KeeperHub transfer succeeds
   remotely but local persistence fails, the payout stays `execution_unknown`
   and is never auto-retried — safe but requires operator reconciliation via
   `/status` and KeeperHub/Basescan. This is the documented, intentional
   safety posture.
2. **READ COMMITTED + advisory locks:** the workspace row lock serializes
   capacity accounting per workspace; cross-workspace interactions are
   independent by design. A malicious actor with DB write access is out of
   threat scope.
3. **Claim notifications are best-effort:** if the bot process is down when a
   recipient claims, the Telegram APPROVE/REJECT notification is skipped; the
   claim remains valid and approvable via the claim page state.
4. **Server actions run over POST:** the claim page server action is public
   by nature; it can only record a destination and is bounded by the same
   guarded service (no payout/execution path exists for it).
5. **Lint:** two pre-existing warnings in `tests/ui/landing-source.test.ts`
   (unchanged from before M8).

## Recommendation

**PASS WITH DOCUMENTED NON-BLOCKING RISKS.** The fixes in this milestone make
the daily cap, intent creation, claim lifecycle, and claim payout attachment
authoritative at the database layer; Postgres concurrency tests prove the
invariants hold under real concurrent transactions. No release blocker
remains. Deploy requires: migrations 0009–0011 applied, `npm run
telegram:set-webhook` for the deployed domain, and env vars per
`docs/m6-judge-mode-deployment.md`.

No credentials appear in this document.
