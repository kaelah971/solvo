import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { ToolDescriptor } from "./types.ts";

export type ToolCallResult = {
  text: string;
  isError: boolean;
};

export type KeeperHubMcpClientOptions = {
  url: string;
  apiKey: string;
  timeoutMs?: number;
  /** Test seam: build the transport instead of the default streamable HTTP one. */
  transportFactory?: () => Transport;
};

export class KeeperHubMcpClient {
  readonly url: string;
  private readonly client: Client;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly transportFactory: () => Transport;
  private connected = false;

  constructor(options: KeeperHubMcpClientOptions) {
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.transportFactory =
      options.transportFactory ?? (() => this.buildHttpTransport());
    this.client = new Client({ name: "solvo", version: "0.1.0" }, { capabilities: {} });
  }

  private buildHttpTransport(): Transport {
    return new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json, text/event-stream",
        },
      },
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const transport = this.transportFactory();
    const onclose = transport.onclose;
    transport.onclose = () => {
      this.connected = false;
      onclose?.();
    };
    await this.client.connect(transport);
    this.connected = true;
  }

  /**
   * Every protocol operation connects on first use. Callers such as the
   * Telegram execution gateway never call connect() explicitly; without the
   * lazy connect the SDK throws `Error: Not connected` on the first tool call.
   */
  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    await this.connect();
  }

  async listTools(): Promise<ToolDescriptor[]> {
    await this.ensureConnected();
    const response = await this.withTimeout(() => this.client.listTools());
    return (response.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    await this.ensureConnected();
    const response = await this.withTimeout(() => this.client.callTool({ name, arguments: args }));
    const isError = response.isError === true;
    const blocks = (response.content ?? []) as Array<Record<string, unknown>>;
    const text = blocks
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("\n");
    return { text, isError };
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }

  private async withTimeout<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("timeout: KeeperHub did not respond within the allowed window")),
            this.timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

