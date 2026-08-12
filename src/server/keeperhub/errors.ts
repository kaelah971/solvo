export type SolvoErrorKind =
  | "config_missing"
  | "auth_invalid"
  | "wallet_not_configured"
  | "recipient_invalid"
  | "amount_invalid"
  | "cap_exceeded"
  | "insufficient_balance"
  | "unsupported_token_or_network"
  | "rejected_before_execution"
  | "execution_failed"
  | "status_lookup_failed"
  | "transport_timeout"
  | "unknown";

export type OutcomePhase = "rejected_before_execution" | "execution_failed" | "unknown";

export class SolvoError extends Error {
  readonly kind: SolvoErrorKind;
  readonly phase: OutcomePhase;
  readonly detail: string | null;

  constructor(kind: SolvoErrorKind, message: string, detail: string | null = null) {
    super(message);
    this.name = "SolvoError";
    this.kind = kind;
    this.phase = kindToPhase(kind);
    this.detail = detail;
  }
}

function kindToPhase(kind: SolvoErrorKind): OutcomePhase {
  switch (kind) {
    case "rejected_before_execution":
      return "rejected_before_execution";
    case "execution_failed":
      return "execution_failed";
    default:
      return "unknown";
  }
}

const TRANSPORT_MARKERS = [
  "fetch failed",
  "network error",
  "ECONNREFUSED",
  "ENOTFOUND",
  "socket hang up",
  "UND_ERR_CONNECT_TIMEOUT",
  "aborted",
  "timeout",
];

const AUTH_MARKERS = ["401", "invalid_token", "invalid or missing api key", "unauthorized"];

const INPUT_VALIDATION_MARKERS = ["-32602", "invalid arguments for tool", "invalid input: expected"];

export function classifyToolFailure(raw: unknown, context: string | null = null): SolvoError {
  const message = typeof raw === "string" ? raw : String(raw ?? "Unknown failure");
  const text = message.toLowerCase();

  if (INPUT_VALIDATION_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) {
    return new SolvoError(
      "rejected_before_execution",
      "KeeperHub rejected the tool call arguments (MCP input validation error). The adapter request shape does not match the live tool schema — inspect the tool's current input schema.",
      message,
    );
  }
  if (TRANSPORT_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) {
    return new SolvoError(
      "transport_timeout",
      "Transport or timeout failure while talking to KeeperHub. The outcome is unknown — inspect before retrying.",
      message,
    );
  }
  if (AUTH_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) {
    return new SolvoError(
      "auth_invalid",
      "KeeperHub rejected the API key. Check KEEPERHUB_API_KEY and that the key is valid and not revoked.",
      message,
    );
  }
  if (text.includes("wallet") && (text.includes("not configured") || text.includes("missing"))) {
    return new SolvoError(
      "wallet_not_configured",
      "KeeperHub reports the organization wallet integration is not configured. Set one up at app.keeperhub.com before any write.",
      message,
    );
  }
  if (text.includes("insufficient_balance") || text.includes("insufficient balance") || text.includes("fund 0x")) {
    return new SolvoError(
      "insufficient_balance",
      "The organization wallet has insufficient funds for this transfer.",
      message,
    );
  }
  if (text.includes("unsupported") || text.includes("not supported")) {
    return new SolvoError(
      "unsupported_token_or_network",
      "KeeperHub reports an unsupported token or network configuration.",
      message,
    );
  }
  if (text.includes("daily spending cap")) {
    return new SolvoError(
      "rejected_before_execution",
      "KeeperHub rejected the request: the organization daily spending cap is exceeded. Nothing was broadcast.",
      message,
    );
  }
  if (context === "status") {
    return new SolvoError(
      "status_lookup_failed",
      "The execution status could not be retrieved. Inspect the execution in KeeperHub before deciding what to do.",
      message,
    );
  }
  if (text.includes("404") || text.includes("not found")) {
    return new SolvoError(
      "status_lookup_failed",
      "KeeperHub could not find the requested resource.",
      message,
    );
  }
  return new SolvoError(
    "rejected_before_execution",
    "KeeperHub rejected the request before execution.",
    message,
  );
}

export function classifyExecutionStatus(
  status: string,
): "completed" | "failed" | "pending" | "running" | "unknown" {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}
