import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * M12.7 — Recipient/member route source contract.
 *
 * The directory pages are read-only renderers: no execution/KeeperHub/
 * Telegram/model surface, no add/edit/delete/role-change controls, no raw
 * identity data, and only the truthful directory vocabulary.
 */
const PAGE_FILES = [
  "src/app/app/recipients/page.tsx",
  "src/app/app/members/page.tsx",
];

const MODEL_FILES = [
  "src/server/dashboard/directory-page.ts",
  "src/server/dashboard/recipients.ts",
  "src/server/dashboard/members.ts",
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

describe("directory route source contract", () => {
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
    const recipients = readFileSync("src/app/app/recipients/page.tsx", "utf8");
    assert.match(recipients, /No recipients saved yet\./);
    assert.match(recipients, /Recipients are saved aliases\. Saving an alias does not move\s+funds\./);
    assert.match(recipients, /Payments still require approval and KeeperHub execution\./);
    const members = readFileSync("src/app/app/members/page.tsx", "utf8");
    assert.match(members, /Roles control what people can request, approve, and manage\./);
    assert.match(members, /Separation of duty is enforced server-side: requesters cannot\s+approve their own payout\./);
    assert.match(members, /Changing roles is not enabled from the\s+dashboard yet\./);
  });

  it("contains no add/edit/delete/role-change controls or forms", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      assert.equal(source.includes('"use client"'), false, `${file} must be a server component`);
      assert.equal(source.includes("<form"), false, `${file} has a form`);
      assert.equal(source.includes("action="), false, `${file} has a server action`);
      assert.equal(source.includes("onClick"), false, `${file} has a client handler`);
      assert.equal(source.includes("<button"), false, `${file} has a button`);
      assert.equal(source.includes("type=\"submit\""), false);
      assert.equal(source.includes("ADD"), false);
      assert.equal(source.includes("EDIT"), false);
      assert.equal(source.includes("REMOVE"), false);
      assert.equal(source.includes("DELETE"), false);
      assert.equal(source.includes("CHANGE ROLE"), false);
      assert.equal(source.includes("APPROVE"), false);
      assert.equal(source.includes("REJECT"), false);
      assert.equal(source.includes("EXECUTE"), false);
    }
  });

  it("page output contains no internal unsafe terms", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      for (const banned of BANNED_OUTPUT_TERMS) {
        assert.equal(source.includes(banned), false, `${file} contains banned term "${banned}"`);
      }
      assert.equal(/0x[0-9a-fA-F]{64}/.test(source), false, `${file} contains a hash-shaped literal`);
    }
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

  it("dashboard shell navigation includes Recipients and Members", () => {
    const layout = readFileSync("src/app/app/layout.tsx", "utf8");
    assert.match(layout, /href: "\/app\/recipients"/);
    assert.match(layout, /href: "\/app\/members"/);
  });

  it("every denied path renders the same unavailable screen", () => {
    for (const file of PAGE_FILES) {
      const source = readFileSync(file, "utf8");
      const branches = (source.match(/return <DashboardUnavailable \/>;/g) ?? []).length;
      assert.ok(branches >= 3, `${file}: expected >=3 unavailable branches, got ${branches}`);
    }
  });
});
