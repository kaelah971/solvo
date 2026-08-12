import type { AgentServiceResult } from "./service.ts";
import type { MissingFieldKey } from "./types.ts";

/**
 * M8 — Conversational reply builders.
 *
 * Pure formatting of already-produced AgentServiceResult outcomes into safe
 * Telegram-style copy (ALL-CAPS headers + framed lines, matching
 * `community-messages.ts` conventions). Never performs I/O, never touches
 * the repository, and can only reference data the result explicitly carries.
 *
 * Safety rules baked into every builder:
 *  - no chain-of-thought, tool names, interpreter internals, or raw JSON;
 *  - no secrets, API keys, bot tokens, DB URLs, or private keys;
 *  - no transaction hashes or execution ids (S1 results never carry them);
 *  - prepared ≠ paid, claim created ≠ paid, status visible ≠ retryable;
 *  - nothing ever implies funds moved unless the result says so.
 */

export type AgentFormattedReply = {
  text: string;
  /** Inline keyboard metadata when the result carries safe buttons. */
  buttons?: Array<{ text: string; callbackData: string }>;
  /** Optional parse mode; Solvo replies are plain text by default. */
  parseMode?: "HTML";
};

export function formatAgentServiceResult(result: AgentServiceResult): AgentFormattedReply {
  switch (result.outcome) {
    case "disabled":
      return { text: disabledMessage() };
    case "rate_limited":
      return { text: rateLimitedMessage() };
    case "duplicate":
      return { text: duplicateMessage(result.payoutId !== null, result.claimId !== null) };
    case "needs_clarification":
      return { text: clarificationMessage(result.missingFields) };
    case "prepared_payment":
      return preparedPaymentMessage(result);
    case "claim_link_created":
      return claimLinkMessage(result);
    case "status_visible":
      return statusVisibleMessage(result);
    case "status_not_found":
      return { text: "I couldn't find a payment you can access with that ID." };
    case "blocked":
      return { text: `BLOCKED\n\n${result.reason}` };
    case "unsupported":
      return { text: unsupportedMessage(result.reason) };
    case "failed":
      return { text: failedMessage() };
  }
}

function disabledMessage(): string {
  return [
    "NATURAL-LANGUAGE TREASURY MODE IS OFF",
    "",
    "Solvo's conversational payment mode is currently disabled.",
    "Use /pay, /claimpay, /batch and /status as usual.",
  ].join("\n");
}

function rateLimitedMessage(): string {
  return [
    "AGENT USAGE LIMIT",
    "",
    "You have reached the temporary limit for conversational requests.",
    "Please try again later. Slash commands are unaffected.",
  ].join("\n");
}

function duplicateMessage(hasPayout: boolean, hasClaim: boolean): string {
  if (hasPayout) {
    return [
      "ALREADY PREPARED",
      "",
      "I already prepared this payment request and it is waiting for approval.",
    ].join("\n");
  }
  if (hasClaim) {
    return [
      "ALREADY CREATED",
      "",
      "I already created this claim link. The secure one-time link cannot be shown again for safety.",
    ].join("\n");
  }
  return "ALREADY PROCESSED\n\nI already processed this request.";
}

function clarificationMessage(missingFields: MissingFieldKey[]): string {
  const questions = missingFields.map(fieldQuestion);
  const header = "I NEED MORE INFORMATION";
  if (questions.length === 0) return `${header}\n\nWhat would you like Solvo to do?`;
  return [`${header}`, "", ...questions].join("\n");
}

function fieldQuestion(field: MissingFieldKey): string {
  switch (field) {
    case "amount":
      return "How much should I send? e.g. Send Daniel 20 USDC";
    case "recipient":
      return "Who should receive it? e.g. Send 20 USDC to daniel";
    case "currency":
      return "Which token? Solvo executes Base USDC.";
    case "workspace":
      return "This conversation is not linked to a Solvo workspace yet.";
    case "payout_id":
      return "Which payment should I check? e.g. Check status <payment-id>";
  }
}

function preparedPaymentMessage(result: Extract<AgentServiceResult, { outcome: "prepared_payment" }>): AgentFormattedReply {
  const prepared = result.prepared;
  const recipientLabel =
    prepared.recipientAlias !== null
      ? `${prepared.recipientAlias} (${prepared.recipientAddress})`
      : prepared.recipientAddress;
  const text = [
    "PAYMENT REQUEST PREPARED",
    "",
    `AMOUNT       ${baseUnitsToUsdc(prepared.amountBaseUnits)} USDC`,
    `RECIPIENT    ${recipientLabel}`,
    "STATUS       PENDING APPROVAL",
    "",
    "No funds have moved.",
    "An owner or approver must approve before anything executes.",
  ].join("\n");
  return { text, buttons: prepared.buttons };
}

function claimLinkMessage(result: Extract<AgentServiceResult, { outcome: "claim_link_created" }>): AgentFormattedReply {
  const claim = result.claim;
  const lines = [
    claim.claimUrl !== null ? "CLAIM LINK CREATED" : "CLAIM LINK ALREADY CREATED",
    "",
    `AMOUNT       ${baseUnitsToUsdc(claim.amountBaseUnits)} USDC`,
    `EXPIRES      ${claim.expiresAt}`,
    "",
  ];
  if (claim.claimUrl !== null) {
    lines.push(
      "The recipient opens the link and submits a wallet address.",
      "No funds move until an owner or approver approves the exact destination.",
      "",
      claim.claimUrl,
    );
  } else {
    lines.push("The secure one-time claim link cannot be shown again for safety.");
  }
  return { text: lines.join("\n") };
}

function statusVisibleMessage(result: Extract<AgentServiceResult, { outcome: "status_visible" }>): AgentFormattedReply {
  const status = result.status;
  const lines = [
    "PAYMENT STATUS",
    "",
    `ID           ${status.payoutId}`,
    `STATE        ${status.state}`,
    `ITEMS        ${status.itemCount}`,
  ];
  if (status.completedAt !== null) {
    lines.push(`COMPLETED    ${status.completedAt}`);
  }
  return { text: lines.join("\n") };
}

function unsupportedMessage(reason: string): string {
  return [
    "I COULDN'T SAFELY TURN THAT INTO A TREASURY ACTION",
    "",
    reason,
    "",
    "Examples you can use:",
    "  Send 0.01 USDC to 0x...",
    "  Create a claim link for 0.05 USDC",
    "  Check status <payment-id>",
  ].join("\n");
}

function failedMessage(): string {
  return [
    "SORRY",
    "",
    "I could not safely process that request. Nothing moved and no funds left the workspace.",
    "",
    "Use the command forms instead:",
    "  /pay <address> <amount> USDC",
    "  /claimpay <amount> USDC",
    "  /status <payment-id>",
  ].join("\n");
}

/** Integer base units → USDC decimal string for display. */
function baseUnitsToUsdc(value: string): string {
  const v = BigInt(value);
  const whole = v / 1000000n;
  const fraction = (v % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}
