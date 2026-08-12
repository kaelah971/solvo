import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

import { KeeperHubAdapter } from "../../src/server/keeperhub/adapter.ts";
import { KeeperHubMcpClient } from "../../src/server/keeperhub/mcp-client.ts";

/**
 * Regression tests for the Telegram development flow bug:
 * the execution gateway builds a KeeperHubMcpClient and never calls
 * connect() before the first tool call, so the SDK threw
 * `Error: Not connected` and every /pay simulation failed with
 * simulation_transport_failure. The client must connect lazily on the
 * first protocol operation and reconnect if the transport session drops.
 */

const EXECUTE_TRANSFER_SCHEMA = {
  type: "object",
  properties: {
    chain_id: { type: "string" },
    to_address: { type: "string" },
    amount: { type: "string" },
    token_address: { type: "string" },
    simulate: { type: "boolean" },
  },
  required: ["chain_id", "to_address", "amount"],
};

type CallCapture = {
  name: string;
  args: Record<string, unknown>;
  respondWith: (args: Record<string, unknown>) => { text: string; isError?: boolean };
};

function createFakeServer(): {
  clientTransport: InMemoryTransport;
  calls: CallCapture[];
} {
  const calls: CallCapture[] = [];
  const server = new Server(
    { name: "fake-keeperhub", version: "1.0.0" },
    { capabilities: { tools: {} } as ServerCapabilities },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "execute_transfer",
        description: "",
        inputSchema: EXECUTE_TRANSFER_SCHEMA,
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const call = calls.find((c) => c.name === request.params.name);
    const result = call?.respondWith(args) ?? { text: "{}" };
    return {
      content: [{ type: "text", text: result.text }],
      isError: result.isError === true,
    };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  void server.connect(serverTransport);
  return { clientTransport, calls };
}

function sanitizedErrorText(): string {
  const errorText = {
    success: false,
    wouldRevert: true,
    revertReason: "Error(ERC20: transfer amount exceeds balance)",
    code: "insufficient_balance",
  };
  return JSON.stringify(errorText);
}

const SIMULATION_ARGS = {
  chainId: "8453",
  recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
  amount: "0.01",
  tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

function registerSimulationHandler(calls: CallCapture[]): void {
  calls.push({
    name: "execute_transfer",
    args: {},
    respondWith: () => ({ text: sanitizedErrorText() }),
  });
}

describe("KeeperHubMcpClient lazy connection (regression)", () => {
  it("serves tool calls without an explicit connect(), as the Telegram gateway relies on", async () => {
    const { clientTransport, calls } = createFakeServer();
    registerSimulationHandler(calls);

    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test_key",
      transportFactory: () => clientTransport,
    });
    const adapter = new KeeperHubAdapter(client);

    const simulation = await adapter.simulateTransfer(SIMULATION_ARGS);

    assert.equal(simulation.wouldRevert, true);
    assert.equal(simulation.revertReason, "Error(ERC20: transfer amount exceeds balance)");
    await client.close();
  });

  it("sends the Telegram development arguments in the same shape M1 uses (human USDC, canonical token, simulate=true)", async () => {
    const { clientTransport, calls } = createFakeServer();
    let received: Record<string, unknown> | null = null;
    calls.push({
      name: "execute_transfer",
      args: {},
      respondWith: (args) => {
        received = args;
        return { text: sanitizedErrorText() };
      },
    });

    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test_key",
      transportFactory: () => clientTransport,
    });
    const adapter = new KeeperHubAdapter(client);

    await adapter.simulateTransfer(SIMULATION_ARGS);

    assert.deepEqual(received, {
      chain_id: "8453",
      to_address: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
      amount: "0.01",
      token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      simulate: true,
    });
    await client.close();
  });

  it("reconnects after the transport session closes, so a long-running bot self-heals", async () => {
    const transports: InMemoryTransport[] = [];
    const factory = (): InMemoryTransport => {
      const pair = createFakeServer();
      registerSimulationHandler(pair.calls);
      transports.push(pair.clientTransport);
      return pair.clientTransport;
    };

    const client = new KeeperHubMcpClient({
      url: "https://app.keeperhub.com/mcp",
      apiKey: "kh_test_key",
      transportFactory: factory,
    });
    const adapter = new KeeperHubAdapter(client);

    const first = await adapter.simulateTransfer(SIMULATION_ARGS);
    assert.equal(first.wouldRevert, true);

    await transports[0].close();

    const second = await adapter.simulateTransfer(SIMULATION_ARGS);
    assert.equal(second.wouldRevert, true);
    assert.equal(transports.length, 2);
    await client.close();
  });
});
