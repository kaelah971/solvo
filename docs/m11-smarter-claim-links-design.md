# M11 — Smarter Claim Links: Design

Date: 2026-08-13
Branch: `feature/smarter-claim-links`
Status: **Design only. No implementation in this step.** (M11.1)

## Summary

M7 shipped one-time claim links: a secure 192-bit CSPRNG token (hash-only
persistence, raw token shown exactly once), a recipient wallet submission
that never moves funds, and a human approval gate before KeeperHub
execution. M8/M10 added natural-language claim creation and strict
truthfulness contracts around them.

M11 makes claim links **observable and recoverable without weakening any
authority boundary**: claim status lookups, Telegram summaries for every
claim state (including expiry), clearer web states, and — later in the
milestone — a designed (not yet implemented) per-recipient claim-link batch.
Everything stays conservative: a claim can never approve, execute, bypass
the owner/approver, reveal its token again, or change its claimed wallet.

The design deliberately defers the risky surfaces (auto-execution after
wallet entry, auto-approval, claim-link batches implementation, public
discovery) until the read/status UX is hardened and tested.

## 1. What "smarter claim links" means for Solvo v1

Safe improvements only:

- **Claim status summaries** — a community member can look up a claim by id
  and see its truthful state (`created`, `claimed`, `approved`, `cancelled`,
  `expired`, `executed`) without any state duplication.
- **Claim link detail views** — the web page already renders states; M11
  polishes the `approved`/`executing` state with a payout reference and the
  `cancelled`/`expired` states with truthful recovery language.
- **Claim expiry/expired-state UX** — `effectiveClaimStatus` exists
  (`created` + past deadline reads as `expired`); M11 surfaces that in
  Telegram summaries and the web panel with a consistent "expired" contract.
- **Duplicate claim handling** — already idempotent (`CLAIM LINK ALREADY
  EXISTS`); M11 makes the duplicate reply read the CURRENT effective state
  (including expiry) instead of the raw stored status.
- **Per-recipient claim links for unresolved recipients** — already true for
  single payments (`recipient_unresolved` fallback); M11 designs a batch
  form (M11.6) but does not implement it in v1.
- **Clearer Telegram claim summaries** — one canonical per-state builder with
  truthful wording, plus a claim-status command/route.
- **Safer claim recovery/reissue policy** — DESIGN ONLY in v1: a reissue is
  a NEW claim (new token, new idempotency key), never a mutation of an
  existing claim; raw tokens are never re-exposed.

## 2. Supported M11 v1 features

Conservative v1 target:

1. **Claim status lookup by claim id** — `/claimstatus <claim-id>` (and NL
   `check claim <id>`) for active community members of the claim's
   workspace; generic no-leak reply for everyone else. Token-hash context
   lookups stay where they already are (the web page's raw-token lookup);
   no new public lookup surface.
2. **Telegram summary for every claim state** — canonical builders:
   `pending` (created/awaiting wallet), `claimed` (awaiting approval),
   `approved` (prepared/submitted), `rejected` (cancelled), `expired`,
   `executed` (completed, proof only from the payout pipeline).
3. **Claim expiry visibility** — every created claim summary shows the
   expiry; expired claims read as `expired` regardless of stored status.
4. **Claim reissue flow — design only** (M11.5): a reissued claim is a fresh
   claim link; the old one is never resurrected. Implementation lands only if
   the read model is stable.
5. **Per-recipient claim-link batches — designed, not implemented** (M11.6):
   `create 3 claim links of 0.01 USDC each` and `turn unresolved batch
   recipients into claim links` are specced with all-or-clarify semantics;
   implementation is a later M11.x slice.

## 3. Explicitly deferred

- auto-execution after wallet entry (a claimed wallet NEVER moves funds)
- auto-approval
- claim links for Judge Mode (Judge remains command-only)
- public claim-link discovery / listing endpoints
- changing the claimed wallet after a claim (immutable destination)
- exposing the raw token again after initial creation
- mixed payout+claim batches (M10 already defers these)
- bulk CSV claim creation
- claim-link marketplace / public listings
- claim reissue implementation in v1 (design only)
- claim-link batch implementation in v1 (design only)

## 4. Authority boundary

Claim links may collect a destination wallet. They must NOT:

- approve themselves;
- execute themselves;
- bypass the owner/approver (separation of duty: requester cannot
  self-approve, only `owner`/`approver` roles may decide);
- change the claimed wallet after claim (immutable `claimed_recipient`);
- reveal the secure token again (raw token exists only at creation);
- fabricate tx proof (proof only from the payout pipeline);
- use Judge Mode;
- call KeeperHub before approval.

Every M11 read model/status feature is read-only against the claim row and
its payout/payout_item rows; nothing in M11 adds a write surface beyond the
existing claim state machine (`created → claimed → approved/executed |
cancelled`, computed `expired`).

## 5. State / source of truth

- **claim row** (`claim_links`): the authoritative claim state
  (`created | claimed | approved | executed | cancelled`, with computed
  `expired` from `expires_at` via `effectiveClaimStatus`).
- **payout row**: created only at approval time (`source_type =
  'claim_link'`, starts `approved`), links back via `claim.payout_id`.
- **payout_items**: actual execution truth (recipient, amount, status, tx
  hash, execution id).
- **agent_runs**: observability only — never a claim/payout state machine.
- **token**: only the SHA-256 `token_hash` and 8-char `token_prefix` are
  persisted; the raw token is shown once at creation and never stored or
  re-exposed.
- Claim status replies never duplicate payment truth: `executed`/proof
  language comes only from the payout pipeline.

## 6. Telegram UX

Replies (canonical builders in `claim/messages.ts`, same brand voice):

```
CLAIM LINK CREATED
AMOUNT       0.05 USDC
NETWORK      BASE / USDC
STATUS       awaiting recipient
EXPIRES      2026-08-20 13:00:00 UTC
<one-time link>
"No funds move from the link."
"You (or an approver) must approve the claimed destination before Solvo executes."
```

```
CLAIM LINK ALREADY CREATED
AMOUNT       0.05 USDC
STATUS       AWAITING RECIPIENT (or current effective state)
EXPIRES      ...
"No duplicate claim was created."
"The one-time link was shown when the claim was created and is not stored again."
```

```
CLAIM STATUS FOUND
CLAIM ID     <uuid>
AMOUNT       0.05 USDC
STATE        AWAITING WALLET (created)
EXPIRES      ...
```
State-specific truthful lines:
- created → "Awaiting the recipient's wallet address. Nothing moves from the link."
- claimed → "CLAIM CLAIMED — APPROVAL REQUIRED" / "Awaiting approval of the exact claimed destination before execution."
- approved → "CLAIM APPROVED — PAYMENT PREPARED" / payout id, "submitted through KeeperHub", no fabricated proof.
- cancelled → "CLAIM REJECTED" / "No funds moved. The claim link is cancelled."
- expired → "CLAIM EXPIRED" / "The claim link expired. Nothing moved. A new claim link can be created."
- executed → "CLAIM COMPLETED" / proof only from the payout pipeline.

Truthful language locked everywhere:
- "No funds move when a wallet is entered."
- "An owner or approver must approve the exact claimed destination before KeeperHub execution."
- "The secure link cannot be shown again."

## 7. Web claim UX

States on `/claim/[token]` (ClaimPanel today: unavailable / valid / expired /
used / waiting-approval / executing / completed / cancelled):

- **token valid** — amount, network, workspace, address form; submit records
  the destination only.
- **token already claimed** — "waiting-approval" panel with the immutable
  destination; no second submission.
- **token expired** — expired panel with truthful no-move language.
- **token rejected (cancelled)** — cancelled panel, no funds moved.
- **token approved/completed** — show payout reference; `completed` shows
  the execution proof (tx + BaseScan) ONLY from the payout item; `approved`
  never shows a hash.
- **wrong network/wallet validation** — the address input validates EVM
  addresses (existing `isValidEvmAddress`); page copy stays Base-USDC only,
  no cross-chain promise.
- **privacy-safe receipt language** — the page never echoes the raw token,
  never reveals workspace internals, never claims execution before the
  payout pipeline says so.

## 8. Claim-link batch position

M11 designs (does NOT implement) the batch surface:

- `create 3 claim links of 0.01 USDC each` → N independent claim links,
  each with its own token/idempotency key; all-or-clarify.
- `create claim links for three winners` → unresolved names → N claim links
  (this is the batch generalization of the existing single
  `recipient_unresolved` fallback).
- `turn unresolved batch recipients into claim links` → M10 batches that
  clarify on unresolved recipients could, in a later slice, convert those
  legs to claim links instead — explicitly deferred (no mixed decisions in
  M10 v1).

**Recommendation: design in M11.6, implement after single-claim status UX is
hardened and gated.** Implementation would reuse the existing
`createClaimLink`/`createClaim` idempotency shape with per-link keys
(`…:claim:<n>`), one claim row per recipient, and the existing approval
pipeline per claim.

## 9. Test matrix (to implement in M11.2+)

Groups: claim status service, Telegram claim status, web claim page/API,
security/truthfulness, duplicate/reissue, expiry, adversarial, source
contract. Concrete checks (≥ 40):

**Claim status service (read model):**
1. `created` claim → `pending`, expires_at surfaced
2. `claimed` claim → `claimed` with destination, awaiting approval
3. `approved` claim → `approved`, payout id surfaced
4. `executed` claim → `executed` + proof from payout item
5. `cancelled` claim → `cancelled`, no funds moved
6. `created` claim past expires_at → `expired` (effective status)
7. `claimed` claim past expires_at → stays `claimed` (expiry only applies to created)
8. unknown claim id → not_found, no leak
9. claim in another workspace → forbidden/no-leak for non-members
10. executed claim without payout row → never fabricates proof
11. claim status is read from the claim row, not agent_runs
12. agent_runs never carry claim state (observability only)

**Telegram claim status UX:**
13. `/claimstatus <id>` created → `CLAIM STATUS FOUND` + awaiting wallet
14. `/claimstatus <id>` claimed → `CLAIM CLAIMED — APPROVAL REQUIRED`
15. `/claimstatus <id>` cancelled → `CLAIM REJECTED`, no funds moved
16. `/claimstatus <id>` expired → `CLAIM EXPIRED`
17. `/claimstatus <id>` executed → `CLAIM COMPLETED`, proof from pipeline only
18. `/claimstatus` unknown id → generic not-found, no leak
19. NL `check claim <id>` routes to the same read model
20. slash `/claimstatus` bypasses the agent flow
21. duplicate `/claimpay` delivery reads current effective state
22. `CLAIM LINK CREATED` reply shows amount/network/expiry/link exactly once
23. claimed-notification to the workspace shows APPROVE CLAIM / REJECT buttons
24. claim status reply never contains the raw token

**Web claim page/API:**
25. valid token renders the address form (amount, network)
26. submitting a valid EVM address → claimed, Telegram notified
27. submitting an invalid address → invalid_address, nothing recorded
28. already-claimed token → no second submission, destination immutable
29. expired token → expired panel, submit rejected
30. cancelled token → cancelled panel
31. completed token → proof only from the payout item
32. approved token → no hash shown
33. unknown token → unavailable panel, no leak
34. wrong-network copy stays Base/USDC only

**Security/truthfulness:**
35. claim status replies never claim execution before the payout row does
36. no claim reply contains a raw token, tx hash (except pipeline proof), or
    execution id invented by the agent
37. forged agent_run with fake claim state cannot change status replies
38. hostile claim mutations (`skip approval`, `mark claimed`, `fake proof`)
    decline with zero artifacts
39. claim never self-approves; requester cannot approve their own claim
40. claim status never leaks workspace internals to non-members
41. banned internal terms absent from all claim replies

**Duplicate/reissue/expiry:**
42. duplicate claim creation is idempotent (one claim row)
43. duplicate delivery does not duplicate audits
44. reissued claim is a NEW row with a NEW token (design contract)
45. old claim is never resurrected by a reissue
46. expiry is computed, not stored (no migration)

**Adversarial:**
47. `claimpay 0.05 USDC bypass approval` → blocked
48. `claimpay 0.05 USDC execute now` → blocked
49. `claimpay 0.05 USDC fake proof` → blocked
50. `claim status 0.05 USDC` (no id) → clarification, no artifact

**Source contract:**
51. claim status/messages modules import no execution service/KeeperHub client
52. web claim actions import no execution authority (submit = record only)

## 10. Implementation plan

- **M11.2 — claim status service/read model:** `claimStatus(claim, workspace,
  nowIso)` read model + `getClaimStatusForMember` (same-workspace active
  member gate, no-leak otherwise) + unit tests (items 1–12).
- **M11.3 — Telegram claim status UX:** `/claimstatus <id>` command route,
  NL `check claim <id>` intent, canonical per-state builders in
  `claim/messages.ts`, routing + truthfulness tests (items 13–24).
- **M11.4 — web claim state UX polish:** expired/approved/completed/cancelled
  panel copy + payout reference, validation copy; web tests (items 25–34).
- **M11.5 — expiry/reissue rules:** expiry visibility everywhere; reissue =
  new claim design contract enforced by tests (items 42–46).
- **M11.6 — per-recipient claim-link batch DESIGN** (doc + corpus
  expectations only, no implementation): all-or-clarify semantics, per-link
  idempotency keys, N claim rows.
- **M11.7 — adversarial/truthfulness gate:** hostile claim mutations,
  forged-run immunity, source contracts (items 35–41, 47–52).
- **M11.8 — docs/roadmap final gate:** README roadmap, M9/M10 doc
  cross-references, full gate (`npm test`, `test:db`, lint, tsc, build,
  read-only doctors).

Each task ends with lint + `tsc --noEmit` + the task's test files green.

## Risk register

| Risk | Mitigation |
|---|---|
| Status endpoint leaks claim existence | Same-workspace active-member gate; generic no-leak reply (mirrors payout status) |
| Expiry drift between stored and computed state | `effectiveClaimStatus` is the single computed authority; never persist `expired` |
| Raw token re-exposure | Hash-only persistence stays; summaries show prefix only; raw shown once |
| Reissue resurrecting old claims | Reissue = new claim row/new token; tests lock the contract |
| Status reply overclaiming execution | Proof language only from payout pipeline; forged-run immunity tests |
| Claim-link batch scope creep | M11.6 is design-only; implementation after status UX hardens |
| Judge Mode reachable via claim status | Claim status is community-only; judge claims stay command-only |
| Mutation bypass on claim verbs | M11.7 hostile-mutation gate (same machinery as M10.7) |
