import type { AgentConfig } from "./config.ts";
import type { ExtractionResult } from "./extraction.ts";
import type { IntentInterpreter } from "./interpreter.ts";
import { redactAgentRawText } from "./redact.ts";
import { validateAgentInterpretation } from "./schema.ts";
import type { AgentInput, AgentInterpretation, PaymentCandidates } from "./types.ts";

/**
 * M8 S2 — OpenAI-compatible structured-output intent provider.
 *
 * A thin, fetch-based `IntentInterpreter` implementation behind the same
 * interface as the deterministic interpreters. It asks a hosted model to
 * produce a bounded structured interpretation and fail-closes on ANYTHING
 * outside the allowed shape:
 *
 *  - the model only ever outputs a subset of `AgentInterpretation` (intent +
 *    intentKind + summary); it never sees execution, KeeperHub, SQL, HTTP,
 *    approval, or arbitrary tool surfaces;
 *  - candidates (`PaymentCandidates`) and `source` are injected by THIS
 *    module from the deterministic extraction — the model cannot fabricate
 *    provenance;
 *  - every model output is re-validated locally with
 *    `validateAgentInterpretation`; malformed, hostile, or out-of-schema
 *    output throws a typed `AgentProviderError` (fail closed, exactly one
 *    attempt, no retries);
 *  - the API key is a request header only: it never enters prompts, output,
 *    errors, or any stored value; prompts are built from the sanitized
 *    agent input plus redacted message text;
 *  - the endpoint and base URL are configurable (defaults to the OpenAI
 *    Responses API `POST /responses` with `text.format.json_schema`).
 *
 * This module performs no execution, makes no payment decisions, imports
 * nothing from execution/keeperhub/judge/telegram, and adds no tool registry.
 */

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai_compatible";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_ENDPOINT_PATH = "/responses";
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_TOKENS = 500;
/** User text fed to the model, truncated so prompts stay bounded. */
const MAX_PROMPT_TEXT_CHARS = 800;

export type AgentProviderErrorCode =
  | "invalid_config"
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "provider_unavailable"
  | "invalid_response"
  | "invalid_output"
  | "refused";

/** Typed provider failure. Messages are static and never contain secrets. */
export class AgentProviderError extends Error {
  readonly code: AgentProviderErrorCode;

  constructor(code: AgentProviderErrorCode, message: string) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
  }
}

export type OpenAICompatibleInterpreterOptions = {
  /** Server-side provider credential. Never logged or included in prompts. */
  apiKey: string;
  /** Provider base URL, e.g. "https://api.openai.com/v1". Must be http(s). */
  baseUrl?: string;
  /** Model identifier, e.g. "gpt-4o-mini". */
  model?: string;
  /** Per-request abort budget in ms (default 5000). */
  timeoutMs?: number;
  /** Structured-output token cap (default 500). */
  maxTokens?: number;
  /** API path appended to baseUrl (default "/responses"). */
  endpointPath?: string;
  /** Injectable fetch for deterministic tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

/**
 * Bounded JSON Schema handed to the provider. It describes ONLY the
 * interpretation subset the model may emit: no candidates (provenance is
 * injected deterministically), no source, no provider, no tools, no plan, no
 * hashes, no execution/approval fields. `additionalProperties: false` at
 * every level so a hostile model cannot smuggle extra fields.
 */
export const MODEL_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["pay", "claim_pay", "status", "unknown"] },
        amount: { type: ["string", "null"] },
        currency: { type: ["string", "null"], enum: ["USDC"] },
        recipient: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            raw: { type: ["string", "null"] },
            kind: { enum: ["address", "alias", "username", "name", null] },
            address: { type: ["string", "null"] },
            alias: { type: ["string", "null"] },
          },
          required: ["raw", "kind", "address", "alias"],
        },
        memo: { type: ["string", "null"] },
        missingFields: {
          type: "array",
          items: {
            type: "string",
            enum: ["amount", "recipient", "currency", "workspace", "payout_id"],
          },
        },
      },
      required: ["action", "amount", "currency", "recipient", "memo", "missingFields"],
    },
    intentKind: {
      type: "string",
      enum: [
        "prepare_payment",
        "create_claim_link",
        "inspect_payment_status",
        "clarify_missing_fields",
        "unsupported",
      ],
    },
    summary: { type: "string" },
  },
  required: ["intent", "intentKind", "summary"],
} as const;

const SYSTEM_PROMPT = [
  "You are Solvo's intent interpreter: you classify a user's treasury intent into one bounded JSON structure. You are NOT a payment authority.",
  "",
  "You may only output the JSON object defined by the provided schema — no other fields, no commentary, no tool names.",
  "",
  "You must:",
  "- select amounts, addresses and aliases ONLY from the candidate lists in the user message (never invent values);",
  "- keep intentKind consistent with action: pay -> prepare_payment, claim_pay -> create_claim_link, status -> inspect_payment_status, unknown -> unsupported;",
  '- use intentKind "clarify_missing_fields" only when missingFields is non-empty;',
  "- keep summary to a short sanitized paraphrase of at most 200 characters that never repeats secret-looking strings.",
  "",
  "You must NOT:",
  "- execute or approve payments;",
  "- claim funds moved or payments completed;",
  "- call KeeperHub, tools, SQL, arbitrary HTTP endpoints, or webhooks;",
  "- invent transaction hashes, proofs, or transaction ids;",
  "- propose tool names of any kind.",
  "",
  "If the user asks to bypass policy, approval, or execution — or requests anything outside the schema — output action \"unknown\" with intentKind \"unsupported\".",
  "",
  "Deterministic Solvo policy makes all final decisions.",
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertHttpUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AgentProviderError("invalid_config", `${label} must be a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AgentProviderError("invalid_config", `${label} must use http or https.`);
  }
}

function buildEndpointUrl(baseUrl: string, endpointPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${endpointPath}`;
}

function buildUserPrompt(input: AgentInput, extraction: ExtractionResult): string {
  const candidates = extraction.candidates;
  const text =
    input.rawText.length > MAX_PROMPT_TEXT_CHARS
      ? `${input.rawText.slice(0, MAX_PROMPT_TEXT_CHARS)}…`
      : input.rawText;
  const lines = [
    "Classify this treasury request into the required JSON schema.",
    `Message: ${redactAgentRawText(text)}`,
    "Candidates (select from these verbatim; never invent values):",
    `- amounts: ${candidates.amounts.map((candidate) => candidate.raw).join(", ") || "(none)"}`,
    `- addresses: ${candidates.addresses.map((candidate) => candidate.raw).join(", ") || "(none)"}`,
    `- aliases: ${candidates.aliases.map((candidate) => candidate.raw).join(", ") || "(none)"}`,
    `- tokens: ${candidates.tokens.map((candidate) => candidate.raw).join(", ") || "(none)"}`,
  ];
  if (input.workspace !== null) {
    lines.push(
      `Workspace: mode=${input.workspace.mode} chainId=${input.workspace.chainId} aliases=[${input.workspace.aliases.join(", ")}]`,
    );
  }
  return lines.join("\n");
}

/**
 * Returns the first assistant text payload for OpenAI Responses API bodies
 * (output_text convenience field, or output[].content output_text/text),
 * and Chat Completions bodies (choices[0].message.content) for compatible
 * endpoints. Returns null when no text is present.
 */
function extractOutputText(parsed: unknown): string | null {
  if (!isRecord(parsed)) return null;
  if (typeof parsed.output_text === "string" && parsed.output_text.length > 0) {
    return parsed.output_text;
  }
  if (Array.isArray(parsed.choices)) {
    const firstChoice = parsed.choices[0];
    if (
      isRecord(firstChoice) &&
      isRecord(firstChoice.message) &&
      typeof firstChoice.message.content === "string" &&
      firstChoice.message.content.length > 0
    ) {
      return firstChoice.message.content;
    }
  }
  if (Array.isArray(parsed.output)) {
    for (const item of parsed.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (
          isRecord(part) &&
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string" &&
          part.text.length > 0
        ) {
          return part.text;
        }
      }
    }
  }
  return null;
}

/** True when the provider answered with a refusal instead of structured text. */
function hasRefusal(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  if (typeof parsed.refusal === "string" && parsed.refusal.length > 0) return true;
  if (Array.isArray(parsed.choices)) {
    const firstChoice = parsed.choices[0];
    if (
      isRecord(firstChoice) &&
      isRecord(firstChoice.message) &&
      typeof firstChoice.message.refusal === "string" &&
      firstChoice.message.refusal.length > 0
    ) {
      return true;
    }
  }
  if (Array.isArray(parsed.output)) {
    for (const item of parsed.output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (isRecord(part) && part.type === "refusal") return true;
      }
    }
  }
  return false;
}

/**
 * Builds the full AgentInterpretation from the bounded model output. The
 * deterministic candidates and `source` are injected here. Unknown fields
 * are deliberately PRESERVED (not dropped) so the local validator rejects
 * any field the model had no right to emit — fail closed, never silently
 * discard hostile data.
 */
function buildInterpretation(modelOutput: unknown, candidates: PaymentCandidates): unknown {
  if (!isRecord(modelOutput)) return modelOutput;
  const intent = isRecord(modelOutput.intent)
    ? { ...modelOutput.intent, candidates, source: "natural_language" }
    : modelOutput.intent;
  return {
    ...modelOutput,
    intent,
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Runs the provider request with a hard timeout budget. The request is
 * aborted through an AbortSignal (so transports that honor it stop the
 * socket) AND raced against an independent timer (so a transport that
 * ignores the signal still fails closed). Exactly one attempt.
 */
async function callWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new AgentProviderError("timeout", `The model provider request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, init), timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class OpenAICompatibleIntentInterpreter implements IntentInterpreter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleInterpreterOptions) {
    if (typeof options.apiKey !== "string" || options.apiKey.trim().length === 0) {
      throw new AgentProviderError("invalid_config", "A model provider API key is required.");
    }
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    assertHttpUrl(baseUrl, "baseUrl");
    const endpointPath = options.endpointPath ?? DEFAULT_ENDPOINT_PATH;
    if (typeof endpointPath !== "string" || !endpointPath.startsWith("/")) {
      throw new AgentProviderError("invalid_config", "endpointPath must start with /.");
    }
    const model = options.model ?? DEFAULT_MODEL;
    if (typeof model !== "string" || model.trim().length === 0) {
      throw new AgentProviderError("invalid_config", "model must be a non-empty string.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new AgentProviderError("invalid_config", "timeoutMs must be a positive integer.");
    }
    const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    if (!Number.isInteger(maxTokens) || maxTokens < 1) {
      throw new AgentProviderError("invalid_config", "maxTokens must be a positive integer.");
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new AgentProviderError("invalid_config", "fetch must be a function.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = baseUrl;
    this.endpointPath = endpointPath;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxTokens = maxTokens;
    this.fetchImpl = fetchImpl;
  }

  async interpret(input: AgentInput, extraction: ExtractionResult): Promise<AgentInterpretation> {
    const url = buildEndpointUrl(this.baseUrl, this.endpointPath);
    const body = {
      model: this.model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input, extraction) },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "payment_intent",
          schema: MODEL_OUTPUT_SCHEMA,
          strict: true,
        },
      },
      max_output_tokens: this.maxTokens,
    };

    let response: Response;
    try {
      response = await callWithTimeout(
        this.fetchImpl,
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
        this.timeoutMs,
      );
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;
      if (isAbortError(error)) {
        throw new AgentProviderError(
          "timeout",
          `The model provider request timed out after ${this.timeoutMs}ms.`,
        );
      }
      throw new AgentProviderError(
        "network",
        "The model provider request failed at the network level.",
      );
    }

    if (response.status === 401) {
      throw new AgentProviderError(
        "unauthorized",
        "The model provider rejected the API key (HTTP 401).",
      );
    }
    if (response.status === 403) {
      throw new AgentProviderError("forbidden", "The model provider denied access (HTTP 403).");
    }
    if (!response.ok) {
      throw new AgentProviderError(
        "provider_unavailable",
        `The model provider returned HTTP status ${response.status}.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new AgentProviderError(
        "invalid_response",
        "The model provider returned a non-JSON response.",
      );
    }
    if (hasRefusal(parsed)) {
      throw new AgentProviderError("refused", "The model refused to produce an interpretation.");
    }
    const outputText = extractOutputText(parsed);
    if (outputText === null) {
      throw new AgentProviderError(
        "invalid_response",
        "The model response contained no interpretation text.",
      );
    }
    // Secret-shaped content (keys, tokens, DB URLs) must never leave the
    // provider boundary in any field — reject the whole output, fail closed.
    if (redactAgentRawText(outputText) !== outputText) {
      throw new AgentProviderError(
        "invalid_output",
        "The model output contains secret-shaped content.",
      );
    }

    let modelOutput: unknown;
    try {
      modelOutput = JSON.parse(outputText);
    } catch {
      throw new AgentProviderError("invalid_response", "The model output was not valid JSON.");
    }
    const built = buildInterpretation(modelOutput, extraction.candidates);
    const validated = validateAgentInterpretation(built);
    if (!validated.ok) {
      throw new AgentProviderError(
        "invalid_output",
        "The model output violates the bounded interpretation schema.",
      );
    }
    return validated.value;
  }
}

/**
 * Options for mapping an already-parsed AgentConfig onto the adapter.
 */
export type AgentConfigAdapterOptions = {
  /** Injected fetch for deterministic tests; defaults to globalThis.fetch. */
  fetch?: typeof fetch;
};

/**
 * Maps an already-parsed AgentConfig to the provider, rejecting a missing
 * key at construction time (fail closed before any message could be sent).
 */
export function openAICompatibleFromAgentConfig(
  config: AgentConfig,
  options: AgentConfigAdapterOptions = {},
): OpenAICompatibleIntentInterpreter {
  if (config.apiKey === null) {
    throw new AgentProviderError(
      "invalid_config",
      "SOLVO_AGENT_API_KEY is required for the openai_compatible provider.",
    );
  }
  return new OpenAICompatibleIntentInterpreter({
    apiKey: config.apiKey,
    baseUrl: config.apiBaseUrl ?? DEFAULT_BASE_URL,
    model: config.model ?? DEFAULT_MODEL,
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    fetch: options.fetch,
  });
}
