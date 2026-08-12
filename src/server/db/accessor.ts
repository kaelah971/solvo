import { createDbClient } from "./client.ts";
import { PostgresRepository } from "./postgres-repository.ts";

const DB = Symbol.for("solvo.db.sql");

/**
 * Process-wide Postgres repository accessor shared by the Telegram bot, the
 * claim page, and the claim server action. Returns null when DATABASE_URL is
 * not configured so callers can fail truthfully.
 */
export function getDbRepository(): PostgresRepository | null {
  if (!process.env.DATABASE_URL) return null;
  const holder = globalThis as unknown as Record<symbol, unknown>;
  if (!holder[DB]) {
    holder[DB] = createDbClient();
  }
  return new PostgresRepository(holder[DB] as ReturnType<typeof createDbClient>);
}
