import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.2 — Dashboard read-model source contract.
 *
 * Dashboard read models are display-only: they may read through the
 * repository abstraction and pure helpers, but they must never reach into
 * execution, KeeperHub, Telegram/webhook mutation surfaces, model providers,
 * or the database client directly, and they never make network calls.
 */
const DASHBOARD_SOURCE_FILES = [
  "src/server/dashboard/types.ts",
  "src/server/dashboard/access.ts",
  "src/server/dashboard/overview.ts",
  "src/server/dashboard/payouts.ts",
  "src/server/dashboard/claims.ts",
  "src/server/dashboard/members.ts",
  "src/server/dashboard/recipients.ts",
  "src/server/dashboard/audit.ts",
  "src/server/dashboard/agent-runs.ts",
];

const FORBIDDEN_IMPORT_PATTERNS = [
  "keeperhub/",
  "mcp-client",
  "execution-service",
  "execution-gateway",
  "telegram/",
  "webhook",
  "judge/",
  "providers/",
  "openai",
  "postgres",
  "node:http",
  "node:https",
  "fetch(",
];

describe("dashboard read models source contract", () => {
  it("dashboard modules import no execution/KeeperHub/Telegram/provider/DB-client modules", () => {
    for (const file of DASHBOARD_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        // Only flag import/from statements, not prose comments.
        const importLines = source
          .split("\n")
          .filter((line) => /^\s*(import|export).*?(from|import\()/.test(line));
        for (const line of importLines) {
          assert.equal(
            line.includes(pattern),
            false,
            `${file} imports "${pattern}": ${line.trim()}`,
          );
        }
      }
    }
  });

  it("dashboard read services use only the repository abstraction (no raw SQL strings)", () => {
    // Pure view mappers take rows as input and never touch the repository.
    for (const file of DASHBOARD_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("this.sql"), false, `${file} touches the SQL client`);
      assert.equal(source.includes("sql`"), false, `${file} embeds raw SQL`);
      assert.equal(source.includes("await import("), false, `${file} dynamically imports`);

      // Shared option types import from the repository interface is fine.
      const pureMapper = file.endsWith("audit.ts");
      if (!file.endsWith("types.ts") && !pureMapper) {
        assert.equal(source.includes("repository.ts"), true, `${file} must go through the repository abstraction`);
      }
    }
  });

  it("read models expose no raw provider/decision/interpretation JSON or secret shapes", () => {
    for (const file of DASHBOARD_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("candidates_json"), false, `${file} exposes candidates_json`);
      assert.equal(source.includes("interpretation_json"), false, `${file} exposes interpretation_json`);
      assert.equal(source.includes("decision_json"), false, `${file} exposes decision_json`);
      assert.equal(source.includes("raw_keeperhub_status"), false, `${file} exposes raw keeperhub payloads`);
      assert.equal(source.includes("token_hash"), false, `${file} exposes token hashes`);
      assert.equal(source.includes("token_prefix"), false, `${file} exposes token prefixes`);
      assert.equal(source.includes("keeperhub_execution_id"), false, `${file} exposes execution ids`);
      assert.equal(source.includes("simulation_result"), false, `${file} exposes simulation results`);
    }
  });

  it("no migration 0013 dependency: read models never reference the reissue enum", () => {
    // The reissue audit event type is a plain string at read time; dashboard
    // read models must pass without the migration being applied.
    const audit = readFileSync("src/server/dashboard/audit.ts", "utf8");
    assert.equal(audit.includes("0013"), false);
    assert.equal(audit.includes("ALTER TYPE"), false);
    assert.equal(audit.includes("solvo_audit_event_type"), false);
  });
});
