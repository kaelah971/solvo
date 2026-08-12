import type { KeeperHubExecutionGateway } from "../../execution/execution-service.ts";
import { KeeperHubAdapter } from "../../keeperhub/adapter.ts";
import { KeeperHubMcpClient } from "../../keeperhub/mcp-client.ts";
import { getConfig as getKeeperHubConfig } from "../../keeperhub/config.ts";

const GATEWAY = Symbol.for("solvo.keeperhub.execution-gateway");

/**
 * Lazy per-process singleton around the real KeeperHub adapter. Connection is
 * established on first tool call, so a missing key fails at call time with a
 * classified error rather than at boot.
 */
export function getRealExecutionGateway(): KeeperHubExecutionGateway {
  const holder = globalThis as unknown as Record<symbol, KeeperHubAdapter | undefined>;
  if (!holder[GATEWAY]) {
    const config = getKeeperHubConfig();
    const client = new KeeperHubMcpClient({ url: config.mcpUrl, apiKey: config.apiKey });
    holder[GATEWAY] = new KeeperHubAdapter(client);
  }
  return holder[GATEWAY];
}
