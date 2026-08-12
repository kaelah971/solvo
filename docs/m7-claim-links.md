# M7 — Claim Links

## Goal

Let a sender/workspace create a payment **intent** before the recipient
wallet address is known. A claim link is NOT immediate execution.

```
claim created (/claimpay)
→ recipient opens /claim/<token>
→ recipient submits wallet address
→ claim destination stored (claimed)
→ sender/workspace approves the claimed destination (separation of duty)
→ KeeperHub simulation
→ KeeperHub execution
→ receipt/proof
```

**Safety rule: a claimed wallet address NEVER causes funds to move
automatically.** The claim page only records the destination; execution
requires an owner/approver to approve that exact address.

## Command

```
/claimpay <amount> USDC
```

Example: `/claimpay 0.05 USDC` — Base USDC only.

- Works only in **community** workspaces (like `/batch`): the sender must be
  an active workspace member.
- Private chats, dev mode, and sandbox: not available (`/claimpay` replies
  "only works inside an initialized group workspace").
- **Judge Mode is untouched**: `/judgepay` remains the only public execution
  surface; `/claimpay` never executes funds and never appears in Judge Mode.
- Amount validation: > 0, within the global 0.10 USDC proof cap and the
  workspace per-transaction limit; chain/token must be Base USDC.
- Duplicate Telegram delivery returns the existing claim (idempotency key
  `tg:<chat>:m<messageId>:claimpay`) — no second claim is created.

## Claim page (`/claim/<token>`)

- Truthful server-rendered states: `valid` (wallet form), `claimed` →
  `waiting-approval` (shows the stored destination), `approved` →
  `executing`, `executed` → `completed` (with tx hash + BaseScan link),
  `expired`, `cancelled`, `already used`, and `unavailable` for unknown
  tokens.
- The form only records the wallet address (server action). No payout is
  created and no funds can move from the page.
- Claimed recipient is immutable: a second submission returns the stored
  address and never mutates it.

## Approval after claim

When the recipient submits a wallet, Solvo notifies the original Telegram
chat (best-effort) with the claimed destination and
`[APPROVE CLAIM] [REJECT]` inline buttons.

- Only an **owner or approver** may decide the claim.
- The **requester cannot approve their own claim** (separation of duty,
  mirrored from M4).
- Callbacks from the wrong chat are rejected; duplicate callbacks are
  idempotent; concurrent approvals produce exactly one execution.
- Approval re-checks the workspace daily cap inside the persistence
  transaction, creates the payout (`source_type = claim_link`, requester =
  claim creator, item idempotency key `cl:<claimId>`), then runs the
  existing M2 pipeline (KeeperHub simulate → execute → persist → prove).
- On completion the claim transitions `approved → executed`; rejection
  transitions `claimed → cancelled` (nothing is created).

## Security model

- **Token:** 192-bit CSPRNG base64url token; only its SHA-256 hash is stored
  (`claim_links.token_hash`). The raw token is shown once at creation and
  never persisted. Display prefix = first 8 chars (hint only).
- **Expiry:** claims expire after `CLAIM_EXPIRY_HOURS` (default 168 = 7
  days); unclaimed claims past expiry are unclaimable.
- **Single use:** `claimClaimLink` is a strict `created → claimed`
  transition guarded by `expires_at > now()` in one UPDATE — one claim, one
  winner.
- **Immutable destination:** once claimed, the recipient cannot be changed
  except by cancel/recreate.
- **No auto-execution:** claiming never creates a payout and never calls
  KeeperHub.
- **No fake hashes:** proof only comes from the persisted execution path.
- **No secret logging:** claim tokens are never logged; claim IDs and
  prefixes are the only identifiers in logs; the raw token never enters
  audit metadata.

## Schema (migrations/0009 + 0010)

`claim_links`: id, workspace_id, requester_id (numeric Telegram ID),
amount_base_units, currency_symbol, chain_id, token_address, token_hash
(unique), token_prefix, status
(`created | claimed | expired | cancelled | approved | executed`),
claimed_recipient (normalized lowercase), claimed_by (`web` or numeric ID),
claimed_at, expires_at, payout_id (set at approval), idempotency_key
(unique), created_at/updated_at.

Audit event types added: `claim_created`, `claim_claimed`, `claim_approved`,
`claim_rejected`, `claim_executed`.

`/status <payout_id>` for claim-linked payouts prefixes the payout status
with the claim state (created → claimed → approved → executed, destination,
expiry, linked payout).

## Tests

`tests/claim/token.test.ts`, `tests/claim/claim-service.test.ts`,
`tests/telegram/claim-flow.test.ts`, `tests/telegram/parsing.test.ts`
(claimpay cases), `tests/db/integration.test.ts` (claim persistence +
single-claim + uniqueness), plus command-menu and UI copy tests. Judge Mode,
`/judgepay`, `/pay`, and `/batch` regressions are covered by the existing
suites (all still green).

## Status

Claim links are implemented on the `feature/claim-links` branch. The
submitted main branch (M1–M6.1) is unchanged; see `docs/submission.md` for
the submitted scope.
