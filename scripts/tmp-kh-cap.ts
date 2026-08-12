import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";
import { getConfig, loadEnvForScript } from "../src/server/keeperhub/config.ts";

loadEnvForScript();
const config = getConfig();
const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey, timeoutMs: 30_000 });
await client.connect();

const tools = await client.listTools();
console.log("TOOLS:");
for (const tool of tools) {
  console.log("  - " + tool.name);
  const props = (tool.inputSchema?.properties ?? {}) as Record<string, unknown>;
  console.log("    props: " + Object.keys(props).join(", "));
}

const { text, isError } = await client.callTool("list_integrations", {});
console.log("");
console.log("list_integrations isError:", isError);
console.log("list_integrations text:", text.slice(0, 2000));

await client.close();
