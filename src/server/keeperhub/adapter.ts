import {
  KEEPERHUB_CHAIN_ID,
  KEEPERHUB_CHAIN_NAME,
  KEEPERHUB_USDC_SYMBOL,
} from "./config.ts";
import { classifyExecutionStatus, classifyToolFailure, SolvoError } from "./errors.ts";
import { KeeperHubMcpClient } from "./mcp-client.ts";
import type {
  DoctorReport,
  SolvoDirectExecutionStatus,
  SolvoExecutionStatus,
  SolvoSimulationResult,
  SolvoTransferRequest,
  ToolDescriptor,
  WalletIntegration,
} from "./types.ts";

type ExecuteTransferArgs = {
  chainId: string;
  toAddress: string;
  amount: string;
  tokenAddress: string;
  idempotencyKey: string;
  simulate?: boolean;
  integrationId?: string;
};

type StatusResult = Record<string, unknown> & {
  executionId?: unknown;
  status?: unknown;
  type?: unknown;
  transactionHash?: unknown;
  transactionLink?: unknown;
  sponsored?: unknown;
  receipts?: unknown;
  gasUsedWei?: unknown;
  error?: unknown;
  createdAt?: unknown;
  completedAt?: unknown;
};

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function parseToolJsonAny(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parseToolJson(text: string): Record<string, unknown> | null {
  const parsed = parseToolJsonAny(text);
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

function parseToolArray(text: string): Array<Record<string, unknown>> | null {
  const parsed = parseToolJsonAny(text);
  if (Array.isArray(parsed)) {
    return parsed as Array<Record<string, unknown>>;
  }
  return null;
}

function extractMessage(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw instanceof Error) return raw.message;
  return String(raw);
}

export function normalizeStatus(status: unknown): SolvoExecutionStatus {
  if (typeof status !== "string") return "unknown";
  return classifyExecutionStatus(status);
}

export function normalizeSimulationResult(raw: Record<string, unknown>): SolvoSimulationResult {
  return {
    success: raw.success === true,
    wouldRevert: raw.wouldRevert === true,
    from: asString(raw.from),
    to: asString(raw.to),
    value: asString(raw.value),
    gasEstimate: asString(raw.gasEstimate),
    revertReason: asString(raw.revertReason),
    code: asString(raw.code),
    balanceWei: asString(raw.balanceWei),
    requiredWei: asString(raw.requiredWei),
    shortfallWei: asString(raw.shortfallWei),
    error: asString(raw.error),
  };
}

export function normalizeExecutionStatus(raw: StatusResult): SolvoDirectExecutionStatus {
  let receipts: SolvoDirectExecutionStatus["receipts"] = [];
  if (Array.isArray(raw.receipts)) {
    receipts = raw.receipts.map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        hash: asString(e.hash) ?? "",
        chainId: typeof e.chainId === "number" ? e.chainId : Number(asString(e.chainId) ?? 0),
        verified: e.verified === true,
        receiptStatus: asString(e.receiptStatus) ?? "unknown",
        blockNumber: typeof e.blockNumber === "number" ? e.blockNumber : null,
        gasUsed: asString(e.gasUsed),
      };
    });
  }
  return {
    executionId: asString(raw.executionId) ?? "",
    status: normalizeStatus(raw.status),
    type: asString(raw.type),
    transactionHash: asString(raw.transactionHash),
    transactionLink: asString(raw.transactionLink),
    sponsored: typeof raw.sponsored === "boolean" ? raw.sponsored : null,
    receipts,
    gasUsedWei: asString(raw.gasUsedWei),
    error: asString(raw.error),
    createdAt: asString(raw.createdAt),
    completedAt: asString(raw.completedAt),
  };
}

export function normalizeWalletIntegration(raw: Record<string, unknown>): WalletIntegration {
  const configured = raw.configured === true || asString(raw.id) !== null;
  const chainIdsRaw = raw.chainIds ?? raw.networks;
  const chainIds = Array.isArray(chainIdsRaw)
    ? chainIdsRaw.map((id) => asString(id) ?? String(id))
    : [];
  return {
    configured,
    id: asString(raw.id),
    name: asString(raw.name),
    type: asString(raw.type),
    address: asString(raw.address) ?? asString(raw.walletAddress),
    chainIds,
    raw,
  };
}

/**
 * Maps our documented arguments onto the schema the MCP server actually
 * advertises. KeeperHub's tool parameter names are discovered at runtime
 * rather than assumed.
 */
export function resolveTransferArgs(
  schema: Record<string, unknown>,
  args: ExecuteTransferArgs,
): Record<string, unknown> {
  const properties = (schema.properties ?? {}) as Record<string, unknown>;
  const candidates: { [K in keyof ExecuteTransferArgs]-?: string[] } = {
    chainId: ["chain_id", "chainId", "network"],
    toAddress: ["to_address", "recipientAddress", "recipient_address"],
    amount: ["amount"],
    tokenAddress: ["token_address", "tokenAddress"],
    simulate: ["simulate"],
    idempotencyKey: ["idempotency_key", "idempotencyKey"],
    integrationId: ["integration_id", "integrationId"],
  };
  const pick = (logical: keyof ExecuteTransferArgs): [string, unknown] | null => {
    const value = args[logical];
    if (value === undefined) return null;
    for (const candidate of candidates[logical]) {
      if (Object.prototype.hasOwnProperty.call(properties, candidate)) {
        return [candidate, value];
      }
    }
    return null;
  };

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(candidates) as Array<keyof ExecuteTransferArgs>) {
    const picked = pick(key);
    if (picked) result[picked[0]] = picked[1];
  }
  return result;
}

function toTransferArgs(
  request: Omit<SolvoTransferRequest, "idempotencyKey"> & { idempotencyKey?: string },
): ExecuteTransferArgs {
  return {
    chainId: request.chainId,
    toAddress: request.recipientAddress,
    amount: request.amount,
    tokenAddress: request.tokenAddress,
    idempotencyKey: request.idempotencyKey ?? "",
    integrationId: request.integrationId,
  };
}

export class KeeperHubAdapter {
  private readonly client: KeeperHubMcpClient;
  private tools: ToolDescriptor[] | null = null;

  constructor(client: KeeperHubMcpClient) {
    this.client = client;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async listTools(): Promise<ToolDescriptor[]> {
    if (!this.tools) {
      this.tools = await this.client.listTools();
    }
    return this.tools;
  }

  private async findTool(name: string): Promise<ToolDescriptor | null> {
    const tools = await this.listTools();
    return tools.find((tool) => tool.name === name) ?? null;
  }

  private async toolSchema(name: string): Promise<Record<string, unknown>> {
    const tool = await this.findTool(name);
    if (!tool) {
      throw new SolvoError(
        "unsupported_token_or_network",
        `KeeperHub MCP did not expose the expected tool '${name}'. Run the doctor to see the available tools.`,
      );
    }
    return tool.inputSchema;
  }

  async getWalletIntegration(): Promise<WalletIntegration> {
    await this.toolSchema("list_integrations");
    const listResult = await this.client.callTool("list_integrations", {});
    if (listResult.isError) {
      throw classifyToolFailure(listResult.text);
    }
    const listArray = parseToolArray(listResult.text);
    const listObject = parseToolJson(listResult.text);
    const integrations = listArray
      ? listArray
      : listObject && Array.isArray(listObject.integrations)
        ? (listObject.integrations as Array<Record<string, unknown>>)
        : null;
    if (!integrations) {
      throw new SolvoError(
        "unknown",
        "list_integrations returned an unexpected shape.",
        listResult.text,
      );
    }

    const wallet = integrations.find((entry) => {
      const type = asString(entry.type)?.toLowerCase() ?? "";
      return type === "web3" || type.includes("wallet");
    });
    const walletId = wallet ? asString(wallet.id) : null;
    if (!walletId) {
      return {
        configured: false,
        id: null,
        name: null,
        type: null,
        address: null,
        chainIds: [],
        raw: integrations,
      };
    }

    const schema = await this.toolSchema("get_wallet_integration");
    const idField = Object.keys(schema.properties ?? {}).find((key) =>
      key.toLowerCase().includes("integration"),
    );
    const args = idField ? { [idField]: walletId } : { integrationId: walletId };
    const { text, isError } = await this.client.callTool("get_wallet_integration", args);
    if (isError) {
      throw classifyToolFailure(text);
    }
    const json = parseToolJson(text);
    if (!json) {
      throw new SolvoError(
        "unknown",
        "get_wallet_integration returned an unparseable result.",
        text,
      );
    }
    return normalizeWalletIntegration(json);
  }

  async listChains(): Promise<Array<{ chainId: string; name: string | null; status: string | null }>> {
    const schema = await this.toolSchema("list_action_schemas");
    const props = schema.properties ?? {};
    const args = Object.prototype.hasOwnProperty.call(props, "includeChains")
      ? { includeChains: true }
      : {};
    const { text, isError } = await this.client.callTool("list_action_schemas", args);
    if (isError) {
      throw classifyToolFailure(text, "status");
    }
    const json = parseToolJson(text);
    if (json && Array.isArray(json.chains)) {
      return json.chains.map((entry) => {
        const chain = (entry ?? {}) as Record<string, unknown>;
        const chainId =
          typeof chain.chainId === "number" ? String(chain.chainId) : asString(chain.chainId) ?? "";
        return { chainId, name: asString(chain.name), status: asString(chain.status) };
      });
    }
    throw new SolvoError(
      "unknown",
      "list_action_schemas did not include a chains array.",
      text,
    );
  }

  async chainStatus(chainId: string): Promise<{ found: boolean; status: string | null }> {
    try {
      const chains = await this.listChains();
      const match = chains.find((chain) => chain.chainId === chainId);
      return match ? { found: true, status: match.status } : { found: false, status: null };
    } catch {
      return { found: false, status: null };
    }
  }

  async simulateTransfer(request: Omit<SolvoTransferRequest, "idempotencyKey">): Promise<SolvoSimulationResult> {
    const schema = await this.toolSchema("execute_transfer");
    const args = resolveTransferArgs(schema, {
      ...toTransferArgs(request),
      simulate: true,
    });
    const { text, isError } = await this.client.callTool("execute_transfer", args);
    if (isError) {
      const json = parseToolJson(text);
      if (json && json.wouldRevert === true) {
        return normalizeSimulationResult(json);
      }
      throw classifyToolFailure(text);
    }
    const json = parseToolJson(text);
    if (!json) {
      throw new SolvoError(
        "unknown",
        "execute_transfer (simulate) returned an unparseable result.",
        text,
      );
    }
    return normalizeSimulationResult(json);
  }

  async executeTransfer(request: SolvoTransferRequest): Promise<SolvoDirectExecutionStatus> {
    const schema = await this.toolSchema("execute_transfer");
    const args = resolveTransferArgs(schema, toTransferArgs(request));
    const { text, isError } = await this.client.callTool("execute_transfer", args);
    if (isError) {
      const json = parseToolJson(text);
      if (json && (json.executionId || json.status === "failed")) {
        return normalizeExecutionStatus(json as StatusResult);
      }
      throw classifyToolFailure(text);
    }
    const json = parseToolJson(text);
    if (!json) {
      throw new SolvoError("unknown", "execute_transfer returned an unparseable result.", text);
    }
    return normalizeExecutionStatus(json as StatusResult);
  }

  async getDirectExecutionStatus(executionId: string): Promise<SolvoDirectExecutionStatus> {
    const schema = await this.toolSchema("get_direct_execution_status");
    const executionIdField = Object.keys(schema.properties ?? {}).find((key) =>
      key.toLowerCase().includes("execution"),
    );
    const args = executionIdField
      ? { [executionIdField]: executionId }
      : { execution_id: executionId };
    const { text, isError } = await this.client.callTool("get_direct_execution_status", args);
    if (isError) {
      throw classifyToolFailure(text, "status");
    }
    const json = parseToolJson(text);
    if (!json) {
      throw new SolvoError(
        "status_lookup_failed",
        "get_direct_execution_status returned an unparseable result.",
        text,
      );
    }
    return normalizeExecutionStatus(json as StatusResult);
  }

  async pollUntilTerminal(
    executionId: string,
    options: { maxPolls?: number; initialDelayMs?: number } = {},
  ): Promise<SolvoDirectExecutionStatus> {
    const maxPolls = options.maxPolls ?? 15;
    let delayMs = options.initialDelayMs ?? 2000;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      await sleep(delayMs);
      const status = await this.getDirectExecutionStatus(executionId);
      if (status.status === "completed" || status.status === "failed") {
        return status;
      }
      delayMs = Math.min(delayMs * 1.5, 10_000);
    }
    throw new SolvoError(
      "unknown",
      `Execution ${executionId} did not reach a terminal state within the polling budget. Inspect it in KeeperHub before retrying.`,
    );
  }

  async doctor(): Promise<DoctorReport> {
    const missing: string[] = [];
    let connection: DoctorReport["connection"] = "ok";
    let auth: DoctorReport["auth"] = "ok";
    let walletConfigured = false;
    let walletAddress: string | null = null;
    let executeTransferTool = false;
    let statusTool = false;

    let connected = false;
    try {
      await this.client.connect();
      connected = true;
    } catch (error) {
      const message = extractMessage(error);
      const lower = message.toLowerCase();
      if (lower.includes("invalid_token") || lower.includes("401")) {
        auth = "failed";
        missing.push(`KeeperHub rejected the API key: ${message}`);
      } else {
        connection = "failed";
        missing.push(`MCP connection to ${this.client.url} failed: ${message}`);
      }
    }

    if (connected) {
      try {
        const tools = await this.listTools();
        executeTransferTool = tools.some((tool) => tool.name === "execute_transfer");
        statusTool = tools.some((tool) => tool.name === "get_direct_execution_status");
        if (!executeTransferTool) {
          missing.push("MCP server did not expose the execute_transfer tool.");
        }
        if (!statusTool) {
          missing.push("MCP server did not expose the get_direct_execution_status tool.");
        }
      } catch (error) {
        auth = "failed";
        const message = extractMessage(error);
        missing.push(`KeeperHub rejected the API key: ${message}`);
      }
    }

    if (auth === "ok" && connected) {
      try {
        const wallet = await this.getWalletIntegration();
        walletConfigured = wallet.configured;
        walletAddress = wallet.address;
        if (!wallet.configured) {
          missing.push(
            "No wallet integration is configured for this organization. Create one at app.keeperhub.com (Wallet Management) before any write.",
          );
        }
      } catch (error) {
        missing.push(`Wallet integration check failed: ${extractMessage(error)}`);
      }
    }

    const chain = await this.chainStatus(KEEPERHUB_CHAIN_ID);

    return {
      connection,
      auth,
      walletConfigured,
      walletAddress,
      chainSupport: { chainId: KEEPERHUB_CHAIN_ID, found: chain.found, status: chain.status },
      executeTransferTool,
      statusTool,
      readyForWrite:
        connection === "ok" &&
        auth === "ok" &&
        walletConfigured &&
        executeTransferTool &&
        statusTool,
      missing,
    };
  }

  get url(): string {
    return this.client.url;
  }

  get targetSummary(): string {
    return `${KEEPERHUB_CHAIN_NAME} / ${KEEPERHUB_CHAIN_ID} · ${KEEPERHUB_USDC_SYMBOL}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
