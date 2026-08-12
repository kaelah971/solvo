import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { KEEPERHUB_CHAIN_ID, KEEPERHUB_CHAIN_NAME, KEEPERHUB_USDC_SYMBOL, loadEnvForScript, getConfig } from "../src/server/keeperhub/config.ts";
import { KeeperHubConfigError } from "../src/server/keeperhub/config.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";

function row(label: string, value: string): string {
  return label.padEnd(22) + value;
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

  console.log("SOLVO / KEEPERHUB DIAGNOSTIC");
  console.log("");
  console.log(row("ENDPOINT", config.mcpUrl));

  const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey, timeoutMs: 30_000 });
  const adapter = new KeeperHubAdapter(client);

  let report;
  try {
    report = await adapter.doctor();
  } finally {
    await adapter.close();
  }

  console.log(row("CONNECTION", report.connection === "ok" ? "OK" : "FAILED"));
  console.log(row("AUTHENTICATION", report.auth === "ok" ? "OK" : "FAILED"));
  if (report.connection === "ok") {
    console.log(row("TOOL EXECUTE_TRANSFER", report.executeTransferTool ? "AVAILABLE" : "MISSING"));
    console.log(row("TOOL GET_STATUS", report.statusTool ? "AVAILABLE" : "MISSING"));
  }
  console.log(
    row(
      "WALLET INTEGRATION",
      report.walletConfigured ? "CONFIGURED" : report.connection === "ok" && report.auth === "ok" ? "NOT CONFIGURED" : "NOT CHECKED",
    ),
  );
  if (report.walletAddress) {
    console.log(row("WALLET ADDRESS", report.walletAddress));
  }
  console.log(
    row(
      "TARGET NETWORK",
      `${KEEPERHUB_CHAIN_NAME} / ${KEEPERHUB_CHAIN_ID}` +
        (report.chainSupport.found ? "" : " (not confirmed in action schemas)"),
    ),
  );
  console.log(row("ASSET", `${KEEPERHUB_USDC_SYMBOL} (Base)`));
  console.log(row("READY FOR WRITE", report.readyForWrite ? "YES" : "NO"));

  if (report.missing.length > 0) {
    console.log("");
    console.log("MISSING / REQUIRED");
    for (const item of report.missing) {
      console.log("  - " + item);
    }
    console.log("");
    console.log("Nothing was broadcast. Fix the items above, then rerun this diagnostic.");
    return 2;
  }

  console.log("");
  console.log("All checks passed. The wallet is configured and ready for a small USDC proof transfer.");
  return 0;
}

process.exit(await main());
