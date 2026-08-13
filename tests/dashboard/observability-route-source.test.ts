import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.9 — Observability route source contract.
 *
 * The agent-runs and audit pages are read-only renderers: no execution/
 * KeeperHub/Telegram/model surface, no action controls, no raw provider/
 * metadata blobs, no tx truth, and only the truthful observability
 * vocabulary.
 *
 * Exception (design doc §13): the agent-runs pages are the one place the
 * internal "provider" label is operator-diagnostic and necessary, so the
 * "provider" output term is waived for those pages only.
 */
const AGENT_RUN_PAGES = [
  "src/app/app/agent-runs/page.tsx",
  "src/app/app/agent-runs/[id]/page.tsx",
];

const AUDIT_PAGE = "src/app/app/audit/page.tsx";

const PAGE_FILES = [...AGENT_RUN_PAGES, AUDIT_PAGE];

const MODEL_FILES = [
  "src/server/dashboard/observability-page.ts",
  "src/server/dashboard/agent-runs.ts",
  "src/server/dashboard/audit.ts",
  "src/server/dashboard/page-gate.ts",
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
  "postgres",
  "node:http",
  "node:https",
  "fetch(",
];

const BANNED_OUTPUT_TERMS = [
  "agent_run",
  "agent run",
  "interpreter",
  "planner",
  "schema",
  "token_hash",
  "tokenHash",
  "token_prefix",
  "tokenPrefix",
  "idempotency",
  "raw JSON",
  "keeperhub_execution_id",
  "execution id",
  "mcp-client",
  "webhook",
  "candidates_json",
  "interpretation_json",
  "decision_json",
  "simulation_result",
  "raw_keeperhub_status",
];

const BANNED_SECRET_TERMS = [
  "DATABASE_URL",
  "API_KEY",
  "BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "KEEPERHUB_API_KEY",
  "KEEPERHUB_MCP_URL",
  "SOLVO_DASHBOARD_COOKIE_SECRET",
  "sk-",
  "Bearer ",
];

describe("observability route source contract", () => {
  it("imports no KeeperHub/MCP/execution writer/Telegram/webhook/model-provider/fetch surface", () => {
    for (const file of [...PAGE_FILES, ...MODEL_FILES]) {
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

  it("agent-runs pages contain the observability-only copy and empty state", () => {
    const list = readFileSync("src/app/app/agent-runs/page.tsx", "utf8");
    assert.match(list, /Agent runs explain how Solvo interpreted a request\./);
    assert.match(list, /Agent runs are\s+not payment proof\./);
    assert.match(list, /Payment truth comes from payouts, claim links,\s+and execution pipeline rows\./);
    assert.match(list, /No agent requests recorded yet\./);
    const detail = readFileSync("src/app/app/agent-runs/[id]/page.tsx", "utf8");
    assert.match(detail, /Observability only\./);
    // The truth note ships from the model constant (types.ts).
    const model = readFileSync("src/server/dashboard/types.ts", "utf8");
    assert.match(model, /Agent runs are observability only\. Payment truth lives in the payout and claim records\./);
  });

  it("audit page contains the truthful timeline copy and empty state", () => {
    const page = readFileSync("src/app/app/audit/page.tsx", "utf8");
    assert.match(page, /Audit events show what Solvo recorded\./);
    assert.match(page, /Audit events do not create\s+payment proof by themselves\./);
    assert.match(page, /Payment proof appears only when the\s+execution pipeline recorded a transaction\./);
    assert.match(page, /No audit events recorded yet\./);
  });

  it("contains no buttons, forms, or server actions", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('"use client"'), false, `${file} must be a server component`);
      assert.equal(source.includes("<form"), false, `${file} has a form`);
      assert.equal(source.includes("action="), false, `${file} has a server action`);
      assert.equal(source.includes("onClick"), false, `${file} has a client handler`);
      assert.equal(source.includes("<button"), false, `${file} has a button`);
      assert.equal(source.includes("type=\"submit\""), false);
      assert.equal(source.includes("APPROVE"), false);
      assert.equal(source.includes("REJECT"), false);
      assert.equal(source.includes("EXECUTE"), false);
      assert.equal(source.includes("RETRY"), false);
    }
  });

  it("page output contains no internal unsafe terms (provider label waived for agent-runs only)", () => {
    // The audit page is NOT the documented exception: no "provider" term.
    const audit = readFileSync("src/app/app/audit/page.tsx", "utf8");
    assert.equal(audit.includes("provider"), false, "audit page contains banned term \"provider\"");
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
  });

  it("page output contains no secret markers", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
    }
  });

  it("no transaction truth renders on observability pages", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("txHash"), false, `${file} renders tx hashes`);
      assert.equal(source.includes("txExplorerUrl"), false, `${file} renders explorer links`);
      assert.equal(source.includes("transaction_hash"), false, `${file} renders raw hash columns`);
    }
  });

  it("page models never expose execution ids, raw blobs, or secret markers", () => {
    for (const file of MODEL_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("keeperhub_execution_id"), false, `${file} exposes execution ids`);
      assert.equal(source.includes("raw_keeperhub_status"), false);
      assert.equal(source.includes("simulation_result"), false);
      assert.equal(source.includes("candidates_json"), false);
      assert.equal(source.includes("interpretation_json"), false);
      assert.equal(source.includes("decision_json"), false);
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
    }
  });

  it("agent-run detail links render only behind model-verified same-workspace guards", () => {
    const detail = readFileSync("src/app/app/agent-runs/[id]/page.tsx", "utf8");
    assert.match(detail, /model\.payoutLink/);
    assert.match(detail, /model\.claimLink/);
    const model = readFileSync("src/server/dashboard/observability-page.ts", "utf8");
    assert.match(model, /payout\.workspace_id === ctx\.workspaceId/, "payout link must verify workspace");
    assert.match(model, /claim\.workspace_id === ctx\.workspaceId/, "claim link must verify workspace");
  });

  it("agent-run and audit pages render the generic not-found/unavailable panels", () => {
    const detail = readFileSync("src/app/app/agent-runs/[id]/page.tsx", "utf8");
    assert.match(detail, /<DashboardNotFound \/>/);
    const listBranches = (source: string) => (source.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
    for (const file of ["src/app/app/agent-runs/page.tsx", "src/app/app/audit/page.tsx"]) {
      const branches = listBranches(readFileSync(file, "utf8"));
      assert.ok(branches >= 3, `${file}: expected >=3 unavailable branches, got ${branches}`);
    }
    assert.ok(listBranches(detail) >= 2, "detail page must render unavailable for every denied path");
    const panels = readFileSync("src/components/DashboardPanels.tsx", "utf8");
    assert.equal(panels.includes("runId"), false);
    assert.equal(panels.includes("workspaceId"), false);
  });

  it("dashboard shell navigation includes Agent Runs and Audit", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app\/agent-runs"/);
    assert.match(layout, /href: "\/app\/audit"/);
  });
});
