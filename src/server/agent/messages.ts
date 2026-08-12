import type { AgentServiceResult } from "./service.ts";
import type { MissingFieldKey } from "./types.ts";

/**
 * M8 — Conversational reply builders.
 *
 * Pure formatting of already-produced AgentServiceResult outcomes into
 * user-facing Telegram copy. Copy follows the Solvo brand voice: a calm,
 * exacting treasury execution agent — state what happened, make risk visible
 * before approval, prefer precise verbs, never overclaim.
 *
 * Truthfulness rules baked into every builder:
 *  - prepared ≠ paid, claim created ≠ paid, status visible ≠ retryable;
 *  - nothing implies funds moved unless the result says so;
 *  - KeeperHub execution is only ever mentioned as a FUTURE step after
 *    approval, never as something already done;
 *  - no chain-of-thought, internal module names, raw JSON, secrets,
 *    transaction hashes, or execution ids (S1/S2 results never carry them);
 *  - failed/unsupported replies point at deterministic slash commands.
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
    "CONVERSATIONAL TREASURY MODE IS OFF",
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
      "I already prepared this payment request. It is waiting for approval by an owner or approver.",
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
  const header = "I NEED ONE MORE DETAIL";
  if (questions.length === 0) return `${header}\n\nWhat would you like Solvo to do?`;
  return [`${header}`, "", ...questions].join("\n");
}

function fieldQuestion(field: MissingFieldKey): string {
  switch (field) {
    case "amount":
      return "How much should I send? e.g. Send 20 USDC to daniel";
    case "recipient":
      return "Who should receive it? Send to a saved alias or a 0x wallet address. e.g. Send 20 USDC to daniel";
    case "currency":
      return "Which token? Solvo executes Base USDC.";
    case "workspace":
      return "This action needs a community workspace.";
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
  const lines = [
    "PAYMENT REQUEST PREPARED",
    "",
    `AMOUNT       ${baseUnitsToUsdc(prepared.amountBaseUnits)} USDC`,
    `RECIPIENT    ${recipientLabel}`,
    "STATUS       APPROVAL REQUIRED",
  ];
  if (prepared.memo !== null && prepared.memo.length > 0) {
    lines.push(`MEMO         ${prepared.memo}`);
  }
  lines.push(
    "",
    "No funds have moved.",
    "An owner or approver must approve before anything executes.",
    "KeeperHub execution happens only after approval.",
  );
  return { text: lines.join("\n"), buttons: prepared.buttons };
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
      "The recipient opens the link and enters a wallet address.",
      "No funds move after the wallet is entered alone:",
      "an owner or approver must approve the exact claimed destination",
      "before KeeperHub execution.",
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
    "STATUS FOUND",
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
    "I COULDN'T SAFELY PROCESS THAT",
    "",
    reason,
    "",
    "Examples you can use:",
    "  Send 0.01 USDC to 0x...",
    "  Pay blossom 0.01 USDC",
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
