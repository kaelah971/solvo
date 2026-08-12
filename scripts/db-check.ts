import { createDbClient } from "../src/server/db/client.ts";
import { getDatabaseUrl } from "../src/server/db/config.ts";
import { listMigrationFiles } from "../src/server/db/migrate.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";

async function main(): Promise<number> {
  loadEnvForScript();
  try {
    getDatabaseUrl();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const sql = createDbClient({ max: 1 });
  try {
    const [{ ok }] = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    console.log("CONNECTION           OK" + (ok === 1 ? "" : " (unexpected)"));

    const tables = [
      "workspaces",
      "payouts",
      "payout_items",
      "execution_attempts",
      "audit_events",
      "schema_migrations",
    ];
    const counts: Array<{ table_name: string; count: string }> = [];
    for (const table of tables) {
      const rows = await sql.unsafe<Array<{ n: string }>>(`SELECT count(*) AS n FROM ${table}`);
      counts.push({ table_name: table, count: rows[0].n });
    }
    for (const row of counts) {
      console.log(`TABLE ${row.table_name.padEnd(19)} ${row.count} rows`);
    }

    const constraint = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'payout_items'::regclass AND contype = 'u'
    `;
    const hasUniqueIdempotency = constraint.some((row) => row.conname.includes("idempotency_key"));
    console.log("UNIQUE IDEMPOTENCY   " + (hasUniqueIdempotency ? "OK (payout_items.idempotency_key)" : "MISSING"));

    const applied = await sql<{ version: string }[]>`SELECT version FROM schema_migrations ORDER BY version`;
    const files = listMigrationFiles();
    const appliedSet = new Set(applied.map((row) => row.version));
    const missing = files.filter((file) => !appliedSet.has(file));
    console.log("MIGRATIONS APPLIED   " + applied.length + "/" + files.length);
    if (missing.length > 0) {
      console.log("MIGRATIONS MISSING   " + missing.join(", ") + " (run npm run db:migrate)");
      return 2;
    }

    console.log("DB CHECK PASSED");
    return 0;
  } catch (error) {
    console.error("DB CHECK FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    await sql.end();
  }
}

process.exit(await main());
