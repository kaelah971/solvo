import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.5 — Payout/batch route source contract.
 *
 * The payout pages are read-only renderers: no execution/KeeperHub/Telegram/
 * model surface, no action controls, no fake proof, and only the truthful
 * payout vocabulary.
 */
const PAGE_FILES = [
  "src/app/app/payouts/page.tsx",
  "src/app/app/payouts/[id]/page.tsx",
  "src/app/app/batches/page.tsx",
  "src/app/app/batches/[id]/page.tsx",
];

const MODEL_FILES = [
  "src/server/dashboard/payouts-page.ts",
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
];

describe("payout/batch route source contract", () => {
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
    const payouts = readFileSync("src/app/app/payouts/page.tsx", "utf8");
    assert.match(payouts, /No payout requests yet\./);
    assert.match(payouts, /Approved does not mean\s+executed/);
    const detail = readFileSync("src/app/app/payouts/[id]/page.tsx", "utf8");
    assert.match(detail, /Approved does not mean\s+executed\./);
    assert.match(detail, /Completed proof appears only when the execution pipeline recorded a\s+transaction\./);
    const batches = readFileSync("src/app/app/batches/page.tsx", "utf8");
    assert.match(batches, /No batch payouts yet\./);
    const batchDetail = readFileSync("src/app/app/batches/[id]/page.tsx", "utf8");
    assert.match(batchDetail, /Completed proof appears only when the execution pipeline recorded a\s+transaction\./);
    assert.match(batchDetail, /no approve, reject, or retry controls/);
  });

  it("contains no admin action controls", () => {
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
    }
  });

  it("page output contains no internal unsafe terms", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
    }
  });

  it("proof renders only behind a pipeline-hash guard; no hardcoded hashes", () => {
    for (const file of ["src/app/app/payouts/[id]/page.tsx", "src/app/app/batches/[id]/page.tsx"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /item\.txHash !== null/, `${file} must guard proof rendering`);
      assert.match(source, /item\.txExplorerUrl !== null/, `${file} must guard the explorer link`);
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
    // The list pages never render hashes at all.
    assert.equal(readFileSync("src/app/app/payouts/page.tsx", "utf8").includes("txHash"), false);
    assert.equal(readFileSync("src/app/app/batches/page.tsx", "utf8").includes("txHash"), false);
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

  it("dashboard shell navigation links only implemented sections", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app"/);
    assert.match(layout, /href: "\/app\/approvals"/);
    assert.match(layout, /href: "\/app\/payouts"/);
    assert.match(layout, /href: "\/app\/batches"/);
    assert.match(layout, /href: "\/app\/claims"/);
    assert.match(layout, /href: "\/app\/recipients"/);
    assert.match(layout, /href: "\/app\/members"/);
    assert.match(layout, /href: "\/app\/policies"/);
    assert.match(layout, /href: "\/app\/agent-runs"/);
    assert.match(layout, /href: "\/app\/audit"/);
    // Unimplemented sections must not be linked.
    for (const missing of ["settings"]) {
      assert.equal(layout.includes(`"${missing}"`), false, `layout links to unimplemented section /${missing}`);
    }
  });

  it("the not-found panel is generic and takes no ids", () => {
    const panels = readFileSync("src/components/DashboardPanels.tsx", "utf8");
    assert.match(panels, /REQUEST NOT FOUND/);
    assert.match(panels, /The request does not exist or is outside your workspace\./);
    assert.equal(panels.includes("workspaceId"), false);
    assert.equal(panels.includes("payoutId"), false);
    assert.equal(panels.includes("claimId"), false);
  });
});
