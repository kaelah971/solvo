import postgres, { type Sql } from "postgres";

import { getDatabaseUrl } from "./config.ts";

export function createDbClient(options: { max?: number } = {}): Sql {
  const url = getDatabaseUrl();
  return postgres(url, { max: options.max ?? 5, idle_timeout: 30 });
}
