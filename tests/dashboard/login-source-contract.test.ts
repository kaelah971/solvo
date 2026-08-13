import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.4 — Login bridge source contract.
 *
 * Login material (tokens, cookies) and the Telegram /dashboard flow must
 * never touch execution, KeeperHub, payment, approval, or model surfaces.
 * The raw login token must never be logged or stored.
 */
const LOGIN_SOURCE_FILES = [
  "src/server/dashboard/login-links.ts",
  "src/server/dashboard/session.ts",
  "src/server/dashboard/auth-exchange.ts",
  "src/app/auth/telegram-link/route.ts",
  "src/app/auth/logout/route.ts",
  "src/server/telegram/flows/dashboard-flow.ts",
];

const FORBIDDEN_IMPORT_PATTERNS = [
  "keeperhub/",
  "mcp",
  "execution-service",
  "execution-gateway",
  "telegram/flows/pay-flow",
  "telegram/flows/community-pay-flow",
  "telegram/flows/batch",
  "telegram/flows/judge",
  "telegram/flows/claim",
  "webhook",
  "judge/",
  "providers/",
  "openai",
  "postgres",
  "node:http",
  "node:https",
  "fetch(",
];

/**
 * The ONLY permitted console output across the login bridge is the safe
 * boolean diagnostic tag in each file; everything else is forbidden.
 */
const ALLOWED_DIAGNOSTIC_TAGS = [
  { file: "src/server/dashboard/session.ts", tag: "dashboard_session_debug" },
  { file: "src/server/dashboard/auth-exchange.ts", tag: "dashboard_auth_link_debug" },
  { file: "src/app/auth/telegram-link/route.ts", tag: "dashboard_auth_link_debug" },
  { file: "src/server/telegram/flows/dashboard-flow.ts", tag: "dashboard_login_link_debug" },
];

function assertOnlyDiagnosticLogs(file: string, source: string): void {
  const allowed = ALLOWED_DIAGNOSTIC_TAGS.find((entry) => entry.file === file);
  const otherLogs = source
    .split("\n")
    .filter((line) => line.includes("console.") && !(allowed !== undefined && line.includes(`console.log(\`${allowed.tag}`)));
  assert.equal(otherLogs.length, 0, `${file} logs outside its diagnostic tag`);
  if (allowed !== undefined) {
    assert.match(source, new RegExp(`console\\.log\\(\`${allowed.tag}`), `${file} misses the diagnostic tag`);
  }
}

describe("M12.4 login bridge source contract", () => {
  it("login/session modules import no KeeperHub/MCP/execution writer/model provider", () => {
    for (const file of LOGIN_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
      assertOnlyDiagnosticLogs(file, source);
      const importLines = source
        .split("\n")
        .filter((line) => /^\s*(import|export).*?(from|import\()/.test(line));
      for (const line of importLines) {
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          assert.equal(line.includes(pattern), false, `${file} imports "${pattern}": ${line.trim()}`);
        }
      }
    }
  });

  it("the Telegram /dashboard flow imports no payment execution path", () => {
    const flow = readFileSync("src/server/telegram/flows/dashboard-flow.ts", "utf8");
    assert.equal(flow.includes("execution"), false, "flow references execution");
    assert.equal(flow.includes("keeperhub"), false);
    assert.equal(flow.includes("approve"), false, "flow references approvals");
    assert.equal(flow.includes("payout"), false, "flow references payouts");
    assert.equal(flow.includes("payment"), false, "flow references payments");
  });

  it("no raw login token is ever stored or logged by the bridge", () => {
    const links = readFileSync("src/server/dashboard/login-links.ts", "utf8");
    assert.equal(links.includes("console."), false, "login-links logs");
    assert.match(links, /hashDashboardLoginToken/);
    assert.match(links, /randomBytes/);
    // The raw token variable is returned once to the caller, never persisted.
    assert.equal(links.includes("tokenHash"), true, "only the hash is persisted");
  });

  it("the session seam rejects tampering and never trusts query params", () => {
    const session = readFileSync("src/server/dashboard/session.ts", "utf8");
    assert.equal(session.includes("searchParams"), false);
    assert.equal(session.includes("URLSearchParams"), false);
    assert.equal(session.includes("useSearchParams"), false);
    assert.match(session, /timingSafeEqual/);
    assert.match(session, /httpOnly: true/);
    assert.match(session, /sameSite: "lax"/);
  });

  it("the auth route never renders or echoes the token", () => {
    const route = readFileSync("src/app/auth/telegram-link/route.ts", "utf8");
    assert.equal(route.includes("jsx"), false, "route renders no JSX markup");
    assert.equal(/<[a-zA-Z]/.test(route.replace(/Promise</g, "")), false, "route renders no markup tags");
    assert.equal(route.includes("NextResponse.json"), false, "route returns no JSON body with token");
    assert.equal(route.includes("NextResponse.next"), false);
    // Invalid paths redirect to /app (the generic unavailable screen).
    assert.match(route, /unavailableRedirect/);
    assert.match(route, /searchParams\.get\("token"\)/);
  });

  it("the migration stores only the token hash", () => {
    const migration = readFileSync("migrations/0014_dashboard_login_tokens.sql", "utf8");
    assert.match(migration, /token_hash text NOT NULL UNIQUE/);
    assert.equal(migration.includes("raw_token"), false, "migration stores a raw token column");
  });
});
