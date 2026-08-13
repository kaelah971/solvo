import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.10 — Approvals route source contract.
 *
 * The approvals page is a read-only decision queue renderer: no execution/
 * KeeperHub/Telegram/model surface, no approve/reject/execute/retry/reissue
 * controls, no forms or server actions, and only the truthful queue
 * vocabulary.
 */
const PAGE_FILES = ["src/app/app/approvals/page.tsx"];

const MODEL_FILES = [
  "src/server/dashboard/approvals-page.ts",
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
  "provider",
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

describe("approvals route source contract", () => {
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

  it("pages contain the truthful queue copy and honest empty state", () => {
    const page = readFileSync("src/app/app/approvals/page.tsx", "utf8");
    assert.match(page, /This queue shows requests waiting for a human decision\./);
    assert.match(page, /Approving\s+does not execute funds by itself\./);
    assert.match(page, /KeeperHub execution happens only after approval and the existing\s+execution pipeline\./);
    assert.match(page, /Requesters cannot approve their own payout\./);
    assert.match(page, /No pending approvals\./);
    assert.match(page, /Nothing on this page approves, rejects, executes, or reissues\./);
  });

  it("contains role capability copy for every role", () => {
    const page = readFileSync("src/app/app/approvals/page.tsx", "utf8");
    assert.match(page, /model\.capability\.copy/);
    const model = readFileSync("src/server/dashboard/approvals-page.ts", "utf8");
    assert.match(model, /You may approve eligible requests later\./);
    assert.match(model, /Members can view this queue but cannot approve\./);
    assert.match(model, /You requested this payout\. You cannot approve it\./);
    assert.match(model, /You requested this claim\. You cannot approve the claimed destination\./);
  });

  it("links safely to payout/batch/claim detail pages", () => {
    const page = readFileSync("src/app/app/approvals/page.tsx", "utf8");
    assert.match(page, /href=\{`\/app\/payouts\/\$\{item\.payoutId\}`\}/);
    assert.match(page, /href=\{`\/app\/batches\/\$\{item\.payoutId\}`\}/);
    assert.match(page, /href=\{`\/app\/claims\/\$\{item\.claimId\}`\}/);
  });

  it("contains no approve/reject/execute/retry/reissue controls or forms", () => {
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
      assert.equal(source.includes("REISSUE"), false);
    }
  });

  it("page output contains no internal unsafe terms or secrets", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{40}/.test(source), false, `${file} contains an address-shaped literal`);
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
  });

  it("page models never expose execution ids, raw blobs, or secrets", () => {
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

  it("dashboard shell navigation includes Approvals", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app\/approvals"/);
  });

  it("every denied path renders the same unavailable screen", () => {
    const source = readFileSync("src/app/app/approvals/page.tsx", "utf8");
    const branches = (source.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
    assert.ok(branches >= 2, `expected >=2 unavailable branches, got ${branches}`);
  });
});
