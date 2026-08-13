import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.8 — Policies route source contract.
 *
 * The policies page is a read-only renderer: no execution/KeeperHub/Telegram/
 * model surface, no edit/save/apply controls, no env secrets, and only the
 * truthful policy vocabulary. Limit fields render only from the model (null
 * when not stored) — nothing is invented inline.
 */
const PAGE_FILES = ["src/app/app/policies/page.tsx"];

const MODEL_FILES = [
  "src/server/dashboard/policies-page.ts",
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
  "JUDGE_MODE_ENABLED",
  "TELEGRAM_JUDGE_USER_IDS",
  "SOLVO_DASHBOARD_COOKIE_SECRET",
  "sk-",
  "Bearer ",
];

describe("policies route source contract", () => {
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

  it("pages contain the truthful policy copy", () => {
    const page = readFileSync("src/app/app/policies/page.tsx", "utf8");
    assert.match(page, /Policies explain what Solvo will allow\. This page does not change\s+them\./);
    assert.match(page, /Approval and execution still happen through the existing\s+Solvo pipeline\./);
    assert.match(page, /KeeperHub execution happens only after approval\./);
    assert.match(page, /Separation of duty is enforced server-side:/);
    assert.match(page, /requesters cannot\s+approve their own payout\./);
    assert.match(page, /Editing limits and policies is not enabled\s+yet/);
    assert.match(page, /policy changes will be audited when enabled later\./);
  });

  it("pages contain claim-link safety copy", () => {
    const page = readFileSync("src/app/app/policies/page.tsx", "utf8");
    assert.match(page, /Wallet entered does not mean funds moved\./);
    assert.match(page, /Claim approval prepares a payment; it does not execute one by itself\./);
    assert.match(page, /Raw claim links are shown once and cannot be redisplayed\./);
    assert.match(page, /Reissue action is not enabled from the dashboard yet\./);
  });

  it("contains no edit/save/apply controls or forms", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('"use client"'), false, `${file} must be a server component`);
      assert.equal(source.includes("<form"), false, `${file} has a form`);
      assert.equal(source.includes("action="), false, `${file} has a server action`);
      assert.equal(source.includes("onClick"), false, `${file} has a client handler`);
      assert.equal(source.includes("<button"), false, `${file} has a button`);
      assert.equal(source.includes("type=\"submit\""), false);
      assert.equal(source.includes("<input"), false, `${file} has an input`);
      assert.equal(source.includes("<select"), false, `${file} has a select`);
      assert.equal(source.includes("<textarea"), false, `${file} has a textarea`);
      assert.equal(source.includes("EDIT"), false);
      assert.equal(source.includes("SAVE"), false);
      assert.equal(source.includes("APPLY"), false);
      assert.equal(source.includes("APPROVE"), false);
      assert.equal(source.includes("REJECT"), false);
      assert.equal(source.includes("EXECUTE"), false);
    }
  });

  it("page output contains no internal unsafe terms or secret values", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      for (const secret of BANNED_SECRET_TERMS) {
        assert.equal(source.includes(secret), false, `${file} contains secret marker "${secret}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{40}/.test(source), false, `${file} contains an address-shaped literal`);
    }
  });

  it("page models never expose execution ids, raw blobs, or secret values", () => {
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

  it("limit display always flows from the model (null never fabricated inline)", () => {
    const page = readFileSync("src/app/app/policies/page.tsx", "utf8");
    assert.match(page, /Not configured/);
    assert.match(page, /model\.perTransactionLimitUsdc/);
    assert.match(page, /model\.dailyLimitUsdc/);
    assert.match(page, /model\.remainingTodayUsdc/);
    assert.equal(page.includes("1000000"), false, "hardcoded base-unit literals present");
  });

  it("dashboard shell navigation includes Policies", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app\/policies"/);
  });

  it("every denied path renders the same unavailable screen", () => {
    const source = readFileSync("src/app/app/policies/page.tsx", "utf8");
    const branches = (source.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
    assert.ok(branches >= 3, `expected >=3 unavailable branches, got ${branches}`);
  });
});
