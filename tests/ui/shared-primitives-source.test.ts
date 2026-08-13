import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const primitives = {
  statePanel: read("src/components/StatePanel.tsx"),
  paymentPreview: read("src/components/PaymentPreview.tsx"),
  batchSummary: read("src/components/BatchSummary.tsx"),
  executionReceipt: read("src/components/ExecutionReceipt.tsx"),
  executionLine: read("src/components/ExecutionLine.tsx"),
  proofRow: read("src/components/ProofRow.tsx"),
  statusLabel: read("src/components/StatusLabel.tsx"),
};

const publicPages = [
  "community",
  "individuals",
  "how-it-works",
  "security",
  "judge",
  "sandbox",
].map((route) => [route, read(`src/app/${route}/page.tsx`)] as const);

test("public surfaces use the shared black/orange content-panel system", () => {
  for (const [route, source] of publicPages) {
    assert.match(source, /(?:page-hero|content-panel)/, `${route} needs a public panel surface`);
    assert.match(source, /rounded-\[(?:28|32)px\]/, `${route} needs the approved rounded panel family`);
    assert.match(source, /border-border/, `${route} needs the shared panel border`);
    assert.match(source, /bg-surface/, `${route} needs the shared dark surface`);
  }
});

test("financial primitives expose accessible names and written states", () => {
  assert.match(primitives.paymentPreview, /aria-label="Payment request preview"/);
  assert.match(primitives.batchSummary, /aria-label="Payout batch summary"/);
  assert.match(primitives.executionReceipt, /aria-label="Solvo Execution Receipt"/);
  assert.match(primitives.statusLabel, /\{label\}/);
  assert.match(primitives.executionLine, /aria-live="polite"/);
  assert.match(primitives.executionLine, /aria-current=/);
  assert.match(primitives.executionLine, /\{stage\.label\}/);
});

test("long proof values remain semantic, readable, and safely wrappable", () => {
  assert.match(primitives.proofRow, /<dt\b/);
  assert.match(primitives.proofRow, /<dd\b/);
  assert.match(primitives.proofRow, /data-break/);
  assert.match(primitives.proofRow, /min-w-0/);
});

test("payment preview shows destination and amount before approval and never enables placeholder actions", () => {
  const to = primitives.paymentPreview.indexOf('<ProofRow label="To"');
  const amount = primitives.paymentPreview.indexOf('<ProofRow label="Amount"');
  const approval = primitives.paymentPreview.indexOf('<ProofRow label="Approval"');

  assert.ok(to >= 0 && amount > to && approval > amount);
  assert.match(primitives.paymentPreview, /<Cta disabled>Approve<\/Cta>/);
  assert.match(primitives.paymentPreview, /<Cta disabled>Cancel<\/Cta>/);
  assert.match(primitives.paymentPreview, /This preview is not connected yet/);
});

test("batch and receipt defaults never invent financial data", () => {
  assert.match(primitives.batchSummary, /recipients = null/);
  assert.match(primitives.batchSummary, /total = null/);
  assert.match(primitives.batchSummary, /statusLabel = "No payout loaded"/);
  assert.match(primitives.batchSummary, /value=\{(?:recipients|total) \?\? "—"\}/);
  assert.match(primitives.executionReceipt, /reference = null/);
  assert.match(primitives.executionReceipt, /\{reference \?\? "—"\}/);
});

test("receipt preserves input order and emphasizes proof-critical values", () => {
  assert.match(primitives.executionReceipt, /fields\.map\(\(field\) =>/);
  assert.doesNotMatch(primitives.executionReceipt, /fields\.(?:sort|toSorted)\(/);
  assert.match(
    primitives.executionReceipt,
    /\["Amount", "Recipient", "Transaction hash"\]\.includes\(field\.label\)/,
  );
});

test("public financial copy distinguishes simulation, execution, and proof", () => {
  const howItWorks = publicPages.find(([route]) => route === "how-it-works")?.[1] ?? "";
  const security = publicPages.find(([route]) => route === "security")?.[1] ?? "";

  assert.match(howItWorks, /Simulation complete\. No funds were moved\./);
  assert.match(howItWorks, /The transaction hash and audit record are the completion state\./);
  assert.match(security, /A simulation is never called a transaction\./);
  assert.match(security, /No payment is complete until it is proved\./);
});
