import type { AgentConfig } from "../config.ts";
import type { IntentInterpreter } from "../interpreter.ts";
import {
  AgentProviderError,
  openAICompatibleFromAgentConfig,
  type AgentConfigAdapterOptions,
} from "../openai-compatible-interpreter.ts";
import { StaticIntentInterpreter } from "../static-interpreter.ts";

/**
 * M8 S2 — Intent interpreter provider factory.
 *
 * The single deterministic selection point between the offline
 * `StaticIntentInterpreter` and the OpenAI-compatible structured-output
 * adapter, driven entirely by `AgentConfig`:
 *
 *  - provider "static" (the default) → `StaticIntentInterpreter`, no API key
 *    required, no network, no model — identical behavior to S1;
 *  - provider "openai_compatible" + `SOLVO_AGENT_API_KEY` → the fetch-based
 *    adapter with model/baseUrl/timeout/maxTokens carried from config;
 *  - provider "openai_compatible" without a key, an unknown provider, or any
 *    construction failure → typed `AgentProviderError` (fail closed at
 *    construction time, never mid-message).
 *
 * This module exposes nothing else: no KeeperHub, no execution service, no
 * approval or webhook functions, no tool registry, and no SQL/HTTP helpers.
 * The API key exists only inside the adapter (request header), never in
 * errors or diagnostics. Selecting an interpreter performs NO live call:
 * `fetch` is only attached to the adapter and invoked by the service.
 */
export type CreateIntentInterpreterOptions = AgentConfigAdapterOptions;

export function createIntentInterpreter(
  config: AgentConfig,
  options: CreateIntentInterpreterOptions = {},
): IntentInterpreter {
  switch (config.provider) {
    case "static":
      return new StaticIntentInterpreter();
    case "openai_compatible":
      return openAICompatibleFromAgentConfig(config, options);
    default: {
      // Unreachable for typed configs; defensive fail-closed for hostile or
      // mistyped config objects. The provider name is not a secret.
      const provider = (config as { provider: unknown }).provider;
      throw new AgentProviderError(
        "invalid_config",
        `Unknown agent provider "${String(provider)}".`,
      );
    }
  }
}
