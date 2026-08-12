import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import type { Sql } from "postgres";

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export async function runMigrations(sql: Sql): Promise<MigrationResult> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const appliedRows = await sql<{ version: string }[]>`
    SELECT version FROM schema_migrations
  `;
  const appliedSet = new Set(appliedRows.map((row) => row.version));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of listMigrationFiles()) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }
    const contents = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`
        INSERT INTO schema_migrations (version) VALUES (${file})
      `;
    });
    applied.push(file);
  }

  return { applied, skipped };
}
