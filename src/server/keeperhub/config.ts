import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const KEEPERHUB_MCP_URL_DEFAULT = "https://app.keeperhub.com/mcp";
export const KEEPERHUB_CHAIN_ID = "8453";
export const KEEPERHUB_CHAIN_NAME = "Base";
export const KEEPERHUB_USDC_SYMBOL = "USDC";
export const KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type KeeperHubConfig = {
  apiKey: string;
  mcpUrl: string;
  usdcTokenAddress: string;
};

export type ConfigErrorCode = "no_key" | "invalid_key_format" | "no_env_file";

export class KeeperHubConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = "KeeperHubConfigError";
    this.code = code;
  }
}

function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const name = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (process.env[name] === undefined) {
        process.env[name] = value;
      }
    }
  } catch {
    if (process.env.KEEPERHUB_API_KEY === undefined) {
      throw new KeeperHubConfigError(
        "no_env_file",
        "No .env file found and KEEPERHUB_API_KEY is not set in the environment.",
      );
    }
  }
}

function loadConfigFromEnv(): KeeperHubConfig {
  const apiKey = process.env.KEEPERHUB_API_KEY ?? "";
  if (apiKey.trim().length === 0) {
    throw new KeeperHubConfigError(
      "no_key",
      "KEEPERHUB_API_KEY is missing. Copy .env.example to .env and set KEEPERHUB_API_KEY to a KeeperHub organization API key (kh_ prefix, created at app.keeperhub.com under Settings > API Keys > Organisation).",
    );
  }
  if (!apiKey.startsWith("kh_")) {
    throw new KeeperHubConfigError(
      "invalid_key_format",
      "KEEPERHUB_API_KEY must be a KeeperHub organization API key starting with 'kh_'. It is not a wallet private key or OAuth token.",
    );
  }
  return {
    apiKey,
    mcpUrl: process.env.KEEPERHUB_MCP_URL ?? KEEPERHUB_MCP_URL_DEFAULT,
    usdcTokenAddress:
      process.env.KEEPERHUB_USDC_TOKEN_ADDRESS ?? KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT,
  };
}

let cached: KeeperHubConfig | null = null;

export function getConfig(): KeeperHubConfig {
  if (cached) return cached;
  cached = loadConfigFromEnv();
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}

export function loadEnvForScript(): void {
  loadEnvFile();
}
