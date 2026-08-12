/**
 * M8 — Agent configuration.
 *
 * Strict, typed parsing of the agent-layer env surface. Follows the
 * `getJudgeConfig` pattern: a pure function over an injectable env map,
 * typed errors, fail-closed parsing. The agent remains DISABLED by default;
 * nothing in this module calls a model, KeeperHub, or any network service.
 *
 * Provider note: S1 supports `static` only. `openai_compatible` is a
 * RESERVED provider name parsed for S2; no provider code exists yet, and a
 * provider factory must never treat it as callable in S1. Secrets
 * (SOLVO_AGENT_API_KEY) are never NEXT_PUBLIC and never appear in the
 * public summary.
 */

export type AgentProvider = "static" | "openai_compatible";

export type AgentLogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type AgentConfig = {
  /** Master switch. Default false: the agent layer is inert. */
  enabled: boolean;
  /** Bounded provider enum. "openai_compatible" reserved for S2. */
  provider: AgentProvider;
  /** Model call timeout budget in ms (500-15000). */
  timeoutMs: number;
  /** Maximum accepted raw input length in chars (100-5000). */
  maxInputChars: number;
  /** Per-user daily agent-run cap (1-1000). */
  maxDailyRunsPerUser: number;
  /** Per-user hourly agent-run cap (1-500). */
  maxHourlyRunsPerUser: number;
  logLevel: AgentLogLevel;
  /** Optional model name; stored for S2 only, never invoked in S1. */
  model: string | null;
  /** Optional provider base URL; stored for S2 only, never invoked in S1. */
  apiBaseUrl: string | null;
  /** Server-only credential. Never logged, never in summaries. */
  apiKey: string | null;
};

/** Redacted public diagnostics; intentionally excludes apiKey. */
export type AgentConfigSummary = {
  enabled: boolean;
  provider: AgentProvider;
  timeoutMs: number;
  maxInputChars: number;
  maxDailyRunsPerUser: number;
  maxHourlyRunsPerUser: number;
  logLevel: AgentLogLevel;
  model: string | null;
  apiBaseUrl: string | null;
};

export type AgentConfigErrorCode =
  | "invalid_boolean"
  | "invalid_provider"
  | "invalid_timeout"
  | "invalid_max_input_chars"
  | "invalid_daily_runs"
  | "invalid_hourly_runs"
  | "invalid_log_level"
  | "invalid_api_base_url";

export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;

  constructor(code: AgentConfigErrorCode, message: string) {
    super(message);
    this.name = "AgentConfigError";
    this.code = code;
  }
}

export type AgentEnv = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 3000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;
const DEFAULT_MAX_INPUT_CHARS = 1000;
const MIN_MAX_INPUT_CHARS = 100;
const MAX_MAX_INPUT_CHARS = 5000;
const DEFAULT_DAILY_RUNS = 25;
const MAX_DAILY_RUNS = 1000;
const DEFAULT_HOURLY_RUNS = 10;
const MAX_HOURLY_RUNS = 500;

const PROVIDERS: readonly AgentProvider[] = ["static", "openai_compatible"];
const LOG_LEVELS: readonly AgentLogLevel[] = ["silent", "error", "warn", "info", "debug"];

function parseBoolean(raw: string | undefined, envName: string): boolean {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AgentConfigError(
    "invalid_boolean",
    `Invalid ${envName} "${raw}": must be exactly true or false.`,
  );
}

function parseIntInRange(
  raw: string | undefined,
  envName: string,
  fallback: number,
  min: number,
  max: number,
  code: AgentConfigErrorCode,
): number {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const candidate = raw.trim();
  if (!/^\d+$/.test(candidate)) {
    throw new AgentConfigError(code, `Invalid ${envName} "${candidate}": must be a positive integer.`);
  }
  const value = Number(candidate);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AgentConfigError(
      code,
      `Invalid ${envName} "${candidate}": must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

function parseEnum<T extends string>(
  raw: string | undefined,
  envName: string,
  fallback: T,
  allowed: readonly T[],
  code: AgentConfigErrorCode,
): T {
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const candidate = raw.trim().toLowerCase() as T;
  if (!(allowed as readonly unknown[]).includes(candidate)) {
    throw new AgentConfigError(
      code,
      `Invalid ${envName} "${raw}": must be one of ${allowed.join(", ")}.`,
    );
  }
  return candidate;
}

function parseOptionalString(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return value;
}

export function getAgentConfig(env: AgentEnv = process.env): AgentConfig {
  const enabled = parseBoolean(env.SOLVO_AGENT_ENABLED, "SOLVO_AGENT_ENABLED");
  const provider = parseEnum<AgentProvider>(
    env.SOLVO_AGENT_PROVIDER,
    "SOLVO_AGENT_PROVIDER",
    "static",
    PROVIDERS,
    "invalid_provider",
  );
  const timeoutMs = parseIntInRange(
    env.SOLVO_AGENT_TIMEOUT_MS,
    "SOLVO_AGENT_TIMEOUT_MS",
    DEFAULT_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    "invalid_timeout",
  );
  const maxInputChars = parseIntInRange(
    env.SOLVO_AGENT_MAX_INPUT_CHARS,
    "SOLVO_AGENT_MAX_INPUT_CHARS",
    DEFAULT_MAX_INPUT_CHARS,
    MIN_MAX_INPUT_CHARS,
    MAX_MAX_INPUT_CHARS,
    "invalid_max_input_chars",
  );
  const maxDailyRunsPerUser = parseIntInRange(
    env.SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER,
    "SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER",
    DEFAULT_DAILY_RUNS,
    1,
    MAX_DAILY_RUNS,
    "invalid_daily_runs",
  );
  const maxHourlyRunsPerUser = parseIntInRange(
    env.SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER,
    "SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER",
    DEFAULT_HOURLY_RUNS,
    1,
    MAX_HOURLY_RUNS,
    "invalid_hourly_runs",
  );
  const logLevel = parseEnum<AgentLogLevel>(
    env.SOLVO_AGENT_LOG_LEVEL,
    "SOLVO_AGENT_LOG_LEVEL",
    "info",
    LOG_LEVELS,
    "invalid_log_level",
  );
  const model = parseOptionalString(env.SOLVO_AGENT_MODEL);
  const apiBaseUrl = parseOptionalString(env.SOLVO_AGENT_API_BASE_URL);
  if (apiBaseUrl !== null && !/^https?:\/\//.test(apiBaseUrl)) {
    throw new AgentConfigError(
      "invalid_api_base_url",
      `Invalid SOLVO_AGENT_API_BASE_URL "${apiBaseUrl}": must start with http:// or https://.`,
    );
  }
  const apiKey = parseOptionalString(env.SOLVO_AGENT_API_KEY);

  return {
    enabled,
    provider,
    timeoutMs,
    maxInputChars,
    maxDailyRunsPerUser,
    maxHourlyRunsPerUser,
    logLevel,
    model,
    apiBaseUrl,
    apiKey,
  };
}

/**
 * Redacted public diagnostics. The API key is structurally absent from the
 * returned object: callers cannot log it by accident.
 */
export function getAgentConfigSummary(config: AgentConfig): AgentConfigSummary {
  return {
    enabled: config.enabled,
    provider: config.provider,
    timeoutMs: config.timeoutMs,
    maxInputChars: config.maxInputChars,
    maxDailyRunsPerUser: config.maxDailyRunsPerUser,
    maxHourlyRunsPerUser: config.maxHourlyRunsPerUser,
    logLevel: config.logLevel,
    model: config.model,
    apiBaseUrl: config.apiBaseUrl,
  };
}
