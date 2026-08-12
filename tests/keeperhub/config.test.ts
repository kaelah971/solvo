import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getConfig,
  KeeperHubConfigError,
  KEEPERHUB_MCP_URL_DEFAULT,
  KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT,
  resetConfigCache,
} from "../../src/server/keeperhub/config.ts";

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(env)) {
    previous.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    resetConfigCache();
    fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetConfigCache();
  }
}

describe("getConfig", () => {
  it("loads a valid kh_ key with defaults", () => {
    withEnv(
      {
        KEEPERHUB_API_KEY: "kh_test_key_123",
        KEEPERHUB_MCP_URL: undefined,
        KEEPERHUB_USDC_TOKEN_ADDRESS: undefined,
      },
      () => {
        const config = getConfig();
        assert.equal(config.apiKey, "kh_test_key_123");
        assert.equal(config.mcpUrl, KEEPERHUB_MCP_URL_DEFAULT);
        assert.equal(config.usdcTokenAddress, KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT);
      },
    );
  });

  it("honours explicit overrides", () => {
    withEnv(
      {
        KEEPERHUB_API_KEY: "kh_test_key_123",
        KEEPERHUB_MCP_URL: "https://example.com/mcp",
        KEEPERHUB_USDC_TOKEN_ADDRESS: "0x0000000000000000000000000000000000000001",
      },
      () => {
        const config = getConfig();
        assert.equal(config.mcpUrl, "https://example.com/mcp");
        assert.equal(config.usdcTokenAddress, "0x0000000000000000000000000000000000000001");
      },
    );
  });

  it("reports a clear error when the key is missing", () => {
    withEnv({ KEEPERHUB_API_KEY: undefined }, () => {
      assert.throws(
        () => getConfig(),
        (error: unknown) =>
          error instanceof KeeperHubConfigError &&
          error.code === "no_key" &&
          error.message.includes("KEEPERHUB_API_KEY"),
      );
    });
  });

  it("rejects non-kh_ keys", () => {
    withEnv({ KEEPERHUB_API_KEY: "sk-123" }, () => {
      assert.throws(
        () => getConfig(),
        (error: unknown) =>
          error instanceof KeeperHubConfigError &&
          error.code === "invalid_key_format" &&
          error.message.includes("kh_"),
      );
    });
  });

  it("never exposes the key value in messages", () => {
    withEnv({ KEEPERHUB_API_KEY: "kh_SUPER_SECRET_VALUE_9f3k" }, () => {
      delete process.env.KEEPERHUB_API_KEY;
      resetConfigCache();
      try {
        getConfig();
        assert.fail("expected error");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes("SUPER_SECRET_VALUE_9f3k"), false);
      }
    });
  });
});
