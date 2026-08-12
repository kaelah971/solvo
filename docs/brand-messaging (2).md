# Solvo — Brand Messaging

## Brand identity

**Name:** Solvo  
**Pronunciation:** SOL-voh  
**Descriptor:** Conversational treasury execution  
**Primary tagline:** From instruction to execution.  
**Brand territory:** The Execution Receipt  
**Hackathon:** KeeperHub — The Last Mile

### Name rationale

Solvo is derived from the Latin *solvo / solvere*, associated with releasing, paying, settling and resolving.

That meaning fits the product better than a generic payment-assistant name. Solvo does not merely receive a payment request. It resolves the request into a controlled, completed and provable onchain outcome.

The root-language interpretation is strategic brand rationale, not legal clearance. Trademark, domain and handle availability remain separate checks.

## Executive diagnosis

Solvo is a Telegram-native USDC payment and payout agent powered by KeeperHub.

Its true product is not “a bot that sends money.” Its true product is the last-mile execution layer between:

```text
A HUMAN OR AGENT INSTRUCTION
→ VALIDATED PAYMENT INTENT
→ APPROVED TRANSACTION
→ KEEPERHUB EXECUTION
→ AUDITABLE PROOF
```

The market does not need another interface that merely makes a payment request feel conversational. It needs a system that reliably handles what happens after the instruction:

- addresses are checked;
- amounts are checked;
- roles and spending limits are applied;
- approvals are enforced;
- transactions are simulated;
- execution is monitored;
- retries are safe;
- failures are explicit;
- transaction hashes and audit records are returned.

## Strategic enemy

> **The uncertainty after someone says: “Send the money.”**

That uncertainty shows up as:

- copied addresses;
- mistyped amounts;
- unclear approval ownership;
- duplicate clicks;
- gas and execution anxiety;
- failed transfers with no explanation;
- no visibility into pending states;
- no record of what happened;
- a founder or treasurer having to stay online to finish the job.

## Core brand idea

> **A payment is not finished when it is requested. It is finished when it is proved.**

## Purpose

To make onchain value movement as accountable as the decisions that initiate it.

## Vision

A world where people and autonomous agents can coordinate value in natural language while reliable execution, policy and proof happen in the background.

## Mission

Solvo validates, governs, executes and documents payments initiated through conversation.

## Brand promise

> **Solvo turns a payment instruction into a completed, provable transaction.**

## Emotional payoff

The user should feel:

- calm rather than uncertain;
- in control rather than exposed;
- informed rather than forced to inspect infrastructure;
- confident that a decision became a real outcome;
- able to prove what happened afterward.

## Audience

### Primary audience: community treasurers

They distribute rewards, grants, reimbursements and contributor payments through Telegram and need to reduce manual treasury work without giving up control.

They need to believe:

- the product will catch bad data before money moves;
- only authorised people can approve restricted payouts;
- batch payouts will produce recipient-level results;
- failed transfers will not be silently retried or hidden;
- every real payment will leave a usable record.

### Secondary audience: DAO and team members

They request payouts in the conversation while an owner or approver controls funds.

They need to believe:

- requesting payment is simple;
- approval rules are visible;
- the requester cannot bypass treasury control;
- the status will remain visible after submission.

### Secondary audience: friends and individuals

They need to send small USDC payments without opening a complex wallet interface.

They need to believe:

- the recipient address will be shown before approval;
- a claim link cannot be reused or redirected;
- the sender and recipient will receive clear confirmation.

### Judge audience

The judge needs a fast, independent path to a real transaction.

They need to see:

```text
TELEGRAM REQUEST
→ VALIDATION
→ AUTO-APPROVAL
→ KEEPERHUB SIMULATION
→ REAL BASE USDC TRANSFER
→ TRANSACTION HASH
→ AUDIT TRAIL
```

## Category

### Recommended category

**Conversational treasury execution**

### Public explanation

> A Telegram-native agent that turns payment instructions into validated, approved and auditable USDC transfers through KeeperHub.

Do not lead with “wallet,” “AI finance,” “crypto bot” or “payout marketplace.” Those categories make the product sound less precise than it is.

## Positioning statement

> For communities, teams and individuals who coordinate payments in Telegram but need reliable execution afterward, Solvo is a conversational treasury execution agent that validates, approves, simulates, executes and proves USDC transfers through KeeperHub. Unlike a simple chat bot or wallet interface, Solvo owns the last mile from payment instruction to auditable onchain completion.

## One-line description

> Solvo turns Telegram payment instructions into safe, reliable, auditable USDC transactions.

## Short value proposition

> Send payments, request payouts and distribute rewards from Telegram. Solvo checks the details, applies the right approval policy, executes through KeeperHub and returns proof when the transaction is complete.

## Messaging house

### Roof: core message

> **From instruction to execution.**

### Pillar 1: Conversation is the control surface

**Message:** Payment decisions already happen in Telegram. Solvo lets the execution begin there too.

**Proof points:**

- `/pay` for direct address payments;
- `/send` for claim-link payments;
- `/distribute` for community payouts;
- inline approval actions;
- status and receipts returned to Telegram.

### Pillar 2: Policy before movement

**Message:** Solvo checks the payment before the payment can move.

**Proof points:**

- EVM address and checksum validation;
- amount validation;
- duplicate recipient detection;
- per-payment limits;
- daily workspace limits;
- owner, approver and member roles;
- server-side approval validation.

### Pillar 3: KeeperHub executes the last mile

**Message:** An approved instruction becomes a real onchain transaction through KeeperHub.

**Proof points:**

- KeeperHub MCP execution;
- simulation before submission;
- execution status polling;
- safe transient retry handling;
- execution IDs and transaction hashes;
- audit-trail links.

### Pillar 4: Proof is part of completion

**Message:** Solvo does not call a payment complete until there is evidence that it completed.

**Proof points:**

- explicit states;
- transaction hash receipts;
- recipient-level batch results;
- persisted audit events;
- clear distinction between simulation and real execution.

## Feature-to-value translations

| Feature | Functional result | Practical outcome | Emotional meaning |
|---|---|---|---|
| `/pay` | A payment starts inside Telegram | No context switching | “I can act where the decision happens.” |
| Address validation | Bad destinations are rejected early | Fewer expensive mistakes | “The system checks before I approve.” |
| Claim links | Recipients supply their own destination | The sender does not guess a wallet address | “The payment is specific to the right person.” |
| Approval policy | The right role controls release | Treasury authority remains intact | “Automation has boundaries.” |
| Simulation | The transfer is checked before broadcast | Failed execution is caught earlier | “I know what is about to happen.” |
| KeeperHub execution | An approved request becomes a real transaction | The agent finishes the task | “The decision became real.” |
| Status polling | Pending and failed states remain visible | No one has to guess | “I am not waiting in the dark.” |
| Audit receipt | The action is recorded | Teams can prove what happened | “The transfer is accountable.” |
| CSV validation | Batch data is checked before processing | Rewards and reimbursements scale safely | “Bulk work does not mean blind work.” |

## Message hierarchy by surface

### Landing page

**Headline:** From instruction to execution.

**Subhead:** Telegram payment coordination with KeeperHub-backed validation, execution and proof.

**Primary CTA:** Open Solvo in Telegram

**Secondary CTA:** See the execution path

**Proof strip:**

```text
VALIDATE · APPROVE · EXECUTE · PROVE
```

### Telegram start message

> Send a payment, request a payout or distribute rewards. Solvo checks the details, follows your workspace rules and returns proof when the transaction is done.

### Direct payment

> Send USDC from the conversation—not from a maze of wallet screens.

### Community payout

> Upload the list once. Solvo validates every row, routes approval to the right treasury role and reports the result recipient by recipient.

### Sandbox

> **Simulation complete. No funds were moved.**

### Real execution

> **Payment completed. View transaction proof.**

### Pending state

> **Execution is still confirming. Solvo will update this chat when the state changes.**

### Failure state

> **The transaction was not completed. No automatic retry was attempted because the failure requires review.**

### Batch approval

> **Payout ready for review.** 42 recipients. 850 USDC total. 41 valid rows. 1 duplicate detected. Approval required from Treasury Admin.

## Tagline system

### Primary tagline

> **From instruction to execution.**

This is the strongest line because it explains the product’s role and maps directly to the KeeperHub hackathon theme.

### Supporting lines

- The last mile for onchain payments.
- Make the payment happen.
- Request it in chat. Prove it onchain.
- Payments that finish the job.
- Coordinate in Telegram. Execute through KeeperHub.
- No payment is complete until it is proved.

Use one primary line at a time. Do not rotate through all of them on the same page.

## Verbal identity

### Voice

Solvo is a calm, exacting operator. It is concise when a user needs to act and explanatory when a user needs to understand risk.

### Principle 1: State what happened

**Meaning:** Never hide transaction state behind an upbeat phrase.

**Sounds like:** “Simulation complete. No funds were moved.”

**Does not sound like:** “Your payment is almost ready to shine.”

### Principle 2: Make risk visible before approval

**Meaning:** Show amount, destination, network, limits and approval requirement before asking someone to confirm.

**Sounds like:** “Approve 5 USDC to 0x742d…B91A on Base?”

**Does not sound like:** “Ready to send?”

### Principle 3: Prefer precise verbs

Use:

- validate;
- approve;
- simulate;
- submit;
- confirm;
- retry;
- cancel;
- complete;
- review.

Avoid:

- empower;
- unlock;
- revolutionise;
- supercharge;
- seamlessly;
- make magic;
- move money effortlessly.

### Principle 4: Be calm when things fail

**Meaning:** A failure message should reduce panic and explain the next safe action.

**Sounds like:** “The destination address failed checksum validation. Nothing was submitted. Correct the address and try again.”

**Does not sound like:** “Oops! Something went wrong.”

### Principle 5: Never overclaim

Do not say a payment is complete until the execution state supports it. Do not call a simulation a transaction. Do not claim KeeperHub handled an action unless the integration returned evidence.

## Vocabulary bank

### Use often

- instruction;
- request;
- recipient;
- destination;
- policy;
- approval;
- simulation;
- execution;
- confirmation;
- settlement;
- receipt;
- audit trail;
- completed;
- pending;
- review required;
- no funds moved.

### Use carefully

- agent;
- autonomous;
- treasury;
- wallet;
- retry;
- reliability;
- automation.

These terms need specific explanation in context.

### Avoid

- AI-powered payments;
- frictionless finance;
- the future of money;
- next-generation treasury;
- seamless automation;
- instant guaranteed payments;
- trustless magic;
- one-click wealth;
- crypto super app;
- all-in-one Web3 wallet.

## Product naming architecture

- **Solvo** — master brand.
- **Solvo Bot** — Telegram interface, only when a descriptor is necessary.
- **Solvo Workspace** — personal, judge or community operating environment.
- **Solvo Receipt** — completed transaction record.
- **Solvo Policy** — approval and spending rules.
- **Solvo Batch** — community distribution workflow.
- **Execution Line** — visual and product lifecycle from request to proof.

Do not turn every command or database table into a branded product.

## Hackathon narrative

### The change

Agents and communities can decide what value should move inside a chat, but the decision is not the outcome.

### The risk

Without a reliable execution layer, the last mile is where addresses, approvals, gas, failed transactions and proof break down.

### The promised land

A payment instruction enters a conversation and returns as a verified, auditable onchain result—without the operator manually babysitting every transfer.

### Solvo’s role

Solvo owns the last mile:

```text
REQUEST → CHECK → APPROVE → EXECUTE → PROVE
```

### Closing line

> Solvo does not just decide what should happen. It makes the payment happen—and proves it did.

## Messaging tests

Every major message should pass:

- Can a stranger understand what Solvo is within five seconds?
- Is the target user visible?
- Is the transaction outcome concrete?
- Is the claim supported by the actual KeeperHub flow?
- Does the copy distinguish simulation from real execution?
- Can a community treasurer repeat it accurately?
- Does it make the last mile more important than the chat interface?

## Final recommendation

Use **Solvo** consistently across the product, landing page, Telegram bot, architecture diagrams, demo script and repository documentation.

The brand should not present itself as a generic payment assistant. It should own one sharp idea:

> **Reliable execution after the decision.**
