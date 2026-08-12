# Solvo — Product Requirements Document

## 1. Executive summary

Solvo is a Telegram-native conversational treasury execution agent powered by KeeperHub.

It lets a person, team or community initiate a USDC payment where the decision already happens—inside a private chat or Telegram group—then handles the last mile:

```text
VALIDATE → AUTHORISE → SIMULATE → EXECUTE → MONITOR → PROVE
```

The KeeperHub hackathon rewards products that do more than reason about a transaction. Solvo is designed to demonstrate a working transaction that acts onchain and leaves behind observable proof.

## 2. Product thesis

Agents and communities can increasingly decide what should happen in natural language. The unresolved problem is what happens after the decision.

A payment instruction is not a completed payment. Between the two are:

- recipient identity;
- amount and token validation;
- spending policy;
- human approval;
- simulation;
- gas and execution;
- confirmation;
- retry classification;
- audit evidence.

Solvo owns that last mile.

### Core thesis

> **The execution layer is the product. Telegram is the control surface. KeeperHub is the reliable transaction engine.**

## 3. Brand and product foundation

### Name

**Solvo** — pronounced `SOL-voh`.

The name is derived from the Latin *solvo / solvere*, associated with releasing, paying, settling and resolving.

### Descriptor

**Conversational treasury execution**

### Primary tagline

**From instruction to execution.**

### Core message

> Solvo turns Telegram payment instructions into safe, reliable, auditable USDC transactions.

### Strategic enemy

The uncertainty after someone says, “Send the money.”

### Product principle

> **No payment is complete until it is proved.**

## 4. Goals

### Hackathon goals

1. Prove one real KeeperHub transaction.
2. Allow a judge to complete the transaction without founder intervention.
3. Keep the judge environment isolated and strictly capped.
4. Return an execution status, transaction hash and audit link.
5. Demonstrate a public sandbox that does not touch real funds.
6. Show that the same execution engine can extend to community payouts.

### Product goals

1. Make a payment request possible inside Telegram.
2. Make risky details visible before approval.
3. Enforce workspace roles and spending limits.
4. Simulate before broadcasting.
5. Execute through KeeperHub.
6. Provide clear pending, completed and failed states.
7. Preserve a usable audit record.

## 5. Non-goals

The initial submission does not need:

- multiple chains;
- multiple tokens;
- a full wallet product;
- full payroll functionality;
- a full admin dashboard;
- x402 or MPP monetisation;
- custom multisig contracts;
- complex multicall contracts;
- advanced analytics;
- a general-purpose agent marketplace.

## 6. Target users and jobs

### Community treasurer

**Job:** Distribute rewards, reimbursements, grants or contributor payments accurately and accountably.

**Pain:** Spreadsheet errors, repeated wallet work, unclear approvals and missing records.

**Desired outcome:** Upload once, validate everything, approve once and receive a complete report.

### Team or DAO member

**Job:** Request payment without taking control of treasury funds.

**Pain:** No visibility into approval or execution.

**Desired outcome:** A request that is easy to make and easy to track.

### Individual sender

**Job:** Send a small USDC payment to a person.

**Pain:** Wallet complexity and uncertainty about the recipient address.

**Desired outcome:** A safe direct payment or claim link with explicit confirmation.

### Judge

**Job:** Test a real onchain execution path quickly.

**Pain:** Demo systems that require the founder to approve or operate them manually.

**Desired outcome:** One independently executable transaction with proof.

## 7. Product modes

### Sandbox

Public testing environment with simulated transactions only.

Requirements:

- no real KeeperHub credentials;
- no real funds;
- full validation experience;
- simulated approval;
- simulated receipts;
- clear “no funds moved” language.

### Judge Demo

Restricted real-transaction environment.

Requirements:

- dedicated bot or workspace;
- dedicated KeeperHub wallet;
- Telegram allowlist;
- automatic approval;
- max `0.10 USDC` per transaction;
- max `1 USDC` per day;
- Base USDC only for the MVP;
- every real transaction logged.

### Personal Workspace

A person can pay directly or create claim links with their own approval policy.

### Community Workspace

A community or DAO has its own workspace, members, approvers, policies and payout history.

## 8. User stories

### Direct payment

- As a user, I want to send USDC to an explicit address from Telegram.
- As a user, I want the system to validate the address and amount before execution.
- As a user, I want to see the destination before I approve.
- As a user, I want a transaction hash after completion.

### Claim link

- As a sender, I want to create a link without knowing the recipient’s wallet address.
- As a recipient, I want to enter my destination address in a browser.
- As a sender, I want to approve the final address before money moves.
- As a system, I want claim links to be single-use and expiring.

### Community payout

- As a member, I want to upload a rewards or reimbursement CSV.
- As a treasurer, I want invalid addresses and duplicate recipients identified before approval.
- As an approver, I want to see the total and complete preview before releasing funds.
- As a community, I want item-level outcomes and a final report.

### Reliability

- As a user, I want simulation to happen before real submission.
- As a user, I want pending state to remain visible.
- As an operator, I want transient failures retried safely.
- As an auditor, I want the request, approval, execution and outcome recorded.

## 9. Scope of the MVP

### Must have

- public landing page;
- Telegram bot;
- sandbox mode;
- isolated judge mode;
- `/start`;
- `/help`;
- `/pay`;
- `/status`;
- direct wallet payment;
- validation;
- approval policy;
- judge auto-approval;
- per-payment and daily limits;
- KeeperHub MCP execution;
- simulation before submission;
- execution status polling;
- transaction hash receipt;
- audit-trail link.

### Should have

- group workspace support;
- `/recipient add`;
- `/recipient list`;
- CSV upload;
- duplicate detection;
- batch progress updates;
- safe retry handling;
- owner, approver and member roles;
- `/distribute`;
- claim links;
- claim page.

### Deferred

- full admin dashboard;
- multiple chains;
- user-owned wallet connections;
- x402 or MPP features;
- complex multicall workflows;
- full payroll;
- custom multisig contracts.

## 10. Functional requirements

### Validation

The system must validate:

- EVM address format and checksum;
- positive USDC amount;
- supported chain and token;
- CSV headers;
- every CSV row;
- duplicate recipients;
- per-payment limits;
- daily workspace limits.

### Authorization

The system must:

- store Telegram numeric IDs;
- distinguish owner, approver and member;
- restrict judge access to allowlisted IDs;
- reject unauthorised approval callbacks;
- prevent request creators from approving restricted community payouts;
- validate all authority server-side.

### Execution

The system must:

1. load an approved payout item;
2. confirm permitted workspace;
3. confirm chain and token;
4. check remaining daily limit;
5. simulate through KeeperHub;
6. persist simulation result;
7. submit with an idempotency key;
8. poll execution status;
9. persist the execution ID and transaction hash;
10. create final audit event;
11. notify Telegram.

### Retry rules

Retry only safe transient failures such as timeouts or temporary service errors.

Do not automatically retry:

- invalid addresses;
- invalid amounts;
- failed simulations;
- rejected approvals;
- policy violations.

## 11. State machine

```text
draft
→ validated
→ pending_approval
→ approved
→ simulating
→ submitted
→ confirming
→ completed
```

Failure states:

```text
validation_failed
simulation_failed
execution_failed
retrying
cancelled
```

Every transition must be persisted and auditable.

## 12. Core architecture

```text
Public Website
    ↓
Telegram Bot
    ↓
Solvo API
    ├── PostgreSQL / Supabase
    └── Payout Worker
            ↓
       KeeperHub MCP
            ↓
       Base USDC
```

### Suggested services

- `apps/web` — landing page and claim page;
- `apps/bot` — Telegram webhook, commands, formatting and approval actions;
- `apps/worker` — payout polling, simulation, KeeperHub execution, status polling and retry classification;
- `packages/core` — payout state machine, workspace policy and mode handling;
- `packages/validation` — address, amount, CSV, duplicate and claim-token validation;
- `packages/database` — persistence and queries;
- `packages/keeperhub` — MCP connection, simulation, execution, status and error classification.

### Recommended stack

- SvelteKit;
- Tailwind CSS;
- TypeScript strict mode;
- Zod;
- grammY;
- Node.js;
- PostgreSQL through Supabase;
- Vitest;
- Playwright;
- Railway and/or Vercel according to deployment needs.

## 13. Data model

### `workspaces`

- `id`;
- `mode`;
- `telegram_chat_id`;
- `chain_id`;
- `token_address`;
- `per_transaction_limit`;
- `daily_limit`;
- `approval_policy`;
- `status`;
- `created_at`.

### `workspace_members`

- `id`;
- `workspace_id`;
- `telegram_user_id`;
- `role`;
- `created_at`.

### `recipients`

- `id`;
- `workspace_id`;
- `alias`;
- `wallet_address`;
- `memo`;
- `created_by`;
- `created_at`.

### `payouts`

- `id`;
- `workspace_id`;
- `requester_id`;
- `source_type`;
- `status`;
- `total_amount`;
- `created_at`;
- `approved_at`;
- `completed_at`.

### `payout_items`

- `id`;
- `payout_id`;
- `wallet_address`;
- `amount_base_units`;
- `memo`;
- `status`;
- `execution_id`;
- `transaction_hash`;
- `attempt_count`;
- `idempotency_key`.

### `claim_links`

- `id`;
- `payout_item_id`;
- `token_hash`;
- `expires_at`;
- `claimed_address`;
- `claimed_at`;
- `status`.

### `execution_attempts`

- `id`;
- `payout_item_id`;
- `attempt_number`;
- `simulation_result`;
- `keeperhub_execution_id`;
- `transaction_hash`;
- `status`;
- `error_code`;
- `created_at`.

### `audit_events`

- `id`;
- `workspace_id`;
- `payout_id`;
- `payout_item_id`;
- `event_type`;
- `actor_id`;
- `metadata`;
- `created_at`.

Store USDC values as integer base units, never floating point values.

## 14. Brand experience requirements

The product must express the same meaning as the positioning.

### Execution Receipt

Every completed real payment should produce a receipt containing:

- amount;
- recipient;
- network;
- approval path;
- execution status;
- KeeperHub execution ID;
- transaction hash;
- audit link.

### Execution Line

The interface should expose:

```text
REQUEST → CHECK → APPROVE → EXECUTE → PROVE
```

### Required language

- `Simulation complete. No funds were moved.`
- `Approval required.`
- `Execution is confirming.`
- `Payment completed.`
- `Review required.`
- `Transaction proof available.`

### Forbidden experience

- claiming completion before confirmation;
- burying the destination address;
- using only colour to signal state;
- showing a simulation as a real receipt;
- treating Telegram usernames as wallet identities;
- hiding failures behind generic “something went wrong” language.

## 15. Hackathon demo

The ideal demo is:

1. Judge opens the dedicated Solvo Telegram bot.
2. Judge submits a small USDC payment.
3. Solvo validates the request.
4. The judge allowlist and limits pass.
5. Solvo auto-approves within policy.
6. KeeperHub simulates the transfer.
7. KeeperHub submits the real Base USDC transaction.
8. Solvo polls until completion.
9. Telegram displays the transaction hash.
10. Judge opens the KeeperHub audit trail.
11. Presenter shows sandbox mode.
12. Presenter explains how the same engine extends to a community CSV payout.

### Demo line

> Solvo does not just decide what should happen. It makes the payment happen—and proves it did.

## 16. Success criteria

Solvo is ready when:

- sandbox users cannot access real funds;
- a judge can complete a real transaction without founder intervention;
- every real transaction passes through KeeperHub;
- every real transaction returns a transaction hash;
- every real transaction has an audit record;
- unauthorised users cannot approve restricted payouts;
- invalid and duplicate CSV rows are identified before execution;
- pending, failed and completed states are visible.

## 17. Implementation sequence

### Phase 1 — KeeperHub proof

- configure the KeeperHub organisation and wallet integration;
- confirm Base USDC support;
- connect to the remote MCP server;
- simulate one small transfer;
- execute one real transfer;
- save the hash;
- confirm the audit trail.

### Phase 2 — Foundation

- initialise strict TypeScript repository;
- configure environment validation;
- create Supabase database;
- add shared types;
- add logging and health checks;
- add Telegram webhook endpoint.

### Phase 3 — Sandbox bot

- `/start`;
- `/help`;
- `/pay`;
- address and amount validation;
- preview;
- simulated approval;
- simulated receipt.

### Phase 4 — Judge demo

- separate bot or workspace;
- allowlist;
- automatic approval;
- strict limits;
- real KeeperHub execution;
- transaction and audit links.

### Phase 5 — Community flow

- group workspace;
- roles;
- recipient aliases;
- policy checks;
- approval buttons.

### Phase 6 — Batch payout

- CSV upload;
- row validation;
- duplicate detection;
- total calculation;
- recipient-level execution;
- final batch summary.

### Phase 7 — Claim links

- `/send`;
- secure token generation;
- claim page;
- address submission;
- expiry;
- sender approval;
- execution.

### Phase 8 — Hardening

- duplicate approval tests;
- duplicate payout tests;
- invalid claim-token tests;
- expired-link tests;
- daily-limit bypass tests;
- concurrent request tests;
- secret redaction checks;
- environment isolation checks.

## 18. Security and trust requirements

- Keep KeeperHub credentials on the server only.
- Never expose private keys or API keys in Telegram or the browser.
- Do not store raw claim tokens.
- Use idempotency keys for execution.
- Separate sandbox and judge credentials.
- Keep the judge wallet isolated from future community wallets.
- Redact secrets from logs.
- Verify all callback authority server-side.
- Use integer base units for token amounts.
- Clearly label simulated and real execution.

## 19. Open validation items

These items require real environment verification before launch:

- KeeperHub MCP endpoint and authentication configuration;
- KeeperHub Base USDC support in the selected setup;
- exact execution-status and audit-trail response formats;
- safe retry classifications;
- deployment and webhook URLs;
- domain, trademark and social-handle availability for Solvo.

No credentials or connection strings are included in this document.

## 20. Final requirement

The MVP must prove one thing beyond doubt:

> **A natural-language payment instruction can become a real, policy-checked, KeeperHub-executed and auditable USDC transaction without the founder manually completing the last mile.**
