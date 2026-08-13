# M12 — Web Admin Dashboard: Design

Date: 2026-08-13
Branch: `feature/web-admin-dashboard`
Status: **M12.1 design + M12.2 read models implemented.** The operator
console is specified; the safe read-model layer ships in M12.2. No dashboard
pages/routes, sessions, login links, or admin actions exist yet, and no
migrations were applied.

## M12.2 read models (implemented)

Implemented on `feature/web-admin-dashboard` (commit after 5ff7a1c):

- **Repository read helpers** (both `MemoryRepository` and
  `PostgresRepository`, all workspace-scoped, deterministic
  `(created_at, id)` DESC ordering, `before`/`beforeId` cursor paging,
  `limit` clamped to `[1, 200]`, default 50):
  - `listPayoutsByWorkspace(workspaceId, { status?, sourceType?, before?, beforeId?, limit? })`
  - `listPayoutItemsByPayoutIds(workspaceId, payoutIds)`
  - `listPayoutItemsByWorkspace(workspaceId, { statuses?, createdSinceIso?, completedSinceIso?, before?, beforeId?, limit? })`
  - `listClaimLinksByWorkspace(workspaceId, { status?, before?, beforeId?, limit? })`
    (new newest-first method; `listClaimsByWorkspace` kept untouched)
  - `listAuditEventsByWorkspace(workspaceId, { payoutId?, actorId?, eventType?, claimId? (metadata), before?, beforeId?, limit? })`
  - `listAgentRunsByWorkspace(workspaceId, { before?, beforeId?, limit? })`
  - `countPayoutItemsByWorkspaceStates(workspaceId, statuses, createdSinceIso?)`
  - Recipients/members reuse the existing `listRecipients` /
    `listWorkspaceMembers` (already workspace-scoped).
- **Read-model modules** (`src/server/dashboard/`):
  - `types.ts` — `DashboardContext`, view contracts, `AGENT_RUNS_TRUTH_NOTE`.
  - `access.ts` — pure gates `canViewDashboard` / `canViewApprovals` /
    `canApproveReject` / `canManageMembers` / `canManageRecipients` /
    `canManagePolicies` / `canReissueClaim` / `canViewSensitiveDestinations` +
    `isActiveMember` + `maskIdentity` + `resolveDashboardContext` (repo
    re-read per request — the M12.3 session hand-off point).
  - `overview.ts` — `buildWorkspaceOverview`: pending approvals, effective
    pending/claimed claim counts (computed expiry via the M11.2 rules),
    completed-today count + sum (`completed_at` window), prepared-today sum
    (`pending_approval`, `created_at` window — prepared ≠ paid), failed/
    unknown count, active members, recipients, recent audit events + agent
    runs. **No overview number ever comes from `agent_runs`.**
  - `payouts.ts` — list + detail views: source labels, state labels, batch
    distinction (`telegram_batch`/`batch_csv`), per-item states/amounts,
    requester labels, decision (approver) derived only from
    `approval_granted`/`approval_rejected` audits, audit timeline, tx proof
    (hash + explorer) ONLY on completed items that carry a hash, no
    KeeperHub execution ids, claim item memos hidden (they carry token
    prefixes), full destinations owner/approver-only (masked for members).
  - `claims.ts` — list + detail reusing `getEffectiveClaimStatus` /
    `buildClaimStatusView` (M11.2): masked wallets, computed expiry,
    pipeline-only proof, effective-status filter, reissue eligibility =
    role gate (owner/approver) + state gate (created incl. expired /
    cancelled). Never exposes raw token, hash, or prefix; never
    reconstructs links.
  - `members.ts` / `recipients.ts` — workspace-scoped lists with masked
    identities; full wallets owner/approver-only.
  - `audit.ts` — whitelisted event views (`eventType`, source family,
    masked actor, claim/payout refs, small allowlisted metadata summary);
    never raw metadata JSON, token material, execution ids, or hashes.
  - `agent-runs.ts` — observability-only views (status, intent kind,
    decision type, provider label, redacted raw text, links); never
    candidates/interpretation/decision JSON, secrets, or payment truth.
- **Truth sources** (locked by tests): prepared/completed/failed numbers
  from payout/payout_item rows; completed only with pipeline proof; claim
  status from claim rows + payout pipeline; agent_runs never a payment-truth
  source; migration 0013 is NOT required by any read model (event types are
  plain strings at read time).
- **Access helper decisions**: owner = full admin; approver = approve/
  reject/reissue/recipients; member = view-only (masked destinations); any
  inactive/non-member context is denied by every helper; role gates are
  pure functions of the per-request `DashboardContext`.
- **No UI/session yet**: no `/app` routes, no `/dashboard` login link, no
  cookies, no admin actions, no execution wiring. `resolveDashboardContext`
  is the prepared hand-off for M12.3.
- **No migration applied** during M12.2 gates.

## Summary

M12 designs Solvo's web admin dashboard: the operator console where workspace
owners/approvers understand and manage workspace state — members and roles,
recipients/aliases, payout requests, batch payouts, claim links, approvals,
audit trail, policies/limits, agent runs, execution status/proof, and
operational health.

The dashboard is a **display and managed-surface console**, never a new
authority. Every surfaced state comes from existing rows and the existing
read-model disciplines; every action (approve/reject/reissue/recipient/member
management) routes through the same application services, role gates, and
policy re-checks the Telegram surfaces already use. The dashboard cannot:
execute, bypass approval, auto-approve from claim entry, fabricate proof,
call KeeperHub directly, reach Judge Mode through shortcuts, or reveal raw
tokens/hashes/secrets/provider output.

This document is design only. Nothing in it is implemented by M12.1.

## Product goal

Give owners and approvers one truthful web surface to run a Solvo workspace:

- **See** exactly what the workspace knows: who is a member, who can approve,
  which recipients are registered, what is pending approval, what moved
  (completed only with pipeline proof), what failed or is unconfirmed, what
  the agent interpreted, and what the audit trail says happened.
- **Understand** the difference between prepared, approved, executed, and
  completed — the dashboard's copy and status chips must make this
  distinction explicit, not blur it.
- **Manage approved surfaces only**: approve/reject pending payouts, batches,
  and claimed claim links; reissue eligible claim links; maintain recipients;
  maintain members/roles; view and (later) adjust policy limits. All through
  the existing pipelines with the existing role gates.
- **Stay truthful** at all times: no fake proof, no raw tokens, no secrets,
  no claims of payment the pipeline did not confirm.

The dashboard must remain consistent with Solvo's authority boundary:

- web dashboard may **display and manage approved surfaces**;
- **execution still goes through the existing approval/execution pipeline**
  (approving from the dashboard triggers the same application-level approval
  path the Telegram buttons use, including the KeeperHub simulation/execution
  gateway — it is not a new executor);
- **no fake proof** (completion/hashes only from the payout pipeline);
- **no direct uncontrolled KeeperHub calls**;
- **no auto-approval from claim entry** (submitting a wallet on the claim
  page records the destination only — unchanged);
- **no Judge Mode through admin shortcuts** (Judge remains `/judgepay`-only;
  the dashboard only ever *displays* judge workspace state).

## 1. Route map

No dashboard routes exist today (`src/app` holds `claim`, `receipt`, `api`,
and marketing pages only). M12 introduces a dashboard route group under
`src/app/app` (`app/app/...` → `/app/...`). Recommended route map:

| Route | Page | Purpose |
|---|---|---|
| `/app` | Overview | Workspace health: pending counts, today's prepared vs completed, failed/unknown, active members, recent audit events, recent agent requests |
| `/app/approvals` | Approvals | Everything awaiting an owner/approver decision: single payouts, batch payouts, claimed claim links; approve/reject controls where role allows |
| `/app/payouts` | Payouts | All payout requests (single + batch), filterable by state/source |
| `/app/payouts/[id]` | Payout detail | Items, states, timestamps, proof (only when completed), audit timeline, approve/reject when eligible |
| `/app/batches` | Batches | Batch payouts only (`source_type` `telegram_batch` incl. NL batches) — filtered view reusing payout list/detail, because a batch is one payout + N items |
| `/app/batches/[id]` | Batch detail | Same as payout detail with batch framing (N items, total, per-item states) |
| `/app/claims` | Claim links | Claim link directory: pending/claimed/expired/rejected/approved/completed/not-confirmed |
| `/app/claims/[id]` | Claim detail | Full truthful claim state, masked/derived fields, linked payout, reissue action when eligible |
| `/app/recipients` | Recipients | Alias directory with add/edit/remove (role-gated) |
| `/app/members` | Members | Workspace members and roles, role changes (owner-only), active/inactive |
| `/app/policies` | Policies | Limits, mode, approval policy, token/network, judge/sandbox notes; read-only in core, safe limit edits deferred to M12.10 |
| `/app/agent-runs` | Agent runs | Conversational agent observability (never transaction truth) |
| `/app/agent-runs/[id]` | Agent run detail | One run's interpreted kind, decision, outcome, links |
| `/app/audit` | Audit | Event timeline with filters by payout/claim/member/recipient/agent run |
| `/app/settings` | Settings | Workspace metadata (name, chat id), dashboard access notes; most mutation deferred |

All dashboard pages live behind the same session gate (§2 identity) and the
same-workspace membership gate. There is deliberately **no multi-workspace
switcher in v1**: the dashboard binds to the operator's own workspace, and
non-members/non-owners get one generic "dashboard unavailable" screen
(no existence leak, mirroring the M11 no-leak contract).

Route layout: `src/app/app/layout.tsx` provides the operator shell
(header, section nav, signed-in identity) while keeping the Solvo design
system (`DESIGN.md`: dark `#141414` void, hairline borders, uppercase
letter-spaced labels, data-font figures). Pages are server components;
mutation surfaces are server actions with the session check inside.

## 2. User roles and permissions

Identity primitive stays `telegram_user_id` (the trusted identity today).
The dashboard has **no public surface**: every page/action re-reads the
member row from the repository on every request (stale member objects cannot
bypass — mirrors the M11.2 status gate).

### 2.1 Identity/session design

- Dashboard access is **default-off**: `SOLVO_DASHBOARD_ENABLED=true` is
  required (mirrors `SOLVO_AGENT_ENABLED`).
- Login: the operator messages the bot; a new `/dashboard` Telegram command
  replies with a **short-lived (10 min), single-use, signed login link**
  carrying a one-time session token tied to `telegram_user_id`. Visiting it
  sets an HttpOnly, SameSite=Strict, Secure cookie (`solvo_dash_session`,
  ~8h TTL) that the server verifies on every request against the repository
  member row. No secrets, no bearer tokens in URLs after exchange.
- Every dashboard server action re-checks: session valid → member exists →
  member active → member in the same workspace → role check for the action.
- CSRF: server actions additionally verify `Origin`/`Host` match; the cookie
  is SameSite=Strict; dangerous actions (approve, reissue, member role
  change, recipient delete) require a confirm step in the UI (no
  single-click mutations).

### 2.2 Permission matrix

| Surface | View | Create/Add | Approve/Reject | Reissue claim | Recipient mgmt | Member mgmt | Policy mgmt |
|---|---|---|---|---|---|---|---|
| Overview | all active members | — | — | — | — | — | — |
| Approvals (payout/batch/claim) | all active members | — | **owner/approver only** (never self-request) | — | — | — | — |
| Payouts/batches list + detail | all active members | — | **owner/approver only** (from pending_approval) | — | — | — | — |
| Claims list/detail | all active members | (creation stays Telegram/NL — no web create in v1) | **owner/approver only** for claimed-claim approval | **owner/approver only**, same-workspace, only `created` (incl. expired) or `cancelled` claims | — | — | — |
| Recipients | all active members | **owner/approver only** | — | — | **owner/approver only** (add/edit/delete via safe actions) | — | — |
| Members | all active members | **owner only** | — | — | — | **owner only** (add/remove/role change; last-owner guard) | — |
| Policies | all active members (read) | — | — | — | — | — | **owner only** (limit edits, M12.10, with confirm) |
| Agent runs | all active members (observability) | — | — | — | — | — | — |
| Audit | all active members | — | — | — | — | — | — |
| Settings | owner/approver (mutation deferred) | — | — | — | — | — | — |

Role rules (unchanged from the Telegram surfaces, locked by tests):

- **owner** — full administrative role: members, roles, recipients,
  policies, approvals, reissue.
- **approver** — approve/reject payouts, batches, and claimed claims;
  reissue eligible claims; manage recipients. Cannot manage members/roles or
  policies.
- **member** — view-only dashboard. Can see their own workspace state but
  never act on it from the web.
- **non-member / no workspace / inactive** — one generic
  "Dashboard unavailable" screen; no amount, member, or existence data.
- **judge/sandbox** — judge workspaces are `display-only` in the dashboard:
  the operator can observe judge state but no dashboard action applies
  (Judge execution remains `/judgepay`-only, and sandbox simulation stays
  Telegram-only). The dashboard never auto-approves anything in any mode.
- **Separation of duty is enforced server-side, not hidden in the UI**: the
  requester can never approve their own payout/batch/claim (the existing
  `evaluateCommunityApproval`/`evaluateBatchApproval`/claim-service
  requester checks run on every approve action; the UI additionally renders a
  "you requested this — you cannot approve it" warning state).

## 3. Dashboard data model / read models

### 3.1 New repository read methods (both `PostgresRepository` and
`MemoryRepository`, mirroring existing list methods like
`listClaimsByWorkspace`)

| Method | Returns | Notes |
|---|---|---|
| `listPayoutsByWorkspace(workspaceId, { status?, before?, limit? })` | `PayoutRow[]` | New; `ORDER BY created_at DESC`; page via `before` (cursor = created_at + id) |
| `listPayoutItemsByPayoutIds(ids)` | `PayoutItemRow[]` | Bulk load for list views (avoids N+1) |
| `listClaimsByWorkspace` (exists) | `ClaimLinkRow[]` | Add optional pagination/cursor parity |
| `listWorkspaceMembers` (exists) | `WorkspaceMemberRow[]` | OK as-is |
| `listRecipients` (exists) | `RecipientRow[]` | OK as-is |
| `listAuditEventsByWorkspace(workspaceId, { payoutId?, claimId?, actorId?, eventType?, before?, limit? })` | `AuditEventRow[]` | New; audit timeline + filters |
| `listAgentRunsByWorkspace(workspaceId, { before?, limit? })` | `AgentRunRow[]` | New; observability list |
| `sumPayoutItemsByWorkspaceStates` (exists) | `string` | Daily spend (today/period) |
| `countPayoutItemsByWorkspaceStates(workspaceId, statuses, sinceIso)` | `number` | New count variant for overview cards |
| `getWorkspaceById` (exists) | `WorkspaceRow` | Policy summary input |

No dashboard method reads `token_hash`/`token_prefix`/`raw_keeperhub_status`/
`simulation_result`/`candidates_json` verbatim into a view. Read methods
return rows to the **read-model service**, never to the page directly.

### 3.2 View builders (pure functions, JSON-serializable, deterministic,
whitelisted fields only)

New module `src/server/dashboard/views.ts` (+ `overview.ts`, `payouts.ts`,
`claims.ts`, `members.ts`, `audit.ts`, `agent-runs.ts`). Each view is an
explicit allowlist — no raw row passthrough:

- `buildWorkspaceOverview(repo, workspace, nowIso)` → `OverviewView`
  - `pendingApprovals`: count of payout items `pending_approval`
  - `pendingClaimLinks`: count of claims with effective status `pending` or
    `claimed` (via the M11.2 per-claim status logic, batched)
  - `completedToday`: items completed since local day start
  - `preparedTodayUsdc`: sum of items created today still `pending_approval`
  - `completedTodayUsdc`: sum of completed items today
  - `failedOrUnknown`: items in `validation_failed`/`simulation_failed`/
    `execution_failed`/`execution_unknown`
  - `activeMembers`, `recentAuditEvents` (n≤10, mapped via `AuditView`),
    `recentAgentRuns` (n≤10, mapped via `AgentRunView`)
  - Every number carries its source semantics; the UI copy explains
    "prepared ≠ paid".
- `buildPayoutListView(payouts, itemsByPayout, membersById, nowIso)` →
  `PayoutListView` (id, sourceType label, status, total, currency, created/
  updated/approved/completed timestamps, requester label, itemCount,
  per-item breakdown counts, claim linkage flag)
- `buildPayoutDetailView(payout, items, audits, claim, workspace, nowIso)` →
  `PayoutDetailView` (list fields + items with recipient (full for
  owner/approver, masked otherwise), memo, per-item state, tx proof only
  when completed, audit timeline, approval info from `approval_granted`
  events — actor role+id, no secret material)
- `buildClaimListView(claims, payoutsById, itemsByPayout, nowIso)` →
  `ClaimListView` (id, effective status from `getEffectiveClaimStatus`,
  amount, expiry, masked wallet, linked payout, requester label)
- `buildClaimDetailView(claim, payout, items, audits, nowIso)` → reuses the
  M11.2 `buildClaimStatusView` plus audit timeline and reissue eligibility
  flags; **never includes `token_hash`/`token_prefix`**
- `buildMemberListView(members)` → `MemberListView` (telegramUserId masked
  partial, role, status, joinedAt) — no raw telegram ids beyond the operator
  surface need
- `buildRecipientListView(recipients, membersById)` → alias, **full wallet
  (operator surface; masked in list preview)**, createdBy, created/updated
- `buildPolicyView(workspace, currentDailySpend, counts)` → mode, chain/
  token (label only: "BASE · USDC"), per-tx limit, daily limit, approval
  policy, remaining daily budget, active status
- `buildAuditView(event)` → eventType label, actorType label, actorId masked,
  timestamp, payoutId/claimId refs, safe metadata summary (whitelisted keys;
  never raw JSON)
- `buildAgentRunView(run)` → status, intent kind, decision type, provider
  label (`static` / `openai-compatible`, string only), started/completed,
  linked payout/claim ids, `rawTextRedacted` (already scrubbed/truncated at
  write time), **outcome summary only — no `candidates_json`/
  `interpretation_json`/`decision_json` raw dump**; the page links "truth
  lives in payout/claim rows" for any linked entity

### 3.3 What never leaves the repository into a view

Raw tokens, token hashes, token prefixes, private keys, env values,
`DATABASE_URL`, KeeperHub keys/execution ids (except on the
operator-confirmable payout detail where the pipeline hash/proof is shown at
`completed`), bot token, provider keys, `raw_keeperhub_status`,
`simulation_result`, `candidates_json`, internal JSON blobs. Member
`telegram_user_id` values are masked except where an owner manages that
member (member management detail).

## 4. Overview page (`/app`)

Cards (each with truthful copy, §13):

1. **Pending approvals** — count of payout items `pending_approval`
   (single + batch legs). Copy: "Waiting for an owner or approver. No funds
   have moved."
2. **Pending claim links** — effective `pending` + `claimed` claims. Copy:
   "Awaiting a wallet or an approval. Nothing has moved."
3. **Completed payouts today** — items completed since day start. Copy:
   "Completed through the execution pipeline."
4. **Prepared today** (USDC) — sum of items created today still
   `pending_approval`. Copy: "Prepared. Prepared is not paid."
5. **Completed today** (USDC) — completed item sum today. Copy: "Completed
   per the payout pipeline."
6. **Failed / unknown executions** — `validation_failed`,
   `simulation_failed`, `execution_failed`, `execution_unknown` counts, with
   "Unknown is not proof. Check the audit trail." copy.
7. **Active members** — active workspace member count.
8. **Recent audit events** — last 10 via `buildAuditView`.
9. **Recent agent requests** — last 10 runs via `buildAgentRunView`, each
   linking to `/app/agent-runs/[id]`; the card header states the agent
   "proposes — it never executes".

Overview is read-only. No numbers are ever computed from `agent_runs`.

## 5. Approvals page (`/app/approvals`)

Three tabs/sections, all sourced from the pipeline rows:

- **Payouts needing approval** — payout items `pending_approval` (single and
  batch legs grouped by payout), each row: requester, recipient label,
  amount, source type (Telegram payment / NL payment / batch / claim link /
  judge display-only), memo, created at.
- **Batch payouts needing approval** — one row per `telegram_batch` payout
  `pending_approval`: recipient count, total, requester, per-item breakdown
  in detail view.
- **Claimed claims awaiting approval** — claims with effective status
  `claimed`: amount, **masked** wallet in list, exact destination in the
  detail panel (owner/approver only), claimer, expiry, "wallet entry moved
  no funds" copy.

Controls (owner/approver only; member sees read-only rows):

- **Approve / Reject** per payout, batch, or claimed claim, wired to the
  existing application approval services (`applyApprovalCallback` /
  `applyClaimApprovalCallback` logic), not to raw transitions. Approve
  therefore flows through policy re-checks (per-tx + daily limits),
  separation-of-duty checks, and the KeeperHub simulation/execution gateway
  exactly like the Telegram buttons.
- **Separation-of-duty warnings** — the UI computes and renders "You
  requested this payout. You cannot approve it." (requester == session
  member), and for claims "You requested this claim. You cannot approve the
  claimed destination." Server rejects regardless (existing checks).
- **Policy/limit visibility** — each row shows the per-tx limit and the
  remaining daily budget at render time; approve failures show the policy
  reason verbatim.
- **No approval for self-request** — enforced server-side by the existing
  `actorIsRequester` checks; UI additionally disables the button with the
  warning above.
- **Judge workspaces**: approvals tab shows judge payouts as read-only
  (approve/reject buttons absent).

## 6. Payouts page (`/app/payouts` + `/app/payouts/[id]`)

List states (exact `EXECUTION_STATES` values from `state-machine.ts`, shown
with display labels; the "ready" bucket from the brief maps to the
`approved`/`simulating`/`submitted`/`confirming` in-flight group and is
labeled truthfully per-state, never invented):

| State | Display label | Copy hint |
|---|---|---|
| `draft`, `validated` | Prepared (pre-approval) | "Not yet submitted for approval." |
| `pending_approval` | Awaiting approval | "No funds have moved." |
| `approved` | Approved | "Approved — submitted for execution. Not yet completed." |
| `simulating` | Simulating | "Simulation in progress." |
| `submitted`, `confirming` | Executing | "Execution submitted / confirming." |
| `completed` | Completed | "Completed per the payout pipeline." |
| `validation_failed`, `simulation_failed`, `execution_failed` | Failed | "Failed — see audit trail." |
| `retrying` | Retrying | "Retry scheduled." |
| `execution_unknown` | Unknown | "Outcome not confirmed. Unknown is not proof." |
| `cancelled` | Cancelled | "No funds moved." |
| `partially_completed` | Partially completed | "Some legs completed; some did not." |

Detail view includes:

- **Source type**: Telegram payment, NL payment, batch (incl. NL batch),
  claim link, judge (display-only), M1 proof import, direct.
- **Requester** (label) and **approver** (derived from the
  `approval_granted` audit event's actor, not invented).
- **Recipients/items**: each item's recipient (full to owner/approver,
  masked to members), amount, memo, per-item state.
- **Amounts**: total + per item; currency USDC.
- **Timestamps**: created, approved (`approved_at`), completed
  (`completed_at`), cancelled (`cancelled_at`), item-level timestamps.
- **Transaction proof only when completed**: tx hash + BaseScan link rendered
  only when a completed item carries `transaction_hash` (the pipeline proof
  contract — same rule as the claim page `ClaimProof`). `approved`/`simulating`
  states never render hashes.
- **Audit timeline**: mapped `AuditView` events in order.
- **Approve/Reject** (owner/approver, pending_approval only) with the §5
  controls and warnings.

## 7. Claim links page (`/app/claims` + `/app/claims/[id]`)

List groups (effective status via the M11.2 read model, `nowIso` injected):

- **Pending / unclaimed** (`created`, not expired)
- **Claimed, waiting approval** (`claimed`)
- **Expired** (computed)
- **Rejected / cancelled** (`cancelled`)
- **Approved / payment prepared** (effective `approved`)
- **Completed** (pipeline-confirmed)
- **Not confirmed** (stored `executed` without pipeline proof → `unknown`)

Fields: **masked wallet** (first 6 + last 4), expiry (computed), amount,
linked payout id when exists, requester label. Detail page additionally
shows the full claimed destination to owner/approver (needed to approve the
exact address), the audit timeline, and:

- **Reissue action** — owner/approver only, only for effective
  `pending`/`expired`/`rejected` claims (M11.5 eligibility), reusing
  `reissueClaimLink`: creates a NEW claim + new token, returns the one-time
  link exactly once to the operator, old claim never resurrected.
  **Gate on migration 0013**: the live reissue audit event
  (`claim_reissued`) requires `migrations/0013_claim_reissue.sql` to be
  applied. The dashboard feature-flags the reissue button (disabled with an
  operator note) until the migration is confirmed applied — the design
  explicitly does not apply migrations from this milestone.
- **No raw-token redisplay** — token hashes/prefixes never rendered; the raw
  token appears only once in the reissue result (one-time reveal).
- **Claim-link batch deferred marker** — M11.6 batches remain unimplemented;
  the claims list shows no batch concept (batch-signal phrases decline at
  the Telegram layer with zero artifacts). If useful later, a "batch" is
  identified only via audit metadata linkage — never a new table.

## 8. Recipients page (`/app/recipients`)

- **Alias list** with full wallet addresses (operator surface), created-by
  label, created/updated metadata.
- **Add** (owner/approver): alias + EVM address form; validated with the
  existing address validation (`isValidEvmAddress` semantics, zero-address
  rejected); conflict handling mirrors the recipient service — duplicate
  alias/address returns the existing row truthfully (idempotent) or a clear
  conflict error, never a silent overwrite.
- **Edit** (owner/approver, deferred to M12.10 if at all): alias rename /
  address change with explicit confirm + audit event (`recipient_added`
  family extended by a repository-safe upsert that preserves audit history;
  editing an address that would duplicate another alias is rejected).
- **Delete** (owner/approver, M12.10): soft state removal with confirm +
  audit; deletion does not re-route or touch existing payouts/claims
  (historical rows keep their stored addresses).
- **Duplicate/conflict handling**: normalized-address uniqueness check
  (lowercased), alias uniqueness in workspace; conflicts surface as inline
  errors with the existing "no silent merge" rule.
- **Audit trail** per recipient via `recipient_added` (and future
  `recipient_updated`/`recipient_removed` events).
- **Role permissions**: view = all active members; manage = owner/approver.

## 9. Members page (`/app/members`)

- **Member list**: masked Telegram identity, role badge
  (owner/approver/member), status (active/removed), joined date.
- **Add / remove / change role** (owner only): role change is an explicit
  confirm action writing `member_added`/`member_removed`/`role_changed`
  audit events via the existing repository methods
  (`addWorkspaceMember`, `updateWorkspaceMemberRole`, `removeWorkspaceMember`).
- **Active/inactive status**: `status = active|removed` displayed; removed
  members' historical actions remain in the audit trail.
- **Last-owner guard**: before demoting/removing the final active owner, the
  UI warns and the server rejects when `countActiveOwners` would drop to
  zero — a workspace must keep ≥ 1 owner.
- **Separation-of-duty note**: page copy explains owner = manage,
  approver = decide, member = view; requester-never-approves-self is called
  out as enforced server-side.
- **Permission boundaries**: role changes never grant execution authority —
  approving still requires the pipeline; the dashboard's member management
  only edits workspace membership rows.
- **Audit trail** events shown on the page.

## 10. Policies page (`/app/policies`)

- **Per-transaction limit** (workspace row), **daily limit**, **workspace
  mode** (sandbox/development/personal/community/judge), **approval policy**,
  **allowed token/network** ("BASE · USDC" label — Base 8453 +
  canonical USDC token address, never the raw address), **workspace
  status**.
- **Remaining daily budget** computed via `sumPayoutItemsByWorkspaceStates`
  over the approved→completed window (same window as the approval-time
  checks).
- **Judge/sandbox distinction**: the page explains judge workspaces run
  `/judgepay`-only execution with their own caps and the dashboard is
  display-only there; sandbox is simulation-only, no funds move.
- **Effect on creation**: copy describes how each limit gates payout, batch,
  and claim creation at prepare time and re-checks at approval time (the
  authoritative transactional re-check) — loosening a limit does not loosen
  approval-time policy.
- **Warnings before tightening/loosening** (M12.10, owner-only): tightening
  the per-tx limit shows "Existing approved/executing items are not
  retroactively blocked; new approvals re-check the new limit."; loosening
  shows "Requests above the new limit will pass the per-tx gate at
  approval time." Both are confirm-required actions writing audit events.
- **Mode changes are NOT offered** (mode is a creation-time property; no
  dashboard action changes it — avoiding judge/sandbox confusion).
- Core M12 ships this page **read-only**; safe limit editing is M12.10.

## 11. Agent runs page (`/app/agent-runs` + `/app/agent-runs/[id]`)

Observability only — this page is a diagnostics surface, not transaction
truth:

- List/detail shows: run status (`received`…`failed`), **interpreted kind**
  (prepare payment / create claim / status / clarification / unsupported /
  batch), **decision/outcome**, **raw user intent redacted** (the already
  scrubbed `raw_text_redacted` — never the raw message, and only because the
  write path already redacts secrets/truncates), **provider** as a plain
  label (`static` / `openai-compatible`), started/completed timestamps,
  **linked payout/claim ids** when the run bridged.
- **No secrets** — no provider keys, no raw JSON (`candidates_json`,
  `interpretation_json`, `decision_json` are never rendered; only the
  bounded summary fields above).
- **No transaction truth from agent_runs** — a run never renders
  completed/paid/hash language; for runs with a linked payout/claim, the
  page renders "Payment truth lives in the payout/claim record" and links to
  `/app/payouts/[id]` or `/app/claims/[id]`.
- Forged-run immunity is inherited: the dashboard's run view reads only
  `agent_runs` observability fields; completion/hashes come only from the
  payout pipeline views.

## 12. Audit page (`/app/audit`)

- **Event timeline** (newest first) from `listAuditEventsByWorkspace`,
  mapped via `buildAuditView`: event type label, actor type/role, masked
  actor id, timestamp, payout/claim references, safe metadata summary.
- **Filters**: by payout, claim, member (actor), recipient
  (via recipient-related events), agent run (via `agent_run_started`
  events' run id), and event type.
- **Source metadata**: audit rows carry the source of truth (payout row vs
  claim row vs agent observability) in the view; the timeline never mixes
  agent-run records into payment truth.
- **No secrets**: metadata values are whitelisted per event type; raw JSON
  blobs are never rendered.
- **Export deferred**: CSV/PDF export is out of M12 scope (deferred scope §17).

## 13. UX copy principles

The dashboard speaks the same truthful language as every Solvo surface.
Copy rules (locked by the truthfulness test gate):

- **"Prepared" ≠ paid.** Prepared/awaiting-approval rows always render
  "No funds have moved."
- **"Approved" ≠ executed.** Approved/executing rows render
  "Approved — submitted through the execution pipeline. Completion is
  confirmed by the pipeline only."
- **"Wallet entered" ≠ funds moved.** Claim rows render "Entering a wallet
  never moves funds."
- **"Completed" only with pipeline proof.** The completed label + tx hash +
  BaseScan link render only when a completed item carries the pipeline hash.
- **"Unknown is not proof."** `execution_unknown` and `not-confirmed`
  states get explicit copy: "Outcome not confirmed. Check the audit trail."
- **"KeeperHub execution happens only after approval."** on any approve
  control and on the approvals page header.
- **Internal terms allowed only where operator-diagnostic and necessary**
  (agent-runs page: run status/kind labels, provider label) — and even then
  no raw JSON, no provider output, no hashes/execution ids beyond pipeline
  proof, no internal table/enum names in prose.
- Never: "paid/sent/transferred" as fact without pipeline proof; invented
  approvers; invented timestamps; invented counts.

## 14. Security and privacy rules

1. **No raw claim token redisplay** — tokens exist once at creation;
   dashboard shows claim ids, masked wallets, amounts, statuses only.
2. **No token hash or prefix shown** anywhere in the dashboard.
3. **No secrets** — no provider keys, no env values, no `DATABASE_URL`,
   no bot token, no KeeperHub keys, no wallet private keys.
4. **No provider raw output** — no `interpretation_json`/`decision_json`/
   `candidates_json`/`raw_keeperhub_status`/`simulation_result` dumps.
5. **No cross-workspace leaks** — every read/action is scoped to the
   session member's workspace; wrong/foreign workspace, inactive member,
   and non-member all collapse to one generic unavailable screen.
6. **Same-workspace membership gates** — membership + active status
   re-checked from the repository on every page load and every action.
7. **Role-based actions** — every action checks the role server-side;
   UI hiding is never the control.
8. **CSRF/server-action protection** — HttpOnly SameSite=Strict session
   cookie + Origin/Host verification on server actions + explicit confirm
   steps for dangerous actions.
9. **No direct raw SQL from UI handlers** — dashboard pages/actions use
   repository methods and read models only (source-contract tests assert
   this: dashboard modules import no `postgres` client, no execution
   service, no KeeperHub adapter).
10. **Execution authority preserved** — the dashboard never calls KeeperHub
    directly; approve actions invoke the existing application approval
    pipeline (which owns the gateway); no action auto-approves from claim
    entry; no action bypasses the owner/approver gate; Judge Mode is never
    reachable from the dashboard.
11. **No secrets in logs** — dashboard error paths use the existing
    sanitized logging (`serializeBotError` style), never raw rows.

## 15. Implementation plan (slices)

Ordering rationale: read models first (everything renders from them), then
the read-only pages in dependency order (overview needs counts from several
models; payouts → claims → recipients/members → policies → agent-runs/audit),
then the single safe-action slice, then the adversarial gate, then docs.

- **M12.2 — dashboard read models:** repository list/count methods (both
  implementations) + view builders + overview aggregates + tests
  (items 1–14 in §16). No routes yet.
- **M12.3 — overview page:** `/app` shell (layout, session gate, nav),
  session/login plumbing (cookie + `/dashboard` bot command deferred to the
  same slice), overview cards + truthful copy tests.
- **M12.4 — approvals page (read-only list):** `/app/approvals` rendering
  pending payouts/batches/claimed claims with policy visibility and
  separation-of-duty warnings; no buttons yet.
- **M12.5 — payout detail + batch detail:** `/app/payouts`, `/app/payouts/
  [id]`, `/app/batches`, `/app/batches/[id]` with per-state copy, proof-only-
  when-completed, audit timeline.
- **M12.6 — claims pages/detail:** `/app/claims`, `/app/claims/[id]` with
  effective-status groups, masked wallets, reissue eligibility display
  (button behind feature flag).
- **M12.7 — recipients + members pages:** `/app/recipients`,
  `/app/members` read-only lists + add/member-role actions where safe.
- **M12.8 — policies page:** `/app/policies` read-only summary with
  remaining budget + judge/sandbox notes.
- **M12.9 — agent runs + audit pages:** `/app/agent-runs(+/[id])`,
  `/app/audit` with filters; observability-only contracts.
- **M12.10 — action wiring for safe admin actions:** approve/reject via the
  existing approval services, reissue behind the 0013 migration gate,
  recipient add/edit, member role changes with last-owner guard, policy
  limit edits (owner-only, confirm + audit). Each action lands with its own
  role/no-leak/truthfulness tests.
- **M12.11 — adversarial/security/truthfulness gate:** hostile-session and
  hostile-action tests, no-leak matrix, raw-token/secret absence scans,
  source-contract tests (dashboard imports), forged-run immunity, full
  suite gate.
- **M12.12 — docs/roadmap final gate:** README roadmap, cross-references,
  final gate (`npm test`, `test:db`, lint, tsc, build, read-only doctors).

Every slice ends with lint + `tsc --noEmit` + its test files green.

## 16. Test matrix

≥ 60 concrete checks. Groups below (each `#n` is one test/action with an
expected outcome):

**Read-model tests (list/count/view builders):**
1. `listPayoutsByWorkspace` returns newest-first, filters by status, cursors
   pagination deterministically
2. `listAuditEventsByWorkspace` filters by payout, actor, event type
3. `listAgentRunsByWorkspace` returns observability rows only (no payout
   state machine fields)
4. `buildPayoutListView` shows requester label, source type, item count
5. `buildPayoutDetailView` includes approver ONLY from an
   `approval_granted` audit event (never invented)
6. `buildPayoutDetailView` never includes a tx hash unless a completed item
   carries one
7. `buildClaimListView` computes effective status via
   `getEffectiveClaimStatus` (expired is computed, not stored)
8. `buildClaimListView` contains no `token_hash`/`token_prefix` fields
9. `buildClaimDetailView` reuses the M11.2 view for status + proof
10. `buildOverviewView` counts match the repository sums/counts (prepared ≠
    completed; separate sums)
11. `buildOverviewView` never derives any number from `agent_runs`
12. `buildMemberListView` masks telegram user ids
13. `buildRecipientListView` shows full wallet to owner view, masked to
    member view
14. `buildPolicyView` shows mode/limits/remaining budget; never the raw
    token address

**Route/page tests:**
15. `/app` renders overview cards with truthful copy (no invented numbers)
16. `/app/approvals` renders pending payouts + batches + claimed claims
17. `/app/payouts/[id]` renders per-item states and audit timeline
18. `/app/batches/[id]` renders N items + total + per-item states
19. `/app/claims` groups by effective status
20. `/app/claims/[id]` renders masked wallet; full wallet only for
    owner/approver
21. `/app/recipients` lists aliases with metadata
22. `/app/members` lists roles/status; role badges correct
23. `/app/policies` renders limits + remaining budget + judge/sandbox notes
24. `/app/agent-runs` lists runs with provider label + no raw JSON
25. `/app/audit` renders timeline newest-first with filters applied
26. every dashboard page renders the same generic "Dashboard unavailable"
    screen for non-members

**Role/permission tests:**
27. member cannot approve; approve action returns a role-denied result
28. approver cannot manage members (role change rejected)
29. owner can approve, reissue, manage recipients, manage members
30. requester cannot approve own payout (existing SoD check runs; UI warning
    present)
31. requester cannot approve own batch; claim requester cannot approve the
    claimed claim
32. last-active-owner demotion/removal is rejected (owner count guard)
33. non-owner cannot edit policies
34. judge workspace shows display-only approvals (no buttons)
35. inactive/removed member loses all dashboard access on the next request
36. unknown/foreign workspace always yields the generic unavailable screen

**No-leak tests:**
37. foreign-workspace payout id → generic unavailable, no amount/member data
38. foreign-workspace claim id → generic unavailable
39. foreign-workspace audit filter → empty generic screen, no event rows
40. session replay after member removal → generic unavailable
41. direct `/app/payouts/[id]` with foreign id → generic unavailable
42. dashboard HTML/source contains no token hash/prefix strings (scan)
43. dashboard responses never include `raw_keeperhub_status`/
    `simulation_result`/`candidates_json` content

**Truthfulness tests:**
44. `approved` payout detail never renders a tx hash
45. `completed` payout detail renders hash + BaseScan ONLY from a completed
    item
46. `execution_unknown` renders "Unknown is not proof" copy
47. prepared cards render "No funds have moved."
48. completed card counts only pipeline-completed items
49. forged agent_run with fake hashes cannot change payout detail proof
50. forged agent_run cannot change overview completed numbers

**Claim-token-safety tests:**
51. claim list/detail never renders raw token, hash, or prefix
52. reissue action shows the new link exactly once (one-time reveal)
53. reissue button is disabled/flagged until migration 0013 is applied
54. reissue from the dashboard creates a NEW claim; old claim stays
    immutable (M11.5 contract via the shared service)

**Proof-source tests:**
55. payout detail proof source is the payout_item `transaction_hash` only
56. claim detail completed state requires pipeline confirmation (unknown
    otherwise)
57. batch detail completed legs require per-item pipeline proof

**Audit-trail tests:**
58. dashboard approve writes `approval_granted` via the existing pipeline
59. dashboard reject writes `approval_rejected` with actor
60. reissue from dashboard writes `claim_reissued` with old/new claim ids
61. member role change writes `role_changed` with actor
62. recipient add writes `recipient_added`; duplicate add is idempotent

**Agent-runs observability tests:**
63. run list shows redacted input only (never raw text, no secrets)
64. run detail shows linked payout/claim ids but no payment truth
65. provider label is `static`/`openai-compatible` string only

**Admin-action tests (M12.10):**
66. dashboard approve triggers the same application approval path as the
    Telegram button (policy re-check + gateway wiring, no raw transition)
67. dashboard reject on an already-approved item fails truthfully
68. policy limit tighten is confirm-required and audited
69. recipient delete is confirm-required and audited; historical payouts
    unchanged

**Source-contract tests:**
70. dashboard page/view modules import no `postgres` client, no KeeperHub
    adapter, no execution service, no webhook/telegram mutation modules
71. dashboard actions call only repository methods and the shared approval
    services — no raw SQL, no direct fetch

## 17. Deferred scope (NOT shipped in M12)

- CSV bulk admin import (recipients, payouts)
- claim-link batches (M11.6 design only; implementation deferred — batch
  phrases decline with zero artifacts)
- advanced analytics/charts beyond the overview cards
- external exports (CSV/PDF audit export)
- multi-workspace switcher (dashboard binds to the operator's workspace)
- live KeeperHub workflow builder
- x402 paid reports
- arbitrary query builder / raw SQL console (permanently excluded)
- direct operator execution bypassing approval (permanently excluded)
- workspace mode changes (creation-time property)
- web-side payout/claim creation (creation stays Telegram/NL surfaces)

## 18. Risk register

| Risk | Mitigation |
|---|---|
| Overclaiming payment status | Truthfulness contract (§13) + test items 44–50; completed only from pipeline proof |
| Accidental cross-workspace data leak | Same-workspace gate re-checked per request; generic unavailable screen; no-leak tests 36–43 |
| Exposing raw claim tokens/hashes | Views whitelist out token material; scan tests 42, 51–53 |
| Approving a self-request | Existing SoD checks run server-side on every approve; UI warning + disabled control; tests 30–31 |
| Confusing batch item state | Batch detail renders per-item states + partial-completion copy; test 57 |
| Dashboard becoming an execution bypass | Approve/reject only via the existing application approval services; no direct gateway calls from UI; source-contract tests 70–71 |
| Showing agent_runs as transaction truth | Runs page renders observability only; truth links to payout/claim rows; tests 63–65, 49–50 |
| Stale data / race conditions | Every page is a fresh read; approve actions run the transactional approval-time policy re-checks (TOCTOU-safe); pages labeled with render-time timestamps |
| Migration 0013 not applied before reissue usage | Reissue action feature-flagged until `claim_reissued` is confirmed available; no migration applied by M12 gates |
| Session hijack / CSRF | Short-lived one-time login link, HttpOnly SameSite=Strict cookie, Origin/Host checks, confirm steps for dangerous actions |
| Dashboard scope creep | Deferred scope §17 enforced; judge/sandbox display-only; no mode changes |
