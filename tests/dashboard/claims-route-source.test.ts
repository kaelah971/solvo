import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.6 — Claim route source contract.
 *
 * The claim pages are read-only renderers: no execution/KeeperHub/Telegram/
 * model surface, no action controls (including no reissue button), no fake
 * proof, and only the truthful claim vocabulary. Raw claim tokens, hashes,
 * and prefixes never reach page output.
 */
const PAGE_FILES = [
  "src/app/app/claims/page.tsx",
  "src/app/app/claims/[id]/page.tsx",
];

const MODEL_FILES = [
  "src/server/dashboard/claims-page.ts",
  "src/server/dashboard/claims.ts",
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

describe("claim route source contract", () => {
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

  it("pages contain the truthful copy and honest empty states", () => {
    const list = readFileSync("src/app/app/claims/page.tsx", "utf8");
    assert.match(list, /No claim links yet\./);
    assert.match(list, /Entering a wallet never\s+moves\s+funds/);
    const detail = readFileSync("src/app/app/claims/[id]/page.tsx", "utf8");
    assert.match(detail, /Wallet entered does not mean funds moved\./);
    assert.match(detail, /Claim approval prepares a payment; it does not execute one by itself\./);
    assert.match(detail, /Completed proof appears only when the execution pipeline recorded a\s+transaction\./);
    assert.match(detail, /Raw claim links are shown once and cannot be\s+redisplayed\./);
    assert.match(detail, /No pipeline transaction proof to show\./);
  });

  it("reissue eligibility is display-only: no button, form, or action", () => {
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
      assert.equal(source.includes("RETRY"), false);
      assert.equal(source.includes("EXECUTE"), false);
      assert.equal(source.includes("REISSUE"), false, `${file} renders an uppercase reissue control`);
    }
    const detail = readFileSync("src/app/app/claims/[id]/page.tsx", "utf8");
    assert.match(detail, /Reissue action will be enabled after the claim reissue\s+migration is applied and admin actions are wired\./);
  });

  it("page output contains no internal unsafe terms or token material", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
  });

  it("proof renders only behind a pipeline-hash guard; list pages never render hashes", () => {
    const detail = readFileSync("src/app/app/claims/[id]/page.tsx", "utf8");
    assert.match(detail, /statusView\.txHash !== null/, "detail must guard proof rendering");
    assert.match(detail, /statusView\.txExplorerUrl !== null/, "detail must guard the explorer link");
    assert.equal(readFileSync("src/app/app/claims/page.tsx", "utf8").includes("txHash"), false);
  });

  it("page models never expose execution ids or raw blobs", () => {
    for (const file of MODEL_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes("keeperhub_execution_id"), false, `${file} exposes execution ids`);
      assert.equal(source.includes("raw_keeperhub_status"), false);
      assert.equal(source.includes("simulation_result"), false);
      assert.equal(source.includes("candidates_json"), false);
      assert.equal(source.includes("interpretation_json"), false);
      assert.equal(source.includes("decision_json"), false);
    }
  });

  it("dashboard shell navigation includes Claims", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app\/claims"/);
  });

  it("the claim detail page renders the generic not-found panel with no ids", () => {
    const detail = readFileSync("src/app/app/claims/[id]/page.tsx", "utf8");
    assert.match(detail, /<DashboardNotFound \/>/);
    const panels = readFileSync("src/components/DashboardPanels.tsx", "utf8");
    assert.match(panels, /REQUEST NOT FOUND/);
    assert.equal(panels.includes("claimId"), false);
    assert.equal(panels.includes("workspaceId"), false);
  });
});
