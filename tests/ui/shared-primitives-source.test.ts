import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sources = {
  statePanel: readFileSync("src/components/StatePanel.tsx", "utf8"),
  policyRow: readFileSync("src/components/PolicyRow.tsx", "utf8"),
  proofRow: readFileSync("src/components/ProofRow.tsx", "utf8"),
  paymentPreview: readFileSync("src/components/PaymentPreview.tsx", "utf8"),
  batchSummary: readFileSync("src/components/BatchSummary.tsx", "utf8"),
  executionReceipt: readFileSync("src/components/ExecutionReceipt.tsx", "utf8"),
  agentChecks: readFileSync("src/components/AgentChecks.tsx", "utf8"),
  emptyState: readFileSync("src/components/EmptyState.tsx", "utf8"),
  executionLine: readFileSync("src/components/ExecutionLine.tsx", "utf8"),
  sectionLabel: readFileSync("src/components/SectionLabel.tsx", "utf8"),
  statusLabel: readFileSync("src/components/StatusLabel.tsx", "utf8"),
};

const pageSources = {
  claim: readFileSync("src/app/claim/[token]/page.tsx", "utf8"),
  community: readFileSync("src/app/community/page.tsx", "utf8"),
  howItWorks: readFileSync("src/app/how-it-works/page.tsx", "utf8"),
  judge: readFileSync("src/app/judge/page.tsx", "utf8"),
  sandbox: readFileSync("src/app/sandbox/page.tsx", "utf8"),
};

const panelSources = [
  ["StatePanel", sources.statePanel],
  ["PaymentPreview", sources.paymentPreview],
  ["BatchSummary", sources.batchSummary],
  ["ExecutionReceipt", sources.executionReceipt],
  ["AgentChecks", sources.agentChecks],
  ["EmptyState", sources.emptyState],
] as const;

function withoutDecorativeNode(
  source: string,
  pattern: RegExp,
  description: string,
): string {
  const match = source.match(pattern)?.[0];
  assert.ok(match, `expected an explicit decorative ${description} node`);
  return source.replace(match, "");
}

test("panel primitives use translucent continuous surfaces instead of opaque cards", () => {
  for (const [name, source] of panelSources) {
    assert.doesNotMatch(source, /bg-surface/, `${name} should not use bg-surface`);
    assert.match(
      source,
      /border-y border-line bg-white\/\[0\.015\]/,
      `${name} should own a continuous hairline surface`,
    );
  }
});

test("policy and proof rows retain hairline grouping without opaque cards", () => {
  for (const [name, source] of [
    ["PolicyRow", sources.policyRow],
    ["ProofRow", sources.proofRow],
  ] as const) {
    assert.match(source, /(?:hairline-top|border-(?:t|y) border-line|divide-y divide-line)/, `${name} needs a divider`);
    assert.doesNotMatch(source, /bg-surface/, `${name} should not become an opaque card`);
  }
});

test("proof values safely wrap long financial and identifier data", () => {
  const valueNode = sources.proofRow.match(/<dd\b[\s\S]*?>/)?.[0];

  assert.ok(valueNode, "expected ProofRow to render its value in a dd element");
  assert.match(valueNode, /min-w-0/);
  assert.match(valueNode, /data-break/);
});

test("receipt emphasizes proof-critical values without reordering incoming fields", () => {
  assert.match(
    sources.executionReceipt,
    /const emphasized = \["Amount", "Recipient", "Transaction hash"\]\.includes\(field\.label\)/,
  );
  assert.match(sources.executionReceipt, /fields\.map\(\(field\) =>/);
  assert.doesNotMatch(sources.executionReceipt, /fields\.(?:sort|toSorted)\(/);
  assert.match(sources.executionReceipt, /emphasized\s*\?\s*"text-primary"\s*:\s*"text-secondary"/);
});

test("status label continues to render its written label", () => {
  assert.match(sources.statusLabel, /\{label\}/);
});

test("execution line keeps written stage labels and accessible announcements", () => {
  assert.match(sources.executionLine, /aria-live=["']polite["']/);
  assert.match(sources.executionLine, /aria-label=\{announce\}/);
  assert.match(sources.executionLine, /\{stage\.label\}/);
  assert.match(sources.executionLine, /aria-current=/);
});

test("essential primitive copy does not use the faint text token", () => {
  for (const [name, source] of [
    ["StatePanel", sources.statePanel],
    ["ProofRow", sources.proofRow],
    ["PaymentPreview", sources.paymentPreview],
    ["BatchSummary", sources.batchSummary],
    ["AgentChecks", sources.agentChecks],
    ["EmptyState", sources.emptyState],
    ["SectionLabel", sources.sectionLabel],
    ["StatusLabel", sources.statusLabel],
  ] as const) {
    assert.doesNotMatch(source, /text-faint/, `${name} should keep essential copy readable`);
  }

  const policyWithoutIndex = withoutDecorativeNode(
    sources.policyRow,
    /<p className="[^"]*\btext-faint\b[^"]*">\{index\}<\/p>/,
    "policy index",
  );
  assert.doesNotMatch(
    policyWithoutIndex,
    /text-faint/,
    "policy titles and body copy are essential",
  );

  const receiptWithoutReference = withoutDecorativeNode(
    sources.executionReceipt,
    /<p className="[^"]*\btext-faint\b[^"]*">\s*\{reference \?\? ["'][^"']*["']\}\s*<\/p>/,
    "receipt reference",
  );
  assert.doesNotMatch(
    receiptWithoutReference,
    /text-faint/,
    "receipt labels, values, and written status are essential",
  );

  const executionLineWithoutArrow = withoutDecorativeNode(
    sources.executionLine,
    /<span aria-hidden="true" className="[^"]*\btext-faint\b[^"]*">\s*[^<{]*\s*<\/span>/,
    "execution arrow",
  );
  assert.doesNotMatch(
    executionLineWithoutArrow,
    /text-faint/,
    "rendered execution stage labels are essential written state",
  );

  for (const [name, openingTag] of [
    ["policy title", sources.policyRow.match(/<h3\b[^>]*>/)?.[0]],
    ["proof label", sources.proofRow.match(/<dt\b[\s\S]*?>/)?.[0]],
    ["proof value", sources.proofRow.match(/<dd\b[\s\S]*?>/)?.[0]],
    [
      "receipt value",
      sources.executionReceipt.match(/<span className=\{emphasized[\s\S]*?>/)?.[0],
    ],
    [
      "execution stage label",
      sources.executionLine.match(/<span\s+aria-current=[\s\S]*?>/)?.[0],
    ],
  ] as const) {
    assert.ok(openingTag, `expected rendered ${name} node`);
    assert.doesNotMatch(openingTag, /text-faint/, `${name} should remain readable`);
  }
});

test("essential page-level notices do not use the faint text token", () => {
  for (const [name, source, copy] of [
    ["claim availability", pageSources.claim, "Input is disabled until claims are connected"],
    ["community payout state", pageSources.community, "A real payout summary appears here"],
    ["execution-line explanation", pageSources.howItWorks, "Every stage is a real product state"],
    ["judge availability", pageSources.judge, "Available after configuration"],
    ["sandbox availability", pageSources.sandbox, "Simulation is unavailable until"],
    ["sandbox safety", pageSources.sandbox, "Simulated results always state"],
    ["sandbox boundary", pageSources.sandbox, "The sandbox cannot access"],
  ] as const) {
    const copyIndex = source.indexOf(copy);
    assert.notEqual(copyIndex, -1, `expected ${name} copy`);

    const openingTag = source.lastIndexOf("<p", copyIndex);
    const closingTag = source.indexOf(">", openingTag);
    const tag = source.slice(openingTag, closingTag + 1);
    assert.doesNotMatch(tag, /text-faint/, `${name} should keep essential copy readable`);
  }
});
