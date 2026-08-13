import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.3 — `/app` overview route source contract.
 *
 * The overview page is a read-only renderer: it must import no execution/
 * KeeperHub/Telegram/model-provider surface, render no admin actions, leak no
 * ids, and speak only the truthful dashboard vocabulary.
 */
const ROUTE_SOURCE_FILES = [
  "src/app/app/page.tsx",
  "src/app/app/layout.tsx",
  "src/server/dashboard/session.ts",
  "src/server/dashboard/overview-page.ts",
];

const FORBIDDEN_IMPORT_PATTERNS = [
  "keeperhub/",
  "mcp",
  "execution-service",
  "execution-gateway",
  "telegram/",
  "webhook",
  "judge/",
  "providers/",
  "openai",
  "node:http",
  "node:https",
  "fetch(",
];

/** Internal vocabulary that must never reach page output. */
const BANNED_OUTPUT_TERMS = [
  "agent_run",
  "agent run",
  "provider",
  "interpreter",
  "planner",
  "schema",
  "token_hash",
  "tokenHash",
  "token_prefix",
  "idempotency",
  "raw JSON",
  "keeperhub_execution_id",
  "execution id",
  "mcp-client",
  "webhook",
  "candidates_json",
  "interpretation_json",
  "decision_json",
  '{"',
];

describe("/app overview route source contract", () => {
  it("imports no KeeperHub/MCP/execution writer/Telegram/model-provider/fetch surface", () => {
    for (const file of ROUTE_SOURCE_FILES) {
      const source = readFileSync(file, "utf8");
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

  it("renders the truthful overview vocabulary", () => {
    const page = readFileSync("src/app/app/page.tsx", "utf8");
    assert.match(page, /Prepared does not mean paid\./);
    assert.match(page, /Completed totals come from the execution pipeline\./);
    assert.match(page, /KeeperHub execution happens only after approval\./);
    assert.match(page, /No funds have moved\./);
    assert.match(page, /Unknown is not proof\./);
    assert.match(page, /Agent requests are observability only\./);
    assert.match(page, /Waiting for an owner or approver\./);
  });

  it("unavailable copy directs operators to /dashboard with no ids", () => {
    const page = readFileSync("src/app/app/page.tsx", "utf8");
    assert.match(page, /WORKSPACE DASHBOARD UNAVAILABLE/);
    assert.match(page, /type \/dashboard/);
    const unavailable = page.match(/function DashboardUnavailable\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    assert.equal(unavailable.includes("overview"), false, "unavailable screen must not render overview data");
    assert.equal(unavailable.includes("workspaceId"), false);
    assert.equal(unavailable.includes("claimId"), false);
    assert.equal(unavailable.includes("payoutId"), false);
    assert.equal(unavailable.includes("memberId"), false);
  });

  it("every denied path renders the same unavailable screen", () => {
    const page = readFileSync("src/app/app/page.tsx", "utf8");
    const branches = (page.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
    assert.ok(branches >= 3, `expected >=3 unavailable branches, got ${branches}`);
  });

  it("contains no admin action buttons or execution controls", () => {
    const page = readFileSync("src/app/app/page.tsx", "utf8");
    assert.equal(page.includes('"use client"'), false, "page must be a server component");
    assert.equal(page.includes("<form"), false, "no forms");
    assert.equal(page.includes("action="), false, "no server actions");
    assert.equal(page.includes("onClick"), false, "no client handlers");
    assert.equal(page.includes("<button"), false, "no buttons");
    assert.equal(page.includes("type=\"submit\""), false);
    assert.equal(page.includes("APPROVE"), false, "no approve buttons");
    assert.equal(page.includes("REJECT"), false, "no reject buttons");
  });

  it("page output contains no internal unsafe terms (agent-request label is the only operator term)", () => {
    for (const file of ["src/app/app/page.tsx", "src/app/app/layout.tsx"]) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
    }
  });

  it("no transaction proof renders on the overview", () => {
    const page = readFileSync("src/app/app/page.tsx", "utf8");
    assert.equal(page.includes("txHash"), false);
    assert.equal(page.includes("txExplorerUrl"), false);
    assert.equal(/0x[0-9a-fA-F]{64}/.test(page), false, "hash-shaped literal present");
  });

  it("the session seam never trusts query parameters", () => {
    const session = readFileSync("src/server/dashboard/session.ts", "utf8");
    assert.equal(session.includes("searchParams"), false);
    assert.equal(session.includes("URLSearchParams"), false);
    assert.equal(session.includes("useSearchParams"), false);
    assert.equal(session.includes("window."), false);
  });

  it("the session seam reads identity only from the cookie header", () => {
    const session = readFileSync("src/server/dashboard/session.ts", "utf8");
    assert.match(session, /get\("cookie"\)/);
    assert.match(session, /DASHBOARD_SESSION_COOKIE/);
  });

  it("overview page model is JSON-serializable (plain object contract)", () => {
    const model = readFileSync("src/server/dashboard/overview-page.ts", "utf8");
    assert.match(model, /OverviewPageModel/);
    // The model is a plain data object — no functions/class instances by design.
    assert.equal(model.includes("class "), false);
  });
});
