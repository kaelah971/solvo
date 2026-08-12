import { Bot } from "grammy";

import { createDbClient } from "../src/server/db/client.ts";
import { getDatabaseUrl } from "../src/server/db/config.ts";
import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";
import { getConfig as getKeeperHubConfig, loadEnvForScript } from "../src/server/keeperhub/config.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";

function row(label: string, value: string): string {
  return label.padEnd(26) + value;
}

async function main(): Promise<number> {
  loadEnvForScript();
  const config = getTelegramConfig();
  let problems = 0;

  console.log("SOLVO / TELEGRAM DIAGNOSTIC");
  console.log("");

  if (!config.botToken) {
    console.log(row("BOT TOKEN", "NOT CONFIGURED"));
    console.log("  - TELEGRAM_BOT_TOKEN is missing. Create a bot with @BotFather and add the token to .env.");
    problems += 1;
  } else {
    console.log(row("BOT TOKEN", "CONFIGURED (" + config.botToken.length + " chars)"));
    try {
      const probe = new Bot(config.botToken);
      const me = await probe.api.getMe();
      console.log(row("BOT IDENTITY", "@" + me.username + " (id " + me.id + ")"));
      const webhook = await probe.api.getWebhookInfo();
      console.log(
        row(
          "WEBHOOK",
          webhook.url && webhook.url.length > 0
            ? "SET → " + webhook.url + (webhook.pending_update_count > 0 ? " (" + webhook.pending_update_count + " pending)" : "")
            : "NOT SET (polling mode usable)",
        ),
      );
    } catch (error) {
      console.log(row("BOT IDENTITY", "FAILED"));
      console.log("  - " + (error instanceof Error ? error.message : String(error)));
      problems += 1;
    }
  }

  console.log(
    row(
      "ENV MODE",
      config.allowedDevUserIds.size > 0
        ? "DEVELOPMENT + SANDBOX (" + config.allowedDevUserIds.size + " allowlisted user(s))"
        : "SANDBOX ONLY (no development allowlist)",
    ),
  );
  if (config.webhookSecret) {
    console.log(row("WEBHOOK SECRET", "CONFIGURED"));
  }

  console.log("");
  try {
    const dbUrl = getDatabaseUrl();
    const sql = createDbClient({ max: 1 });
    try {
      const [{ ok }] = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
      console.log(row("DATABASE", "OK" + (ok === 1 ? "" : " (unexpected)") + " — " + dbUrl.split("@").pop()));
      const communityTables = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('workspace_members', 'recipients')
      `;
      const communityReady =
        communityTables.some((t) => t.table_name === "workspace_members") &&
        communityTables.some((t) => t.table_name === "recipients");
      console.log(
        row("COMMUNITY MODE", communityReady ? "AVAILABLE (workspace_members + recipients)" : "NOT READY (run npm run db:migrate)"),
      );
    } finally {
      await sql.end();
    }
  } catch (error) {
    console.log(row("DATABASE", "NOT CONFIGURED"));
    console.log("  - " + (error instanceof Error ? error.message : String(error)));
    problems += 1;
  }

  console.log("");
  try {
    const khConfig = getKeeperHubConfig();
    const client = new KeeperHubMcpClient({ url: khConfig.mcpUrl, apiKey: khConfig.apiKey, timeoutMs: 30_000 });
    const adapter = new KeeperHubAdapter(client);
    try {
      const report = await adapter.doctor();
      console.log(row("KEEPERHUB", report.readyForWrite ? "READY FOR WRITE" : "NOT READY FOR WRITE"));
      if (report.walletAddress) console.log(row("KEEPERHUB WALLET", report.walletAddress));
      if (report.missing.length > 0) {
        for (const item of report.missing) console.log("  - " + item);
        problems += 1;
      }
    } finally {
      await adapter.close();
    }
  } catch (error) {
    console.log(row("KEEPERHUB", "NOT CONFIGURED"));
    console.log("  - " + (error instanceof Error ? error.message : String(error)));
    problems += 1;
  }

  console.log("");
  if (problems > 0) {
    console.log("Fix the items above. No payment execution was performed.");
    return 2;
  }
  console.log("All checks passed. No payment execution was performed.");
  return 0;
}

process.exit(await main());
