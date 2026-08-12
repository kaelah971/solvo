import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_CHAIN_NAME, getConfig, loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { KeeperHubConfigError } from "../src/server/keeperhub/config.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";

function row(label: string, value: string): string {
  return label.padEnd(24) + value;
}

async function main(): Promise<number> {
  let config;
  try {
    loadEnvForScript();
    config = getConfig();
  } catch (error) {
    if (error instanceof KeeperHubConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  console.log("SOLVO / KEEPERHUB HARMLESS READ");
  console.log("Read-only tool invocations. No funds move and nothing is broadcast.");
  console.log("");

  const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey, timeoutMs: 30_000 });
  const adapter = new KeeperHubAdapter(client);

  try {
    await adapter.connect();
  } catch (error) {
    console.error("CONNECTION FAILED");
    console.error(String(error));
    return 2;
  }

  try {
    const tools = await adapter.listTools();
    const relevant = tools
      .filter((tool) =>
        ["execute_transfer", "get_direct_execution_status", "get_wallet_integration", "list_action_schemas"].includes(tool.name),
      )
      .map((tool) => tool.name);
    console.log(row("MCP TOOLS", `${tools.length} total`));
    console.log(row("EXECUTION TOOLS", relevant.join(", ") || "none found"));
    console.log("");

    const wallet = await adapter.getWalletIntegration();
    console.log(row("WALLET INTEGRATION", wallet.configured ? "CONFIGURED" : "NOT CONFIGURED"));
    if (wallet.address) {
      console.log(row("WALLET ADDRESS", wallet.address));
    }
    console.log(row("WALLET CHAINS", wallet.chainIds.join(", ") || "—"));

    const chain = await adapter.chainStatus(KEEPERHUB_CHAIN_ID);
    console.log(
      row(
        "CHAIN " + KEEPERHUB_CHAIN_ID,
        `${KEEPERHUB_CHAIN_NAME} present in action schemas: ${chain.found ? "YES" : "NO / NOT CONFIRMED"}`,
      ),
    );

    console.log("");
    console.log("READ COMPLETE. Nothing was broadcast.");
    return 0;
  } catch (error) {
    console.error("READ FAILED");
    console.error(String(error));
    return 2;
  } finally {
    await adapter.close();
  }
}

process.exit(await main());
