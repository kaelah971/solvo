# M12 — Web Admin Dashboard: Design

Date: 2026-08-13
Branch: `feature/web-admin-dashboard`
Status: **COMPLETE / SHIPPED (read-only).** M12.1 design + M12.2 read models
+ M12.3 overview shell + M12.4 login bridge + M12.5 payout/batch pages +
M12.6 claim pages + M12.7 recipients/members pages + M12.8 policies page +
M12.9 agent-runs/audit pages + M12.10 approvals page (read-only) + M12.11
security/truthfulness gate + M12.12 docs/roadmap final gate all landed on
`feature/web-admin-dashboard`. The dashboard is intentionally READ-ONLY:
no web action wiring exists. No migrations were applied by any M12 gate,
and no payments were executed.

## M12.12 final gate (COMPLETE / SHIPPED)

The final docs/roadmap gate (after M12.11):

- **Final shipped scope**: the read-only operator console — personalized
  Telegram `/dashboard` login, signed `solvo_dash_session` cookie, per-request
  ACTIVE same-workspace membership re-check, and the `/app` overview,
  approvals queue, payouts (+detail), batches (+detail), claims (+detail),
  recipients, members, policies, agent-runs (+detail), and audit pages. Every
  page is server-rendered, workspace-scoped, no-leak, and pipeline-only-proof.
- **Final deferred scope (explicitly NOT shipped)**: web approve/reject
  actions; web claim reissue action (feature-flagged behind migration 0013);
  recipient add/edit/delete; member add/remove/role change; policy limit
  edits; CSV/bulk imports; claim-link batches; retry/recovery console;
  KeeperHub workflow companion; x402/paid reports; raw SQL/query builder;
  direct KeeperHub execution from the web. A future action-wiring slice
  (M12.10b) must route every action through the existing application
  services with role gates, policy re-checks, and separation-of-duty
  enforcement server-side, and must land with its own role/no-leak/
  truthfulness tests.
- **Route map** (all behind the session gate): `/app`, `/app/approvals`,
  `/app/payouts`, `/app/payouts/[id]`, `/app/batches`, `/app/batches/[id]`,
  `/app/claims`, `/app/claims/[id]`, `/app/recipients`, `/app/members`,
  `/app/policies`, `/app/agent-runs`, `/app/agent-runs/[id]`, `/app/audit`,
  plus `/auth/telegram-link` (token exchange → signed cookie) and
  `/auth/logout` (cookie clear). The shell nav links only implemented
  sections; `/app/settings` remains unbuilt.
- **Auth/session summary**: `/dashboard` issues a 10-minute, single-use,
  hash-only login token; `/auth/telegram-link` re-checks ACTIVE membership,
  consumes the token once, and sets the HMAC-signed cookie; every `/app`
  request re-resolves the member row from the repository — removed/inactive
  members and foreign-workspace cookies all collapse to one generic
  unavailable screen.
- **Security/truthfulness guarantees**: no execution/action bypass
  (forbidden-surface source scans + behavioral sweeps in the M12.11 gate),
  no cross-workspace data, no existence leaks (identical generic outputs for
  unknown vs foreign ids), no raw claim token/hash/prefix anywhere, masked
  wallets, pipeline-only proof (completed labels + tx hashes only from
  completed pipeline items carrying a hash), agent runs and audit events are
  never payment truth, overview totals never derive from `agent_runs`,
  prepared ≠ paid copy throughout, no admin controls/forms/server actions on
  any page.
- **Migration/env notes**: migration `0014_dashboard_login_tokens.sql` must
  be applied before live `/dashboard` token creation; migration
  `0013_claim_reissue.sql` must be applied before live reissue audit
  recording; `SOLVO_DASHBOARD_COOKIE_SECRET` is REQUIRED in production
  (production without it refuses all dashboard cookies). **Neither migration
  was applied by any M12 gate.**
- **Final validation results**: scoped-safe validation passed —
  `node --test tests/dashboard/*.test.ts` (273 pass, 0 fail),
  `tests/security/claim-link-truthfulness.test.ts` +
  `agent-truthfulness.test.ts` + `agent-execution-boundary.test.ts`
  (53 pass, 0 fail), `npm run lint` (0 errors; only pre-existing warnings in
  the unrelated landing-page workstream's `tests/ui/landing-source.test.ts`),
  `npx tsc --noEmit` (clean), `npm run build` (green; all dashboard routes in
  the route table). The full `npm test` suite was intentionally NOT run
  because unrelated landing-page WIP in the same working tree is known to
  fail `tests/ui/*`; those files are untouched and unstaged. No live model
  calls, no payments, no DB/Telegram/webhook/payment scripts were run; the
  read-only `telegram:doctor`/`judge:doctor` probes report configuration
  readiness without executing anything.

## M12.11 security/truthfulness gate (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.10):

- **Dashboard remains read-only**: the whole surface was re-proven to have
  no approve/reject/execute/retry/reissue/add/edit/delete controls, no
  forms, no server actions, no client handlers, and no `"use client"`
  components across every `/app` page (source-swept).
- **No web actions shipped**: M12.10b action wiring is explicitly deferred;
  nothing in the dashboard can call the approval services, execution
  gateway, or reissue service.
- **No execution bypass**: every page/model file is scanned for forbidden
  imports (`keeperhub/`, `mcp-client`, `execution-service`,
  `execution-gateway`, `telegram/flows`, `webhook`, `judge/`, `providers/`,
  `openai`, `anthropic`, `ai-sdk`, `postgres`, `node:http`, `node:https`,
  `fetch(`) and for raw SQL / database-client access; the Telegram
  `/dashboard` flow is proven to reference no execution/payment/approval
  vocabulary and to log nothing.
- **Session/token guarantees**: HMAC-signed HttpOnly SameSite=Strict
  cookies, tamper rejection, production-without-secret refusal,
  membership re-check on every request (removed/inactive members lose
  access with a still-valid cookie), one-time login tokens that expire and
  persist only as SHA-256 hashes, raw login tokens absent from storage/
  logs/pages/models, and the auth routes proven to render no markup and log
  nothing.
- **Workspace no-leak guarantees**: behavioral sweeps prove every list
  page model (9 builders) denies nonmember/removed/inactive contexts and
  shows foreign-workspace rows never; every detail page model (4 builders)
  returns the identical generic result for unknown and cross-workspace ids
  (no existence leak); pages never reference `workspaceId`/
  `telegramUserId`/search params; the unavailable/not-found panels accept
  no props and carry no sensitive fields.
- **Proof/truth source guarantees**: completed proof appears ONLY from a
  pipeline tx hash (completed-without-hash never invents proof), approved/
  payment-prepared never reads as paid, wallet-entry never reads as funds
  moved, agent runs never carry tx truth, audit rows never carry transaction
  proof, and overview totals never derive from `agent_runs`. No serialized
  dashboard model contains claim token/hash/prefix, KeeperHub execution ids,
  or provider/interpretation/decision/candidates JSON.
- **Forbidden surfaces checked**: token-material and raw-blob keys, secret
  markers (`DATABASE_URL`, API keys, bot tokens, `sk-`, Bearer), and
  hash-shaped literals are swept across all pages and models; the shell nav
  is proven to link only to implemented route directories (href → directory
  existence check); deterministic (created_at, id) DESC ordering is
  re-verified across claim/audit/agent-run lists.
- **Centralized gate** (`tests/dashboard/dashboard-security-gate.test.ts`,
  +22 tests): source-contract sweeps over `src/app/app/**`,
  `src/server/dashboard/**`, `src/app/auth/*/route.ts`, and
  `src/server/telegram/flows/dashboard-flow.ts` plus behavioral sweeps over
  all page-model builders. Existing session/login/per-surface route tests
  were extended where the gate overlaps.
- **Migrations not applied**: no dashboard source references migration
  0013/0014 or DDL; tests pass without either migration being applied.

## M12.10 approvals page (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.9):

- **Route added**: `/app/approvals` — server-rendered (`force-dynamic`),
  read-only decision queue, gated by the same M12.3/M12.4 session flow
  (signed cookie → repo re-check of ACTIVE same-workspace membership →
  gated page model). The dashboard shell nav now links Overview /
  Approvals / Payouts / Batches / Claims / Recipients / Members / Policies /
  Agent Runs / Audit (+ Sign out); only the settings section remains
  unlinked.
- **Read-only behavior**: no forms, buttons, server actions, or client
  handlers. No approve/reject/execute/retry/reissue surface exists anywhere
  on the page.
- **Workspace/session gate**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render the single generic
  `DashboardUnavailable` panel. All reads are workspace-scoped; no approval/
  workspace/member existence leak.
- **Pending payout queue**: payouts with pipeline state `pending_approval`
  and non-batch sources — source label, requester label, total, item count,
  created timestamp, separation-of-duty warning when the current operator
  requested it, and a link to `/app/payouts/[id]`.
- **Pending batch queue**: `pending_approval` payouts from batch sources
  (`telegram_batch`/`batch_csv`) — requester, total, item count,
  completed/pending/failed leg counts derived from the items' pipeline
  states, created timestamp, SoD warning, and a link to
  `/app/batches/[id]`.
- **Claimed claim links waiting approval**: claims whose M11.2 EFFECTIVE
  status is `claimed` — amount/currency/network, masked claimed wallet,
  computed expiry, requester, linked payout reference when present, SoD
  warning, and a link to `/app/claims/[id]`. Pending/unclaimed, computed
  expired, approved/payment-prepared, completed (pipeline-proof), and
  not-confirmed claims never enter the queue.
- **Role capability copy**: OWNER/APPROVER — "You may approve eligible
  requests later."; MEMBER — "Members can view this queue but cannot
  approve." (no action controls for anyone). SoD copy: "Requesters cannot
  approve their own payout." plus per-row warnings ("You requested this
  payout. You cannot approve it." / "You requested this claim. You cannot
  approve the claimed destination.").
- **Truthful copy**: "This queue shows requests waiting for a human
  decision." / "Approving does not execute funds by itself." / "KeeperHub
  execution happens only after approval and the existing execution
  pipeline." / "Nothing on this page approves, rejects, executes, or
  reissues." Empty state: "No pending approvals."
- **Page model** (`src/server/dashboard/approvals-page.ts`):
  `buildApprovalsPageModel` reads the pending payouts, their items, claims,
  and members ONCE per request and builds all three queues through the
  existing M12.2 pure mappers (`buildPayoutListItemView`,
  `buildPayoutItemView`, `buildClaimListItemView`, `payoutListSourceLabel`,
  effective claim status via `getEffectiveClaimStatus`); `approvalCapability`
  and `selfRequesterNote` are pure display helpers. `requesterIsSelf`
  compares the raw requester id against the session identity — the raw id
  itself never leaves the model.
- **Tests** (+21): page-model tests for gating (owner/approver/member
  render, nonmember/inactive identical unavailable), workspace scoping,
  honest empty state, single-vs-batch separation with counts, completed/
  cancelled/failed payouts never queued, claimed-only claim queue
  (pending/expired/approved/executed-without-proof/pipeline-completed all
  excluded), masked wallets, requester-is-self flags, role capability copy,
  token/hash/prefix/provider-JSON absence in serialized output, JSON
  serializability; route source-contract tests (forbidden imports, truthful
  copy, role capability + SoD copy in the model, safe detail links, no
  approve/reject/execute/retry/reissue controls or forms, banned terms,
  secret markers, shell nav includes Approvals, every denied path renders
  the shared unavailable panel). `tests/dashboard/payout-route-source.test
  .ts` nav assertion updated: Approvals is now a linked section.
- **No actions/execution**: nothing on the page approves, rejects, executes,
  or reissues; no migrations were applied during the M12.10 gates (0013/
  0014 remain unapplied).

## M12.9 agent-runs and audit pages (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.8):

- **Routes added**: `/app/agent-runs`, `/app/agent-runs/[id]`, and
  `/app/audit` — all server-rendered (`force-dynamic`), read-only, and gated
  by the same M12.3/M12.4 session flow (signed cookie → repo re-check of
  ACTIVE same-workspace membership → gated page model). The dashboard shell
  nav now links Overview / Payouts / Batches / Claims / Recipients /
  Members / Policies / Agent Runs / Audit (+ Sign out); no links exist for
  unimplemented sections (approvals/settings remain future slices).
- **Read-only behavior**: no forms, buttons, server actions, or client
  handlers anywhere on the observability pages. No filters beyond the
  read-model's built-in pagination options (visual-only timeline).
- **Workspace/session gate**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render the single generic
  `DashboardUnavailable` panel. Unknown or cross-workspace run ids render
  the single generic `DashboardNotFound` panel (no run existence leak).
- **Agent-runs observability-only behavior**: list + detail render only the
  M12.2 bounded view fields — run id (short display id), timestamps,
  surface label, provider label (the one documented place the operator
  "provider" term is allowed), status/intent/decision labels, redacted user
  text, safe error summary, and linked payout/claim references. Detail page
  links to `/app/payouts/[id]` or `/app/claims/[id]` ONLY after the page
  model verifies the linked entity row lives in the same workspace — a
  stale/foreign reference renders as plain "None", never a link. No raw
  provider/interpretation/decision/candidates JSON, no internal prompts, no
  secrets, and no transaction truth from `agent_runs`. Truth copy:
  "Agent runs explain how Solvo interpreted a request." / "Agent runs are
  not payment proof." / "Payment truth comes from payouts, claim links, and
  execution pipeline rows." / the `AGENT_RUNS_TRUTH_NOTE` constant.
  Empty state: "No agent requests recorded yet."
- **Audit safe timeline behavior**: newest-first timeline of whitelisted
  `AuditView` rows — event label, timestamp, masked actor, source family
  (PAYOUT/CLAIM/AGENT/WORKSPACE/SYSTEM), safe short entity reference
  (`Payout 1234abcd` / `Claim 1234abcd`), and a one-line whitelisted
  metadata summary (amount/total/count/masked recipient/reason — never the
  raw metadata blob). Truth copy: "Audit events show what Solvo recorded." /
  "Audit events do not create payment proof by themselves." / "Payment proof
  appears only when the execution pipeline recorded a transaction." Empty
  state: "No audit events recorded yet."
- **Truthfulness/security preserved**: no raw tokens/hashes/prefixes, no
  provider output, no KeeperHub payloads, no secrets/env values, no DB URLs/
  API keys/bot tokens (secret-marker scan on pages + models), no fake
  operational data, no cross-workspace rows, no tx hashes on any
  observability page, no admin action buttons. The agent-runs pages are the
  documented source-contract exception for the operator "provider" label
  (design §13); the audit page enforces the full banned-vocabulary list.
- **Page model** (`src/server/dashboard/observability-page.ts`):
  `buildAgentRunListPageModel` / `buildAgentRunDetailPageModel` (with
  same-workspace link verification) / `buildAuditPageModel` + pure display
  helpers (`shortRunId`, `agentRunSurfaceLabel`, `agentRunIntentLabel`,
  `auditSourceLabel`, `auditEntityLabel`, `auditSummaryLabel`); reuses
  `agentRunStatusLabel` / `agentRunDecisionLabel` / `auditEventLabel` from
  the overview page model.
- **Tests** (+28): page-model tests for gating (owner/approver/member
  render, nonmember/inactive identical unavailable), workspace scoping,
  honest empty states, provider/status/intent/decision labels, redacted
  text, no raw JSON/secret/execution material in serialized models, detail
  same-workspace rendering + cross-workspace/unknown rejection, verified
  same-workspace payout/claim links, audit source families + entity refs +
  safe summaries only, no raw metadata keys, no execution ids/secret
  markers, JSON serializability; route source-contract tests (forbidden
  imports, truthful copy, empty states, no buttons/forms/server actions,
  banned terms with the documented provider-label exception, secret
  markers, no tx truth on observability pages, model-verified link guards,
  generic not-found/unavailable panels, shell nav includes Agent Runs +
  Audit). `tests/dashboard/payout-route-source.test.ts` nav assertion
  updated: Agent Runs and Audit are now linked sections.
- **No actions/execution**: the observability pages execute nothing and
  approve nothing; no migrations were applied during the M12.9 gates
  (0013/0014 remain unapplied).

## M12.8 policies page (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.7):

- **Route added**: `/app/policies` — server-rendered (`force-dynamic`),
  read-only, and gated by the same M12.3/M12.4 session flow (signed cookie →
  repo re-check of ACTIVE same-workspace membership → gated page model). The
  dashboard shell nav now links Overview / Payouts / Batches / Claims /
  Recipients / Members / Policies (+ Sign out); no links exist for
  unimplemented sections.
- **Read-only behavior**: no forms, buttons, server actions, inputs, or
  client handlers. No edit/save/apply surface exists; the page cannot change
  limits, policies, or workspace mode.
- **Workspace/session gate**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render the single generic
  `DashboardUnavailable` panel. No cross-workspace data; no workspace
  existence leak.
- **Displayed policy sections** (only fields the schema actually stores —
  nothing fabricated):
  - workspace mode (SANDBOX / DEVELOPMENT / PERSONAL / COMMUNITY / JUDGE /
    UNKNOWN fallback) + active status;
  - token/network as a label ("BASE · USDC" only when the stored chain/token
    match the canonical values; never the raw token address);
  - per-transaction limit and daily limit from the workspace row (rendered
    "Not configured" when null — no invented values);
  - spent today + remaining today (window = items created since UTC day
    start in the same in-flight/completed states the approval-time daily
    checks use; remaining only when a daily limit exists);
  - approval requirement (REQUIRED / JUDGE POLICY / NOT CONFIGURED);
  - separation-of-duty note (server-side, requesters cannot approve their
    own payout);
  - judge/sandbox/development mode note as constant product copy — judge =
    `/judgepay`-only execution with its own caps, dashboard display-only;
    sandbox = simulation, no funds move; development = authorized users +
    small caps. No env values or secrets.
- **Role capability summary** (display only): OWNER — "Owners may manage
  policies later. Editing limits is not enabled yet."; APPROVER — "Approvers
  can view policies but cannot manage them."; MEMBER — "Members are
  view-only here."
- **Safety/truthfulness copy**: "Policies explain what Solvo will allow.
  This page does not change them." / "Approval and execution still happen
  through the existing Solvo pipeline." / "KeeperHub execution happens only
  after approval." Claim-link safety block: wallet-entered-does-not-move-
  funds, claim approval prepares a payment (does not execute by itself),
  raw claim links shown once, reissue not enabled from the dashboard yet.
  Dashboard-action note: editing limits/policies not enabled yet; policy
  changes will be audited when enabled later.
- **Page model** (`src/server/dashboard/policies-page.ts`):
  `buildPolicyPageModel` (gated, workspace-scoped) + pure display helpers
  `policyNetworkLabel` / `policyApprovalLabel` / `policyModeNote` /
  `policyCapabilitySummary` / `utcDayStartIso`. The daily-spend state list
  is defined locally (same states as the approval-time checks) so the model
  imports no execution/flow surface. No keeperhub imports (the canonical
  token address is matched case-insensitively against a local constant and
  never displayed).
- **Tests** (+19): page-model tests for gating (owner/approver/member
  render, nonmember/inactive identical unavailable), workspace scoping,
  mode + network labels (raw token address never leaks), limits + spent/
  remaining truth, null limits never invented, role capability summaries,
  judge workspace policy label, no env secrets in output, JSON
  serializability; route source-contract tests (forbidden imports, truthful
  copy, claim-link copy, no edit/save/apply controls or forms, banned
  internal terms, secret-marker scan, model-driven limit display, shell nav
  includes Policies, every denied path renders the shared unavailable
  panel). `tests/dashboard/payout-route-source.test.ts` nav assertion
  updated: Policies is now a linked section.
- **No actions/execution**: nothing on the page moves funds or changes
  policy; no migrations were applied during the M12.8 gates (0013/0014
  remain unapplied).

## M12.7 recipients and members pages (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.6):

- **Routes added**: `/app/recipients` (alias directory) and `/app/members`
  (workspace member directory) — both server-rendered (`force-dynamic`),
  read-only, and gated by the same M12.3/M12.4 session flow (signed cookie →
  repo re-check of ACTIVE same-workspace membership → gated page model). The
  dashboard shell nav now links Overview / Payouts / Batches / Claims /
  Recipients / Members (+ Sign out); no links exist for unimplemented
  sections.
- **Read-only behavior**: no forms, buttons, server actions, or client
  handlers anywhere on the directory pages. No add/edit/delete recipient
  surface and no add/remove/change-role member surface exists.
- **Workspace/session gate**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render the single generic
  `DashboardUnavailable` panel. Identities are masked everywhere (`1112…333`
  style); no raw telegram user ids render; no workspace/member existence
  leak.
- **Member/recipient visibility**: recipients show the alias, the wallet
  (FULL for owners/approvers, masked `0x76d7…7486` for members — the read
  model's `canViewSensitiveDestinations` rule), saved-by label, created and
  updated timestamps. Members show masked identity, role badge
  (OWNER/APPROVER/MEMBER), status badge (ACTIVE/INACTIVE), joined and
  updated timestamps. Recipient rows carry no stored token/network/status
  fields today, so none are fabricated.
- **Role labels**: pure page-model mappers (`memberRoleLabel`,
  `memberStatusLabel`) keep internal role/status terms out of page copy.
- **Separation-of-duty copy** (members page): "Roles control what people can
  request, approve, and manage." / "Separation of duty is enforced
  server-side: requesters cannot approve their own payout." / "Changing roles
  is not enabled from the dashboard yet."
- **Aliases-do-not-move-funds copy** (recipients page): "Recipients are
  saved aliases. Saving an alias does not move funds." / "Payments still
  require approval and KeeperHub execution."
- **No actions yet**: nothing on either page can add, edit, remove, or
  change roles; no approvals/execution surface; no migrations were applied
  during the M12.7 gates (0013/0014 remain unapplied).
- **Page model** (`src/server/dashboard/directory-page.ts`): gated wrappers
  over the M12.2 member/recipient read models (`buildRecipientsPageModel` /
  `buildMembersPageModel`) plus the role/status display labels. The member
  read-model view gained `updatedAt` (additive; `MemberListItemView` +
  `buildMemberListItemView`).
- **Tests** (+~20): recipients/members page-model tests for gating
  (owner/approver/member render, nonmember/inactive identical unavailable),
  workspace scoping (cross-workspace rows never appear), honest empty
  states, alias + timestamps, member masking vs owner/approver full wallets,
  masked identities, role/status labels, JSON-serializability, and no
  token/provider/execution material in serialized models; route
  source-contract tests (forbidden imports, truthful copy, honest empty
  states, no add/edit/delete/role-change controls, banned terms, shell nav
  includes Recipients + Members, every denied path renders the shared
  unavailable panel). `tests/dashboard/payout-route-source.test.ts` nav
  assertion updated: Recipients and Members are now linked sections.

## M12.6 claim pages (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.5):

- **Routes added**: `/app/claims` (claim link directory) and
  `/app/claims/[id]` (claim detail) — both server-rendered
  (`force-dynamic`), read-only, and gated by the same M12.3/M12.4 session
  flow (signed cookie → repo re-check of ACTIVE same-workspace membership →
  gated page model). The dashboard shell nav now links
  Overview / Payouts / Batches / Claims (+ Sign out); no links exist for
  unimplemented sections.
- **Read-only behavior**: no forms, buttons, server actions, or client
  handlers anywhere on the claim pages. No reissue button/form/action exists.
- **Workspace/session gate**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render the single generic
  `DashboardUnavailable` panel. Unknown or cross-workspace claim ids render
  the single generic `DashboardNotFound` panel (identical copy for every id —
  no claim existence leak).
- **Effective claim statuses** (M11.2 rules, `nowIso` injected): pending /
  unclaimed, claimed (waiting approval), expired (computed — a `created`
  claim past its deadline reads `expired`, never persisted), rejected /
  cancelled, approved (payment prepared), completed (ONLY when the linked
  payout pipeline has a completed item carrying a transaction hash),
  not-confirmed / unknown (stored `executed` without pipeline proof). Claimed
  claims stay claimed after expiry; approved never reads as paid; completed
  never renders without pipeline proof.
- **Masked wallet behavior**: claimed wallets render masked everywhere
  (`0x76d7…7486`); no page reveals a full claimed destination (approvals
  surface arrives in a later slice). List rows show "claimed · <masked>"
  only when a wallet exists.
- **Pipeline-only proof**: the detail page renders the TX hash + explorer
  link ONLY when the M11.2 status view carries `txHash`/`txExplorerUrl`
  (a completed pipeline item with a hash). Completed-without-hash and
  not-confirmed claims show "No pipeline transaction proof to show." and
  never render a hash.
- **Reissue eligibility display only**: list rows and the detail page show
  "Eligible to reissue" / "Not eligible to reissue" computed from the role
  gate (active owner/approver) + M11.5 state gate (stored `created` incl.
  computed expired, or `cancelled`), with the reason when ineligible. The
  detail page's eligible state shows: "Reissue action will be enabled after
  the claim reissue migration is applied and admin actions are wired." No
  button, no form, no server action.
- **No actions/execution**: the claim pages execute nothing, approve/
  reject/retry nothing, and never call KeeperHub/execution services. No
  migrations were applied during the M12.6 gates (0013/0014 remain
  unapplied).
- **Truthfulness copy** on the detail page: "Wallet entered does not mean
  funds moved." / "Claim approval prepares a payment; it does not execute
  one by itself." / "Completed proof appears only when the execution
  pipeline recorded a transaction." / "Raw claim links are shown once and
  cannot be redisplayed."
- **Page model** (`src/server/dashboard/claims-page.ts`): gated wrappers
  over the M12.2 claim read model (`buildClaimListPageModel` /
  `buildClaimDetailPageModel`), display labels (`claimStatusLabel`,
  `claimProofLabel`), pipeline enrichment for list rows (payout state +
  proof presence), `reissueEligibilityDisplay` (pure role+state display),
  and `shortClaimId`. List rows include short id, effective status, proof
  chip, amount/currency/network, computed expiry, masked wallet, linked
  payout id + state, reissue display, created timestamp, and a detail link.
- **Tests** (+~30): list/detail page-model tests for gating (owner/approver/
  member render, nonmember/inactive identical unavailable), workspace
  scoping, honest empty state, effective-status grouping (incl. computed
  expiry and claimed-preserved), approved-without-paid copy, completed-only-
  with-pipeline-proof, never-fake-proof, masked wallets, linked payout
  state, cross-workspace/unknown detail rejection with generic not-found,
  tx-proof-only-on-hash, completed-without-hash/not-confirmed no-proof,
  reissue display (owner/approver eligible, member denied), token/hash/
  prefix absence in serialized models, execution-id/raw-JSON absence, JSON
  serializability; route source-contract tests (forbidden imports, truthful
  copy, empty state, no action controls incl. no reissue button, banned
  terms, proof guards, shell nav includes Claims, generic not-found panel).
  `tests/dashboard/payout-route-source.test.ts` nav assertion updated:
  Claims is now a linked section.

## M12.5 payout and batch pages (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.4):

- **Routes added**: `/app/payouts`, `/app/payouts/[id]`, `/app/batches`,
  `/app/batches/[id]` — all server-rendered (`force-dynamic`), read-only, and
  gated by the M12.3/M12.4 session flow (signed cookie → repo re-check of
  ACTIVE same-workspace membership → gated page model). The dashboard shell
  nav now links Overview / Payouts / Batches (+ Sign out); no links exist for
  unimplemented sections.
- **Shared page plumbing**: `src/server/dashboard/page-gate.ts`
  (`resolveDashboardPageGate` reads the signed cookie + clock for one
  request) and `src/components/DashboardPanels.tsx` — `DashboardUnavailable`
  (the one no-leak screen for no session / inactive / non-member / no
  workspace / no DB) and `DashboardNotFound` (the one no-leak screen for
  unknown or cross-workspace payout/batch ids; identical copy for every id).
- **Payout list** (`src/server/dashboard/payouts-page.ts`): workspace-scoped
  rows with short display id, safe source labels (Telegram payment /
  Natural-language payment / Batch payout / Claim link / Judge mode /
  safe fallback), state label, requester label, decision summary (only from
  `approval_granted`/`approval_rejected` audit events, batched via a new
  `payoutIds` audit filter), total, item count, timestamps, and a truthful
  proof-status chip (`payoutProofStatus`): Completed with proof (EVERY item
  completed + payout completed + every completed item has a tx hash) /
  Completed without visible proof / Pending approval / Approved but not
  executed / Executing / Failed or unknown / Cancelled / Partially
  completed. Honest empty state: "No payout requests yet."
- **Payout detail**: summary grid (status, requester, decision, total, items,
  created/approved/completed), item table (recipient full for owner/approver,
  masked for members, amount, state, safe memo — claim memos hidden, proof
  link ONLY when a completed item carries a pipeline tx hash), audit
  timeline, and truth copy: "Approved does not mean executed." /
  "Completed proof appears only when the execution pipeline recorded a
  transaction."
- **Batch list**: batch sources only (`telegram_batch`/`batch_csv`), with
  per-batch completed/pending/failed counts derived from item pipeline
  states and the same proof chips. Empty state: "No batch payouts yet."
- **Batch detail**: batch summary grid, per-recipient table with per-item
  state + proof only where a completed leg has a hash, audit timeline, no
  approve/reject/retry controls. Non-batch and unknown/cross-workspace ids
  render the generic not-found panel.
- **Truthfulness/security preserved**: no KeeperHub/MCP/execution-writer/
  Telegram-webhook/model-provider/fetch imports in any page or page model
  (source-contract tested); no raw token/hash/prefix, provider JSON, raw
  KeeperHub status, simulation results, or execution ids anywhere; no fake
  tx hashes (proof guards `item.txHash !== null`); no cross-workspace data;
  no admin action buttons.
- **Tests** (+28): page-model tests for gating (owner/approver/member render,
  nonmember/inactive identical unavailable), workspace scoping, honest empty
  states, proof chips (incl. "completed without hash never shows proof"),
  source labels, decision-from-audit, item states/amounts, member masking,
  safe audit timelines, batch-only lists, batch detail rejection of non-batch
  ids, per-item proof only where present, JSON-serializability; route
  source-contract tests (forbidden imports, truthful copy, empty states, no
  action controls, banned terms, proof guards, shell nav, generic not-found
  panel). Overview-route-source updated for the shared panels.
- **No actions/execution**: all pages read-only; no migrations applied during
  the M12.5 gates.

## M12.4 Telegram dashboard login bridge (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.3):

- **`/dashboard` Telegram command** (community group chats only; registered
  in the command registry/menu with the same "implemented-only" discipline).
  `src/server/telegram/flows/dashboard-flow.ts` issues a one-time login link
  to an ACTIVE community workspace member; every denied shape — private chat,
  unknown chat workspace, non-community mode, non-member, inactive member —
  replies with the SAME generic copy: "Dashboard unavailable. Ask a workspace
  owner to add you, then try /dashboard again." (no existence leak, no
  workspace/member ids). The reply shows the link + "This link expires in 10
  minutes and can be used once." No payment/approval/execution surface is
  touched; no console logging exists in the flow.
- **One-time login tokens** (`src/server/dashboard/login-links.ts`): 256-bit
  CSPRNG base64url raw token returned exactly once; ONLY its SHA-256 hash is
  persisted (`dashboard_login_tokens`); expiry 10 minutes (default); single-
  use via an atomic `used_at` consume (raced consumes collapse to one);
  scoped to workspace_id + telegram_user_id + member_id + role; raw tokens
  never appear in storage, audit metadata, logs, or errors.
- **Persistence**: `createDashboardLoginToken` /
  `getDashboardLoginTokenByHash` / `consumeDashboardLoginToken` in the
  repository interface + MemoryRepository + PostgresRepository.
  **Migration `migrations/0014_dashboard_login_tokens.sql` EXISTS but was NOT
  applied** — it must run (`npm run db:migrate`) before live login-token
  creation; no migration was applied by the M12.4 gates.
- **`/auth/telegram-link`** (route handler): verifies the token
  (unknown/expired/used → generic unavailable), RE-CHECKS ACTIVE same-
  workspace membership from the repository (`resolveDashboardContext` +
  `canViewDashboard`), atomically consumes the token, sets the session cookie,
  redirects to `/app`. Invalid/expired/used/nonmember/inactive all redirect to
  `/app` with no cookie — /app renders the generic no-leak unavailable
  screen. The token is never logged or echoed.
- **Signed session cookie** (session seam upgraded): `solvo_dash_session` =
  `base64url(payload).base64url(hmac-sha256)` keyed by
  `SOLVO_DASHBOARD_COOKIE_SECRET` (production REQUIRES the env secret; a
  marked dev constant is used outside production; production without a secret
  refuses all cookies). Attributes: HttpOnly, SameSite=Strict, Secure in
  production, Path=/, Max-Age 7 days. Tampered cookies fail verification.
  `/app` STILL re-checks repository membership on every request —
  `requireDashboardContext` — so removed/inactive members lose access even
  with a valid cookie, and a signed cookie for another workspace is rejected.
- **`/auth/logout`** (route handler): clears the session cookie (Max-Age 0)
  and redirects to `/`.
- **Tests** (+30): token service (entropy, hash-only storage, verify/
  unknown/expired/used, single-use consume, scoping, no-raw-token rules),
  session issuance (cookie attributes, consumed-once, invalid/expired/used
  identical unavailable, nonmember/inactive never issue and tokens stay
  unconsumed, membership re-check kills removed members, cross-workspace
  cookie rejection, tamper rejection, production-without-secret refusal),
  Telegram /dashboard (parsing + addressed form, owner/approver/member links,
  denied-shape identical copy, no id leaks, zero payment/execution artifacts,
  no logging), command-menu update, source contracts (login/session/route/
  flow modules import no KeeperHub/MCP/execution writer/model provider; the
  Telegram flow imports no payment path; route never renders the token).
- **No actions/execution**: the login bridge issues identity only; approvals
  and admin actions remain future M12 slices.

## M12.3 overview shell (implemented)

Implemented on `feature/web-admin-dashboard` (after M12.2):

- **`/app` exists** as a server-rendered route group: `src/app/app/layout.tsx`
  (slim operator shell — wordmark, "Operator Dashboard" label, back link; no
  marketing nav/footer) + `src/app/app/page.tsx` (overview). The root layout's
  props typing was relaxed to accept nested layouts. `/app` renders
  `force-dynamic` and is in the build's route table.
- **Session seam** (`src/server/dashboard/session.ts`):
  `parseDashboardSessionCookie` / `getDashboardSessionFromHeaders` read ONLY
  the `solvo_dash_session` cookie (URI-encoded JSON `{workspaceId,
  telegramUserId}`); `requireDashboardContext` resolves the M12.2 context
  from the repository on every request and re-checks ACTIVE same-workspace
  membership (`canViewDashboard`). No query params are ever trusted; the
  final Telegram-issued one-time login link (M12.4+) plugs in behind this
  seam, which is injectable/mocked in tests.
- **Page model** (`src/server/dashboard/overview-page.ts`):
  `buildOverviewPageModel(repo, ctx)` — JSON-safe `{ ok: true, workspaceLabel,
  modeLabel, roleLabel, overview }` or the single generic `{ ok: false }`.
  Pure display mappers (`roleLabel`, `modeLabel`, `auditEventLabel`,
  `agentRunStatusLabel`, `agentRunDecisionLabel`, `formatUtc`) keep internal
  terms out of copy.
- **Unavailable/no-leak behavior**: no session, unknown workspace, non-member,
  inactive member, and no-DB all render ONE generic
  `WORKSPACE DASHBOARD UNAVAILABLE` panel — "Open Telegram and type /dashboard
  to access your workspace dashboard." No workspace/claim/payout/member ids and
  no raw errors ever render; the unavailable component takes no data props.
- **Overview cards** (all from the M12.2 read model): pending approvals,
  claim links waiting, claimed-waiting-approval, prepared today (USDC),
  completed today (USDC + count), failed/unknown executions, active members,
  recipients; plus recent audit events (label + masked actor + time) and
  recent agent requests (status/decision labels + time) with an
  observability-only note; claim-count-cap warning when the read cap was hit.
- **Truthfulness copy**: "Prepared does not mean paid.", "Completed totals
  come from the execution pipeline.", "Unknown is not proof.", "No funds have
  moved.", "KeeperHub execution happens only after approval." / "Nothing on
  this dashboard moves funds." No tx hashes render on the overview at all.
- **No actions/execution**: the page contains no forms, buttons, server
  actions, or client handlers — read-only, and no `/dashboard` login link
  wiring exists yet.
- **Tests** (`tests/dashboard/session.test.ts`, `overview-page.test.ts`,
  `overview-route-source.test.ts`, +25): session cookie parsing/invalid shapes,
  query-param non-trust, repo re-check gating (removed member loses access),
  owner/approver/member overview, identical unavailable for every denied
  shape, all metrics, cross-workspace exclusion, no token/hash/provider-JSON,
  JSON-serializability, truthful copy, banned-term scan, no admin controls,
  route source contract (no KeeperHub/MCP/execution-writer/Telegram/model-
  provider/fetch imports), no search-param trust in the session seam.
- **No migration applied** during the M12.3 gates.

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
