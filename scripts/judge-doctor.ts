import { Bot } from "grammy";

import { createDbClient } from "../src/server/db/client.ts";
import { getJudgeConfig } from "../src/server/judge/config.ts";
import { JUDGE_DAILY_SPEND_STATES, utcDayStartIso } from "../src/server/telegram/flows/judge-flow.ts";
import { KeeperHubAdapter } from "../src/server/keeperhub/adapter.ts";
import { KeeperHubMcpClient } from "../src/server/keeperhub/mcp-client.ts";
import {
  KEEPERHUB_CHAIN_ID,
  KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT,
  getConfig as getKeeperHubConfig,
  loadEnvForScript,
} from "../src/server/keeperhub/config.ts";
import { getTelegramConfig } from "../src/server/telegram/config.ts";
import { getWebhookStatus } from "../src/server/telegram/webhook-admin.ts";
import { serializeBotError } from "../src/server/telegram/safe-logging.ts";
import { baseUnitsToUsdc } from "../src/server/execution/money.ts";

/**
 * Read-only Judge Mode diagnostic:
 *
 *   npm run judge:doctor
 *
 * Reports configuration, database, judge workspace, KeeperHub readiness,
 * caps, today's spend, and Telegram/webhook state. NEVER executes a payment.
 */
function row(label: string, value: string): string {
  return label.padEnd(30) + value;
}

async function main(): Promise<number> {
  loadEnvForScript();
  const problems: string[] = [];
  const ok = (label: string, value: string): void => console.log(row(label, value));
  const problem = (label: string, value: string): void => {
    console.log(row(label, value));
    problems.push(label + ": " + value);
  };

  console.log("SOLVO / JUDGE DOCTOR (READ-ONLY, NO PAYMENTS)");
  console.log("");

  // ── Judge config ───────────────────────────────────────────────────────
  const judge = getJudgeConfig();
  ok("JUDGE MODE", judge.enabled ? "ENABLED" : "DISABLED");
  ok(
    "JUDGE ACCESS",
    judge.adminUserIds.size === 0
      ? "PUBLIC SELF-SERVE (any Telegram user under caps)"
      : "ADMIN RESTRICTED (" + judge.adminUserIds.size + " admin(s), public locked down)",
  );
  ok("JUDGE ADMIN IDS", judge.adminUserIds.size > 0 ? judge.adminUserIds.size + " configured" : "none (public mode)");
  ok("JUDGE PER-TX CAP", baseUnitsToUsdc(BigInt(judge.perTxLimitBaseUnits)) + " USDC");
  ok("JUDGE DAILY CAP", baseUnitsToUsdc(BigInt(judge.dailyLimitBaseUnits)) + " USDC");
  ok("JUDGE LIFETIME CAP", baseUnitsToUsdc(BigInt(judge.lifetimeLimitBaseUnits)) + " USDC");
  ok("MAX SUCCESSFUL PER USER", String(judge.maxSuccessfulPaymentsPerUser));
  ok(
    "JUDGE INTEGRATION ID",
    judge.keeperhubJudgeIntegrationId
      ? judge.keeperhubJudgeIntegrationId + " (used only if MCP advertises integration selector)"
      : "not configured (org wallet used)",
  );
  if (!judge.enabled) problem("JUDGE MODE", "disabled — set JUDGE_MODE_ENABLED=true to enable");
  console.log("");

  // ── Database + judge workspace ─────────────────────────────────────────
  let sql: ReturnType<typeof createDbClient> | null = null;
  try {
    sql = createDbClient({ max: 1 });
    const [{ one }] = await sql<{ one: number }[]>`SELECT 1 AS one`;
    ok("DATABASE", "OK (SELECT 1 -> " + one + ")");
  } catch (error) {
    problem("DATABASE", "FAILED — " + (error instanceof Error ? error.message : String(error)));
  }

  if (sql) {
    try {
      const rows = await sql`
        SELECT id, mode, status, chain_id, token_address, per_transaction_limit_base_units,
               daily_limit_base_units, approval_policy
        FROM workspaces WHERE mode = 'judge'
      `;
      if (rows.length === 0) {
        problem("JUDGE WORKSPACE", "MISSING — run npm run db:migrate");
      } else {
        const w = rows[0];
        ok("JUDGE WORKSPACE", "FOUND (status " + w.status + ", chain " + w.chain_id + ")");
        ok("JUDGE TOKEN", String(w.token_address).toLowerCase());
        ok("JUDGE WORKSPACE PER-TX", w.per_transaction_limit_base_units + " base units");
        ok("JUDGE WORKSPACE DAILY", w.daily_limit_base_units + " base units");
        ok("JUDGE APPROVAL POLICY", String(w.approval_policy));
        if (w.status !== "active") problem("JUDGE WORKSPACE", "not active");
        if (String(w.chain_id) !== KEEPERHUB_CHAIN_ID) problem("JUDGE WORKSPACE", "chain is not 8453");
        if (String(w.token_address).toLowerCase() !== KEEPERHUB_USDC_TOKEN_ADDRESS_DEFAULT.toLowerCase()) {
          problem("JUDGE WORKSPACE", "token is not canonical Base USDC");
        }
        if (String(w.per_transaction_limit_base_units) !== judge.perTxLimitBaseUnits) {
          problem("JUDGE WORKSPACE", "per-tx limit differs from config (" + judge.perTxLimitBaseUnits + ")");
        }
        if (String(w.daily_limit_base_units) !== judge.dailyLimitBaseUnits) {
          problem("JUDGE WORKSPACE", "daily limit differs from config (" + judge.dailyLimitBaseUnits + ")");
        }
        const todaySpend = await sql<{ total: string | null }[]>`
          SELECT sum(pi.amount_base_units) AS total
          FROM payout_items pi
          JOIN payouts p ON p.id = pi.payout_id
          WHERE p.workspace_id = ${w.id}
            AND pi.status::text = ANY(${[...JUDGE_DAILY_SPEND_STATES] as string[]})
            AND pi.created_at >= ${utcDayStartIso()}
        `;
        const spend = todaySpend[0]?.total ?? "0";
        ok(
          "TODAY'S JUDGE SPEND",
          baseUnitsToUsdc(BigInt(spend)) + " USDC of " + baseUnitsToUsdc(BigInt(judge.dailyLimitBaseUnits)) + " USDC cap",
        );
        const lifetimeSpend = await sql<{ total: string | null }[]>`
          SELECT sum(pi.amount_base_units) AS total
          FROM payout_items pi
          JOIN payouts p ON p.id = pi.payout_id
          WHERE p.workspace_id = ${w.id}
            AND pi.status::text = ANY(${[...JUDGE_DAILY_SPEND_STATES] as string[]})
        `;
        ok(
          "LIFETIME JUDGE SPEND",
          baseUnitsToUsdc(BigInt(lifetimeSpend[0]?.total ?? "0")) + " USDC of " + baseUnitsToUsdc(BigInt(judge.lifetimeLimitBaseUnits)) + " USDC cap",
        );
      }
    } catch (error) {
      problem("JUDGE WORKSPACE", "QUERY FAILED — " + (error instanceof Error ? error.message : String(error)));
    }
  }
  console.log("");

  // ── KeeperHub ──────────────────────────────────────────────────────────
  let keeperHubReady = false;
  try {
    const khConfig = getKeeperHubConfig();
    const client = new KeeperHubMcpClient({ url: khConfig.mcpUrl, apiKey: khConfig.apiKey, timeoutMs: 30_000 });
    const adapter = new KeeperHubAdapter(client);
    try {
      const report = await adapter.doctor();
      ok("KEEPERHUB", report.readyForWrite ? "READY FOR WRITE" : "NOT READY FOR WRITE");
      ok("KEEPERHUB WALLET", report.walletAddress ?? "none");
      if (report.walletAddress) {
        console.log(row("WALLET ISOLATION", "Judge Mode uses the configured KeeperHub org wallet; the MCP exposes a single EVM integration and execute_transfer accepts no integration selector today."));
      }
      if (report.missing.length > 0) {
        for (const item of report.missing) problem("KEEPERHUB", item);
      }
      keeperHubReady = report.readyForWrite;
    } finally {
      await adapter.close();
    }
  } catch (error) {
    problem("KEEPERHUB", "NOT CONFIGURED — " + (error instanceof Error ? error.message : String(error)));
  }
  console.log("");

  // ── Telegram + webhook ─────────────────────────────────────────────────
  let telegramOk = false;
  const telegramConfig = getTelegramConfig();
  if (!telegramConfig.botToken) {
    problem("TELEGRAM BOT", "TELEGRAM_BOT_TOKEN missing");
  } else {
    try {
      const probe = new Bot(telegramConfig.botToken);
      const me = await probe.api.getMe();
      ok("TELEGRAM BOT", "@" + me.username + " (id " + me.id + ")");
      telegramOk = true;
      const webhook = await getWebhookStatus(probe.api);
      ok("TELEGRAM WEBHOOK", webhook.message);
    } catch (error) {
      problem("TELEGRAM BOT", "FAILED — " + serializeBotError(error, { action: "judgeDoctor:getMe" }));
    }
  }

  console.log("");
  const ready =
    judge.enabled &&
    problems.length === 0 &&
    keeperHubReady &&
    telegramOk;
  ok(
    "READY FOR JUDGE TEST",
    ready ? "YES" : "NO — fix the items above",
  );
  console.log("");
  if (problems.length > 0) {
    console.log(problems.length + " problem(s). Nothing was executed.");
    return 2;
  }
  console.log("All judge checks passed. Nothing was executed.");
  return 0;
}

process.exit(await main());
