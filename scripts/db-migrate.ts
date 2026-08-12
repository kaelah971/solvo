import { createDbClient } from "../src/server/db/client.ts";
import { getDatabaseUrl } from "../src/server/db/config.ts";
import { runMigrations } from "../src/server/db/migrate.ts";
import { loadEnvForScript } from "../src/server/keeperhub/config.ts";

async function main(): Promise<number> {
  loadEnvForScript();
  try {
    getDatabaseUrl();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const sql = createDbClient();
  try {
    const result = await runMigrations(sql);
    if (result.applied.length > 0) {
      console.log("APPLIED:");
      for (const file of result.applied) console.log("  + " + file);
    }
    if (result.skipped.length > 0) {
      console.log("ALREADY APPLIED:");
      for (const file of result.skipped) console.log("  = " + file);
    }
    console.log("Migration run complete.");
    return 0;
  } catch (error) {
    console.error("MIGRATION FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  } finally {
    await sql.end();
  }
}

process.exit(await main());
