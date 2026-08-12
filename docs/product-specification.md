# Solvo — Product Specification

## 1. Product summary

Solvo is a Telegram-native USDC payment and payout agent powered by KeeperHub.

People already coordinate payments in Telegram:

```text
Send Alex 5 USDC.
Distribute this rewards list.
Can someone approve the payout?
```

Solvo handles what happens after the instruction. It validates the request, applies workspace permissions and spending limits, obtains approval when required, simulates the transfer, executes it through KeeperHub, tracks the result and returns transaction proof in Telegram.

## 2. Product truth

> **A conversational payment instruction becomes a validated, approved, reliable and auditable onchain transaction.**

The core execution path is:

```text
REQUEST
→ VALIDATE
→ APPROVE
→ SIMULATE
→ SUBMIT
→ CONFIRM
→ PROVE
```

Solvo is not primarily a wallet interface, a marketplace or a generic chatbot. It is the conversational control surface and reliability layer for payment execution.

## 3. Problem

Payment decisions are already made in chats, but execution remains manual and uncertain.

Users currently have to:

- copy wallet addresses;
- check recipient identity manually;
- calculate or re-enter amounts;
- open a wallet interface;
- understand network and gas conditions;
- request or track approval;
- monitor pending transactions;
- handle failed transfers;
- reconcile what happened afterward.

For community payouts, the burden compounds across every recipient.

## 4. Target users

### 4.1 Community treasurer

A treasury operator distributes rewards, reimbursements, grants or contributor payments.

**Needs:**

- validated recipient data;
- batch preview;
- duplicate detection;
- role-based approval;
- spending limits;
- recipient-level progress;
- final report and audit record.

**Success:**

```text
Upload CSV → validate → approve → execute → receive complete report
```

### 4.2 DAO or team member

A member requests a payment while an owner or approver controls treasury funds.

**Needs:**

- simple request creation;
- transparent approval state;
- clear status updates;
- no ability to approve restricted requests without authority.

### 4.3 Friend or individual

A person sends a small USDC payment without navigating a complex wallet interface.

**Needs:**

- direct address payment;
- secure claim links;
- recipient-controlled destination entry;
- sender confirmation before execution;
- receipt for both parties.

### 4.4 KeeperHub judge

A judge must be able to execute a real transaction without founder intervention.

**Needs:**

- dedicated restricted environment;
- automatic approval within strict caps;
- real Base USDC execution through KeeperHub;
- transaction hash;
- audit-trail link.

## 5. Product modes

### 5.1 Sandbox mode

Public users can test the product without real funds.

Requirements:

- no real KeeperHub wallet credentials;
- simulated payments only;
- validation and approval experience remains functional;
- CSV validation can be demonstrated;
- claim links can be demonstrated;
- every result clearly states:

```text
SIMULATION COMPLETE
NO FUNDS WERE MOVED
```

### 5.2 Judge Demo mode

A separate restricted environment exists for hackathon judging.

Requirements:

- separate bot or workspace;
- dedicated KeeperHub wallet;
- allowlisted Telegram accounts;
- automatic approval;
- maximum `0.10 USDC` per transaction;
- maximum `1 USDC` per day;
- Base USDC only for the MVP;
- no wallet credentials exposed to users;
- every transaction logged and visible;
- sandbox users cannot access the judge environment.

### 5.3 Personal Workspace mode

An individual uses a personal workspace and wallet policy.

The user can:

- pay a direct address;
- create a claim link;
- approve their own payment;
- configure small-payment auto-approval later.

### 5.4 Community Workspace mode

A community or DAO adds Solvo to a Telegram group.

Roles:

- **Owner:** manages workspace and policies;
- **Approver:** approves restricted payouts;
- **Member:** creates payment requests.

The person who creates a large community payout must not automatically be able to approve it.

## 6. Core commands

### `/start`

Explains Solvo and offers a path into sandbox or the configured workspace.

### `/help`

Lists available commands and explains simulation versus real execution.

### `/pay <address> <amount> USDC`

Creates a direct payment request to an explicit EVM address.

Example:

```text
/pay 0x742d... 5 USDC
```

### `/send <amount> USDC`

Creates a secure claim link.

The recipient enters the destination address in a browser page. Solvo shows the exact destination to the sender before approval.

### `/recipient add <alias> <address>`

Creates a workspace recipient alias after validating the address.

### `/recipient list`

Lists validated workspace aliases. Telegram usernames must never be treated as wallet identities.

### `/distribute`

Starts a community batch payout flow, including CSV upload and validation.

### `/status <payout_id>`

Returns the current payout state, item-level outcomes, transaction hashes and audit links where available.

## 7. Core user flows

### 7.1 Direct payment

1. User opens Solvo in Telegram.
2. User enters `/pay <address> <amount> USDC`.
3. Solvo validates the address, checksum, amount, token and chain.
4. Solvo checks workspace mode and remaining limits.
5. Solvo shows a payment preview.
6. Solvo applies approval policy.
7. Solvo simulates through KeeperHub.
8. If simulation succeeds, Solvo submits with an idempotency key.
9. Solvo polls execution status.
10. Solvo stores the execution ID and transaction hash.
11. Solvo posts the receipt and audit link to Telegram.

### 7.2 Claim-link payment

1. Sender enters `/send <amount> USDC`.
2. Solvo generates a cryptographically secure random claim token.
3. Solvo stores only the token hash.
4. Solvo returns a claim link.
5. Sender shares the link.
6. Recipient opens the browser claim page.
7. Recipient enters a wallet address.
8. Solvo validates the address.
9. Solvo shows the sender the exact destination.
10. Sender approves the final destination.
11. Solvo simulates and executes through KeeperHub.
12. Both parties receive status and receipt information.

Claim links must be single-use and expire after a fixed period.

### 7.3 Community payout

1. Admin adds Solvo to a Telegram group.
2. Group is registered as a workspace.
3. Member uploads a CSV.
4. Solvo validates headers, addresses, amounts and duplicates.
5. Solvo displays a complete preview.
6. Solvo calculates total value and remaining workspace limit.
7. An authorised approver confirms the payout.
8. Solvo creates individual payout items.
9. Each item is simulated and executed through KeeperHub.
10. Solvo reports successful, failed, pending and retried recipients.
11. Solvo posts a final batch summary and audit record.

### 7.4 Judge transaction

1. Judge opens the dedicated Solvo bot.
2. Judge submits a small payment.
3. Solvo checks the allowlist and strict limits.
4. Solvo automatically approves within policy.
5. KeeperHub simulates the transfer.
6. KeeperHub submits the real Base USDC transaction.
7. Solvo polls until completion.
8. Telegram displays the transaction hash and audit link.

## 8. Functional requirements

### 8.1 Validation

Solvo must:

- validate EVM address format and checksum;
- validate positive USDC amounts;
- reject zero and negative values;
- reject unsupported chains and tokens;
- validate CSV headers;
- validate every CSV row;
- detect duplicate recipients;
- calculate batch totals;
- enforce per-payment limits;
- enforce daily workspace limits.

### 8.2 Authorization

Solvo must:

- store Telegram numeric user IDs;
- separate owners, approvers and members;
- restrict judge access to allowlisted users;
- prevent unauthorised approval callbacks;
- prevent request creators from approving restricted community payouts;
- validate user ID, workspace, payout state and approval authority server-side;
- prevent duplicate callback execution.

### 8.3 Execution

Solvo must:

- persist payout state before and after external execution calls;
- simulate before broadcasting;
- stop when simulation fails;
- use an idempotency key;
- submit through KeeperHub MCP;
- poll execution status;
- store execution IDs;
- store transaction hashes;
- retry only safe transient failures;
- never automatically retry invalid transactions or failed simulations;
- create an audit event for every important transition.

### 8.4 Claim links

Claim links must:

- use cryptographically secure random tokens;
- store only token hashes;
- expire after a fixed period;
- be single-use;
- validate the claimed destination address;
- require sender approval before execution;
- never infer an address from a Telegram username.

### 8.5 Receipts and audit

Every real transaction should expose:

- request ID;
- requester;
- recipient address;
- amount;
- chain and token;
- approval actor or policy;
- simulation result;
- KeeperHub execution ID;
- transaction hash;
- timestamp;
- final status;
- audit-trail link.

## 9. State model

### Payout states

```text
draft
validated
pending_approval
approved
simulating
submitted
confirming
completed
```

### Failure states

```text
validation_failed
simulation_failed
execution_failed
retrying
cancelled
```

### State rules

- `draft` can become `validated` only after all required validation passes.
- `validated` can become `pending_approval` when policy requires approval.
- `validated` can become `approved` only through an allowed policy path.
- `approved` enters `simulating` before any real broadcast.
- `simulation_failed` must not transition automatically to submission.
- `submitted` must persist the KeeperHub execution ID.
- `confirming` must remain visible until a terminal state is returned.
- `completed` must have a transaction hash for real execution.
- `retrying` is allowed only for classified transient failures.

## 10. Product UX principles

### Make the irreversible moment explicit

Before approval, show:

```text
TO · AMOUNT · TOKEN · NETWORK · WHO APPROVES
```

### Make simulation unmistakable

Never show a simulated receipt using the same label as a real receipt.

### Make failure useful

Every failure should explain:

1. what failed;
2. whether funds moved;
3. whether retry is safe;
4. what the user should do next.

### Make proof the success state

The completed experience should prioritise the transaction hash and audit record, not decorative celebration.

### Preserve Telegram as the operating surface

The website is for discovery, claim links and future administration. The operational payment and payout workflow remains Telegram-first for the MVP.

## 11. Non-goals for the hackathon MVP

Do not make these submission blockers:

- multiple chains;
- multiple tokens;
- full payroll functionality;
- general-purpose wallet features;
- full admin dashboard;
- user-owned wallet connection system;
- x402 or MPP monetisation;
- complex multicall workflows;
- custom multisig contracts;
- sophisticated analytics.

## 12. Success metrics

### North Star metric

Successful USDC payout items executed through KeeperHub.

### Hackathon success criteria

- at least one real KeeperHub transaction;
- at least one judge completes a transaction without founder intervention;
- every real transaction returns a transaction hash;
- every real transaction has an audit record;
- sandbox users cannot access judge funds;
- unauthorised users cannot approve restricted payouts;
- CSV validation catches invalid and duplicate rows.

### Future metrics

- payout success rate;
- average time from request to completion;
- active workspaces;
- recipients paid;
- repeat payout rate;
- safe retry success rate;
- percentage of requests completed without manual intervention.

## 13. Business model direction

Potential future revenue:

- small fee per successful execution;
- community subscription for approval policies and audit history;
- higher limits for paid workspaces;
- API access for other agent platforms;
- paid workflow execution through future payment protocols.

For the hackathon, monetisation is secondary to proving reliable execution.

## 14. Product risks and mitigations

| Risk | Mitigation |
|---|---|
| KeeperHub integration fails | Prove one real transfer before building advanced features |
| Judge wallet is drained | Separate environment, allowlist, strict caps and auto-approval limits |
| Duplicate payment | Idempotency keys and database state checks |
| Wrong destination | Validate and display exact address before approval |
| CSV error | Validate every row before execution |
| Approval callback abuse | Verify user, workspace, payout state and authority server-side |
| Worker crash | Persist state before and after every KeeperHub call |
| Simulation confusion | Strongly label all simulation results |
| Scope expansion | Defer dashboard, multiple chains and advanced protocols |
| Credential exposure | Keep KeeperHub credentials server-side and redact secrets from logs |

## 15. Final product definition

Solvo is ready for the KeeperHub hackathon when a judge can execute a real, restricted Base USDC payment from Telegram and inspect the resulting proof without the founder being online.

The ideal sequence is:

```text
TELEGRAM INSTRUCTION
→ VALIDATION
→ POLICY CHECK
→ KEEPERHUB SIMULATION
→ REAL EXECUTION
→ TRANSACTION HASH
→ AUDIT TRAIL
```

That is the product. The dashboard, batch tools and claim experience extend it, but they must not obscure the core proof.
