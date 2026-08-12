import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import {
  AgentConfigError,
  getAgentConfig,
  getAgentConfigSummary,
  type AgentEnv,
} from "../../src/server/agent/config.ts";

function env(overrides: AgentEnv = {}): AgentEnv {
  return { ...overrides };
}

describe("agent configuration", () => {
  it("defaults to a disabled static config without any env", () => {
    const config = getAgentConfig(env());
    assert.equal(config.enabled, false);
    assert.equal(config.provider, "static");
    assert.equal(config.timeoutMs, 3000);
    assert.equal(config.maxInputChars, 1000);
    assert.equal(config.maxDailyRunsPerUser, 25);
    assert.equal(config.maxHourlyRunsPerUser, 10);
    assert.equal(config.logLevel, "info");
    assert.equal(config.model, null);
    assert.equal(config.apiBaseUrl, null);
    assert.equal(config.apiKey, null);
  });

  it("supports the static provider without any API key", () => {
    const config = getAgentConfig(env({ SOLVO_AGENT_ENABLED: "true", SOLVO_AGENT_PROVIDER: "static" }));
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "static");
    assert.equal(config.apiKey, null);
  });

  it("parses an enabled static config", () => {
    const config = getAgentConfig(
      env({
        SOLVO_AGENT_ENABLED: "true",
        SOLVO_AGENT_PROVIDER: "static",
        SOLVO_AGENT_TIMEOUT_MS: "5000",
        SOLVO_AGENT_MAX_INPUT_CHARS: "2000",
        SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "50",
        SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "20",
        SOLVO_AGENT_LOG_LEVEL: "debug",
      }),
    );
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "static");
    assert.equal(config.timeoutMs, 5000);
    assert.equal(config.maxInputChars, 2000);
    assert.equal(config.maxDailyRunsPerUser, 50);
    assert.equal(config.maxHourlyRunsPerUser, 20);
    assert.equal(config.logLevel, "debug");
  });

  it("rejects invalid booleans", () => {
    for (const value of ["yes", "1", "maybe", ""]) {
      assert.throws(
        () => getAgentConfig(env({ SOLVO_AGENT_ENABLED: value })),
        (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_boolean",
        `boolean ${value} must be rejected`,
      );
    }
  });

  it("accepts case-insensitive true/false values", () => {
    assert.equal(getAgentConfig(env({ SOLVO_AGENT_ENABLED: "TRUE" })).enabled, true);
    assert.equal(getAgentConfig(env({ SOLVO_AGENT_ENABLED: " False " })).enabled, false);
  });

  it("rejects an invalid provider", () => {
    for (const provider of ["gpt-4", "magic", "anthropic", "123"]) {
      assert.throws(
        () => getAgentConfig(env({ SOLVO_AGENT_PROVIDER: provider })),
        (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_provider",
        `provider ${provider} must be rejected`,
      );
    }
  });

  it("rejects a timeout below the safe minimum", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_TIMEOUT_MS: "499" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_timeout",
    );
  });

  it("rejects a timeout above the safe maximum", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_TIMEOUT_MS: "15001" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_timeout",
    );
  });

  it("rejects a non-integer timeout", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_TIMEOUT_MS: "abc" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_timeout",
    );
  });

  it("rejects max input chars below the safe minimum", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_MAX_INPUT_CHARS: "99" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_max_input_chars",
    );
  });

  it("rejects max input chars above the safe maximum", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_MAX_INPUT_CHARS: "5001" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_max_input_chars",
    );
  });

  it("rejects non-integer rate limits", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "25.5" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_daily_runs",
    );
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "10.5" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_hourly_runs",
    );
  });

  it("rejects zero and negative rate limits", () => {
    for (const value of ["0", "-1"]) {
      assert.throws(
        () => getAgentConfig(env({ SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: value })),
        (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_daily_runs",
        `daily ${value} must be rejected`,
      );
      assert.throws(
        () => getAgentConfig(env({ SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: value })),
        (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_hourly_runs",
        `hourly ${value} must be rejected`,
      );
    }
  });

  it("rejects an invalid log level", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_LOG_LEVEL: "verbose" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_log_level",
    );
  });

  it("stores optional model and base URL for later use without enabling model calls", () => {
    const config = getAgentConfig(
      env({
        SOLVO_AGENT_PROVIDER: "static",
        SOLVO_AGENT_MODEL: "gpt-4o-mini",
        SOLVO_AGENT_API_BASE_URL: "https://api.example.com/v1",
      }),
    );
    assert.equal(config.model, "gpt-4o-mini");
    assert.equal(config.apiBaseUrl, "https://api.example.com/v1");
    assert.equal(config.provider, "static");
  });

  it("rejects a non-http API base URL", () => {
    assert.throws(
      () => getAgentConfig(env({ SOLVO_AGENT_API_BASE_URL: "not-a-url" })),
      (error: unknown) => error instanceof AgentConfigError && error.code === "invalid_api_base_url",
    );
  });

  it("never includes the API key in the public summary", () => {
    const config = getAgentConfig(
      env({
        SOLVO_AGENT_ENABLED: "true",
        SOLVO_AGENT_PROVIDER: "openai_compatible",
        SOLVO_AGENT_API_KEY: "sk-secret-value",
      }),
    );
    assert.equal(config.apiKey, "sk-secret-value");
    const summary = getAgentConfigSummary(config);
    assert.deepEqual(Object.keys(summary).sort(), [
      "apiBaseUrl",
      "enabled",
      "logLevel",
      "maxDailyRunsPerUser",
      "maxHourlyRunsPerUser",
      "maxInputChars",
      "model",
      "provider",
      "timeoutMs",
    ]);
    assert.equal(JSON.stringify(summary).includes("sk-secret-value"), false);
  });

  it("does not require provider secrets when disabled", () => {
    const config = getAgentConfig(env({ SOLVO_AGENT_ENABLED: "false" }));
    assert.equal(config.enabled, false);
    assert.equal(config.apiKey, null);
  });

  it("is deterministic: the same env parses to a deep-equal config", () => {
    const input = env({
      SOLVO_AGENT_ENABLED: "true",
      SOLVO_AGENT_TIMEOUT_MS: "4000",
      SOLVO_AGENT_MAX_INPUT_CHARS: "1500",
    });
    assert.equal(JSON.stringify(getAgentConfig(input)), JSON.stringify(getAgentConfig(input)));
  });

  it("ignores NEXT_PUBLIC prefixed secrets", () => {
    const config = getAgentConfig(
      env({
        NEXT_PUBLIC_SOLVO_AGENT_API_KEY: "sk-public-secret",
        NEXT_PUBLIC_SOLVO_AGENT_ENABLED: "true",
      }),
    );
    assert.equal(config.apiKey, null);
    assert.equal(config.enabled, false);
  });

  it("does not reference any NEXT_PUBLIC_ env identifier in the config module", () => {
    const source = readFileSync("src/server/agent/config.ts", "utf8");
    assert.equal(/NEXT_PUBLIC_[A-Z_]+/.test(source), false);
  });

  it("raises typed, readable config errors", () => {
    try {
      getAgentConfig(env({ SOLVO_AGENT_PROVIDER: "bogus" }));
      assert.fail("expected an AgentConfigError");
    } catch (error) {
      assert.ok(error instanceof AgentConfigError);
      assert.equal(error.code, "invalid_provider");
      assert.match(error.message, /SOLVO_AGENT_PROVIDER/);
    }
  });
});
