import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { handleClaimStatusInstruction } from "../../src/server/telegram/flows/claim-status-flow.ts";
import { parseInstruction } from "../../src/server/telegram/parsing.ts";
import { handleAgentGroupText } from "../../src/server/telegram/flows/agent-flow.ts";
import { getAgentConfig } from "../../src/server/agent/config.ts";
import { SOLVO_COMMANDS } from "../../src/server/telegram/commands.ts";
import type { ClaimLinkRow, WorkspaceMemberRow, WorkspaceRow } from "../../src/server/db/types.ts";
import type { TelegramUser } from "../../src/server/telegram/types.ts";
import { generateClaimTokenPair } from "../../src/server/claim/token.ts";

const CHAIN = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";
const MEMBER = "123456789";
const NOW = "2026-08-13T00:00:00.000Z";
const AFTER_EXPIRY = "2026-08-20T00:00:00.000Z";
const EXPIRES_AT = "2026-08-19T00:00:00.000Z";
const TX_HASH = "0x" + "ab".repeat(32);
const FAKE_HASH = "0x" + "cd".repeat(32);
const BASE_SCAN = `https://basescan.org/tx/${TX_HASH}`;

const BANNED_TERMS = [
  "agent_run",
  "agent run",
  "agent_runs",
  "provider",
  "interpreter",
  "planner",
  "schema",
  "token_hash",
  "tokenHash",
  "token_prefix",
  "idempotency",
  "raw JSON",
  "execution id",
  "keeperhub_execution_id",
  "mcp-client",
  "webhook",
  "node:http",
  '{"',
];

function user(overrides: Partial<TelegramUser> = {}): TelegramUser {
  return {
    userId: MEMBER,
    chatId: "-100777",
    chatType: "supergroup",
    messageId: 42,
    updateId: 1,
    ...overrides,
  };
}

async function makeFixture(overrides: { member?: boolean; mode?: "community" | "sandbox" | "judge" } = {}) {
  const repo = new MemoryRepository();
  const mode = overrides.mode ?? "community";
  const workspace: WorkspaceRow = await repo.createWorkspace({
    mode,
    name: "Claim Status WS",
    telegramChatId: mode === "community" || mode === "sandbox" ? "-100777" : null,
    chainId: CHAIN,
    tokenAddress: TOKEN,
    perTransactionLimitBaseUnits: "100000",
    dailyLimitBaseUnits: "1000000",
    approvalPolicy: "requires_approval",
    status: "active",
  });
  let member: WorkspaceMemberRow | null = null;
  if (overrides.member !== false) {
    await repo.addWorkspaceMember({ workspaceId: workspace.id, telegramUserId: MEMBER, role: "member" });
    member = (await repo.getWorkspaceMember(workspace.id, MEMBER)) as WorkspaceMemberRow;
  }
  return { repo, workspace, member };
}

async function makeClaim(
  repo: MemoryRepository,
  workspace: WorkspaceRow,
  overrides: Partial<{ claimed: boolean; cancelled: boolean }> = {},
): Promise<{ claim: ClaimLinkRow; rawToken: string }> {
  const token = generateClaimTokenPair();
  const claim = await repo.createClaimLink({
    workspaceId: workspace.id,
    requesterId: MEMBER,
    amountBaseUnits: "5000",
    currencySymbol: "USDC",
    chainId: CHAIN,
    tokenAddress: TOKEN,
    tokenHash: token.hash,
    tokenPrefix: token.prefix,
    expiresAt: EXPIRES_AT,
    idempotencyKey: `st-${randomUUID()}`,
  });
  if (overrides.claimed) {
    await repo.claimClaimLink({ claimId: claim.id, recipientAddress: RECIPIENT, claimedBy: "web", nowIso: NOW });
  }
  if (overrides.cancelled) {
    await repo.transitionClaimStatus(claim.id, ["created"], "cancelled");
  }
  return { claim: (await repo.getClaimLinkById(claim.id)) as ClaimLinkRow, rawToken: token.raw };
}

async function approvePipeline(repo: MemoryRepository, workspace: WorkspaceRow, claim: ClaimLinkRow) {
  await repo.transitionClaimStatus(claim.id, ["claimed"], "approved");
  const payout = await repo.createPayout({
    workspaceId: workspace.id,
    requesterId: claim.requester_id,
    sourceType: "claim_link",
    status: "approved",
    totalAmountBaseUnits: claim.amount_base_units,
    currencySymbol: claim.currency_symbol,
    chainId: claim.chain_id,
    tokenAddress: claim.token_address,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: claim.claimed_recipient as string,
    amountBaseUnits: claim.amount_base_units,
    memo: `claim ${claim.token_prefix}`,
    status: "approved",
    idempotencyKey: `cl:${claim.id}`,
  });
  await repo.setClaimPayoutId(claim.id, payout.id);
  return { payoutId: payout.id, itemId: item.id };
}

async function completePipeline(repo: MemoryRepository, workspace: WorkspaceRow, claim: ClaimLinkRow) {
  const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
  await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
  await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
  await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
  await repo.completePayoutItem(itemId, TX_HASH, BASE_SCAN);
  await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
  return { payoutId, itemId };
}

function flowDeps(repo: MemoryRepository, overrides: { now?: () => Date } = {}) {
  return { repo, now: overrides.now ?? (() => new Date(NOW)) };
}

async function runStatus(claimId: string | null, deps: ReturnType<typeof flowDeps>, u = user()) {
  return handleClaimStatusInstruction({ claimId, user: u }, deps);
}

describe("claim status Telegram UX (M11.3) — slash command", () => {
  it("1. /claimstatus on a pending claim shows pending and no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const parsed = parseInstruction(`/claimstatus ${claim.id}`);
    assert.equal(parsed.kind, "claim_status");
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /^CLAIM STATUS FOUND/);
    assert.match(reply.text, /STATE        PENDING/);
    assert.match(reply.text, /No wallet has been entered yet\./);
    assert.match(reply.text, /No funds have moved\./);
    assert.match(reply.text, new RegExp(`CLAIM ID     ${claim.id}`));
    assert.match(reply.text, /AMOUNT       0\.005 USDC/);
  });

  it("2. /claimstatus on a claimed claim shows the masked wallet and approval required", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /CLAIM CLAIMED — APPROVAL REQUIRED/);
    assert.match(reply.text, /WALLET       0x76d7…7486/);
    assert.match(reply.text, /No funds move when a wallet is entered\./);
    assert.match(reply.text, /approve the exact claimed destination/);
    assert.equal(reply.text.includes("0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486"), false, "full wallet must be masked");
  });

  it("3. /claimstatus on an expired claim shows expired and no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const reply = await runStatus(claim.id, flowDeps(repo, { now: () => new Date(AFTER_EXPIRY) }));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /^CLAIM EXPIRED/);
    assert.match(reply.text, /The claim link can no longer be used\./);
    assert.match(reply.text, /No funds moved from this expired claim\./);
  });

  it("4. /claimstatus on a rejected/cancelled claim shows rejected and no funds moved", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { cancelled: true });
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /^CLAIM REJECTED/);
    assert.match(reply.text, /No funds moved from this rejected claim\./);
    assert.equal(reply.text.includes("TX HASH"), false);
  });

  it("5. /claimstatus on an approved claim with a linked payout shows payment prepared and no tx hash", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const { payoutId } = await approvePipeline(repo, workspace, claim);
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /CLAIM APPROVED — PAYMENT PREPARED/);
    assert.match(reply.text, /Approval has prepared the payment\./);
    assert.match(reply.text, new RegExp(`PAYOUT       ${payoutId}`));
    assert.equal(reply.text.includes("TX HASH"), false, "approved must never show a hash");
    assert.equal(/0x[0-9a-fA-F]{64}/.test(reply.text), false);
  });

  it("6. /claimstatus on a completed claim shows completed with the pipeline tx hash and BaseScan", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await completePipeline(repo, workspace, claim);
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /^CLAIM COMPLETED/);
    assert.match(reply.text, new RegExp(`TX HASH      ${TX_HASH}`));
    assert.match(reply.text, new RegExp(`BASESCAN     ${BASE_SCAN}`));
  });

  it("7. a completed-stored claim without a pipeline tx hash never invents proof", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const { payoutId, itemId } = await approvePipeline(repo, workspace, claim);
    await repo.transitionPayoutState(payoutId, ["approved"], "simulating");
    await repo.transitionPayoutState(payoutId, ["simulating"], "submitted");
    await repo.transitionPayoutState(payoutId, ["submitted"], "completed");
    await repo.transitionPayoutItemState(itemId, ["approved"], "simulating");
    await repo.transitionPayoutItemState(itemId, ["simulating"], "submitted");
    await repo.transitionPayoutItemState(itemId, ["submitted"], "completed");
    await repo.transitionClaimStatus(claim.id, ["approved"], "executed");
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "visible");
    assert.match(reply.text, /CLAIM STATUS NOT CONFIRMED/);
    assert.equal(reply.text.includes("TX HASH"), false, "no invented hash");
    assert.equal(/0x[0-9a-fA-F]{64}/.test(reply.text), false);
  });

  it("8. an unknown claim id returns the generic no-leak reply", async () => {
    const { repo } = await makeFixture();
    const reply = await runStatus("00000000-0000-4000-8000-000000000000", flowDeps(repo));
    assert.equal(reply.outcome, "unavailable");
    assert.match(reply.text, /^CLAIM STATUS UNAVAILABLE/);
    assert.match(reply.text, /couldn't find a claim status/);
  });

  it("9. a claim from another workspace returns the same generic no-leak reply", async () => {
    const { repo, workspace } = await makeFixture();
    const otherWorkspace = await repo.createWorkspace({
      mode: "community",
      name: "Other WS",
      telegramChatId: "-100888",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
      status: "active",
    });
    const { claim } = await makeClaim(repo, otherWorkspace);
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(reply.outcome, "unavailable");
    assert.equal(reply.text, (await runStatus(claim.id, flowDeps(repo))).text);
    assert.equal(reply.text.includes(claim.id), false, "must not leak the other-workspace claim id");
    assert.equal(reply.text, await unavailableTextFor(repo));
  });

  it("10. an inactive or non-member returns the same generic no-leak reply", async () => {
    const { repo, workspace } = await makeFixture({ member: false });
    const { claim } = await makeClaim(repo, workspace);
    const outsider = await runStatus(claim.id, flowDeps(repo), user({ userId: "999888777" }));
    assert.equal(outsider.outcome, "unavailable");
    assert.equal(outsider.text.includes(claim.id), false);

    const { repo: repo2, workspace: ws2, member } = await makeFixture();
    const { claim: claim2 } = await makeClaim(repo2, ws2);
    await repo2.removeWorkspaceMember(ws2.id, MEMBER);
    const staleMember = await runStatus(claim2.id, flowDeps(repo2), user({ userId: member?.telegram_user_id ?? MEMBER }));
    assert.equal(staleMember.outcome, "unavailable");
  });

  it("11. a missing claim id asks for one and creates nothing", async () => {
    const { repo } = await makeFixture();
    const parsed = parseInstruction("/claimstatus");
    assert.equal(parsed.kind, "claim_status");
    if (parsed.kind === "claim_status") assert.equal(parsed.claimId, null);
    const snapshot = { claims: repo.claimLinks.size, audits: repo.auditEvents.length, runs: repo.agentRuns.size };
    const reply = await runStatus(null, flowDeps(repo));
    assert.equal(reply.outcome, "usage");
    assert.match(reply.text, /CLAIM STATUS COMMAND/);
    assert.match(reply.text, /\/claimstatus <claim-id>/);
    assert.equal(repo.claimLinks.size, snapshot.claims);
    assert.equal(repo.auditEvents.length, snapshot.audits);
    assert.equal(repo.agentRuns.size, snapshot.runs);
  });

  it("12. raw token and token hash never appear in any status reply", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim, rawToken } = await makeClaim(repo, workspace, { claimed: true });
    const stored = await repo.getClaimLinkById(claim.id);
    assert.ok(stored);
    const replies = [await runStatus(claim.id, flowDeps(repo))];
    const { claim: c2 } = await makeClaim(repo, workspace);
    replies.push(await runStatus(c2.id, flowDeps(repo)));
    for (const reply of replies) {
      assert.equal(reply.text.includes(rawToken), false, "raw token leaked");
      assert.equal(reply.text.includes(stored.token_hash), false, "token hash leaked");
      assert.equal(reply.text.includes(stored.token_prefix), false, "token prefix leaked");
      assert.equal(reply.text.includes(stored.idempotency_key), false, "idempotency key leaked");
    }
  });
});

describe("claim status Telegram UX (M11.3) — natural language", () => {
  it("13. NL 'check claim <id>' works read-only", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    const parsed = parseInstruction(`check claim ${claim.id}`);
    assert.equal(parsed.kind, "claim_status");
    if (parsed.kind === "claim_status") assert.equal(parsed.claimId, claim.id);
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.match(reply.text, /CLAIM STATUS FOUND/);
    assert.equal(repo.agentRuns.size, 0, "NL status must not create agent runs");
  });

  it("14. NL 'what happened to claim <id>' works read-only", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace);
    for (const phrase of [
      `what happened to claim ${claim.id}`,
      `claim status ${claim.id}`,
      `is claim ${claim.id} claimed`,
      `is claim ${claim.id} expired`,
    ]) {
      const parsed = parseInstruction(phrase);
      assert.equal(parsed.kind, "claim_status", phrase);
      if (parsed.kind === "claim_status") assert.equal(parsed.claimId, claim.id);
    }
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.match(reply.text, /CLAIM STATUS FOUND/);
  });

  it("15. NL claim creation still creates a claim link as before", async () => {
    const { repo, workspace } = await makeFixture();
    const parsed = parseInstruction("create a claim link for 0.05 USDC");
    assert.equal(parsed.kind, "failure", "claim creation keeps reaching the agent flow");
    const parsedAmount = parseInstruction("claim 0.05 USDC");
    assert.equal(parsedAmount.kind, "failure", "amount-shaped text must not route to status");
    const reply = await handleAgentGroupText(
      { user: user(), text: "create a claim link for 0.05 USDC" },
      {
        repo,
        config: getAgentConfig({
          SOLVO_AGENT_ENABLED: "true",
          SOLVO_AGENT_MAX_INPUT_CHARS: "5000",
          SOLVO_AGENT_MAX_HOURLY_RUNS_PER_USER: "10",
          SOLVO_AGENT_MAX_DAILY_RUNS_PER_USER: "25",
        }),
        appUrl: "https://solvo.example",
        now: () => new Date(NOW),
      },
    );
    assert.ok(reply);
    assert.match(reply.text, /no funds move/i);
    assert.equal((await repo.listClaimsByWorkspace(workspace.id)).length, 1);
  });

  it("16. slash commands keep priority over NL and never reach the agent", async () => {
    const parsed = parseInstruction(`/claimstatus 550e8400-e29b-41d4-a716-446655440000`);
    assert.equal(parsed.kind, "claim_status");
    const claimPay = parseInstruction("/claimpay 0.05 USDC");
    assert.equal(claimPay.kind, "claim_pay");
    const status = parseInstruction("/status 550e8400-e29b-41d4-a716-446655440000");
    assert.equal(status.kind, "status");
    const invalid = parseInstruction("/claimstatus one two");
    assert.equal(invalid.kind, "failure");
    if (parsed.kind === "claim_status") assert.equal(parsed.claimId, "550e8400-e29b-41d4-a716-446655440000");
  });

  it("17. judge chats and private/DM chats never leak claim status", async () => {
    // Judge-mode workspace is not chat-bound: a chatId never resolves to it.
    const judge = await makeFixture({ mode: "judge", member: false });
    const judgeReply = await runStatus(
      "00000000-0000-4000-8000-000000000000",
      flowDeps(judge.repo),
      user({ chatId: "-100777" }),
    );
    assert.equal(judgeReply.outcome, "unavailable");

    // A sandbox chat-bound workspace cannot see a community claim: the claim
    // lives in a different workspace than the sandbox chat resolves to.
    const sandbox = await makeFixture({ mode: "sandbox" });
    const { repo: sRepo } = sandbox;
    const communityWs = await sRepo.createWorkspace({
      mode: "community",
      name: "Real Claim WS",
      telegramChatId: "-100888",
      chainId: CHAIN,
      tokenAddress: TOKEN,
      perTransactionLimitBaseUnits: "100000",
      dailyLimitBaseUnits: "1000000",
      approvalPolicy: "requires_approval",
      status: "active",
    });
    const { claim } = await makeClaim(sRepo, communityWs);
    const sandboxReply = await runStatus(claim.id, flowDeps(sRepo));
    assert.equal(sandboxReply.outcome, "unavailable");
    assert.equal(sandboxReply.text.includes(claim.id), false);

    // DM chat with no workspace: same generic reply.
    const { repo } = await makeFixture();
    const dm = await runStatus("00000000-0000-4000-8000-000000000000", flowDeps(repo), user({ chatId: "12345678" }));
    assert.equal(dm.outcome, "unavailable");
    assert.equal(dm.text, judgeReply.text);
  });

  it("18. status reads the payout row, never agent_runs", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await completePipeline(repo, workspace, claim);
    const runsBefore = repo.agentRuns.size;
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.equal(repo.agentRuns.size, runsBefore, "status must not create agent runs");
    assert.match(reply.text, /CLAIM COMPLETED/);
  });

  it("19. a forged agent_run cannot inject completion or a fake hash", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    await approvePipeline(repo, workspace, claim);
    const forged = await repo.createAgentRun({
      workspaceId: workspace.id,
      surface: "telegram",
      telegramChatId: "-100777",
      telegramUserId: MEMBER,
      telegramMessageId: "99",
      idempotencyKey: "tg:-100777:m99:agent",
      provider: "static",
      inputHash: "a".repeat(64),
      rawTextRedacted: `transaction_hash ${FAKE_HASH}`,
    });
    await repo.updateAgentRun(forged.id, {
      status: "prepared",
      interpretationJson: { intent: { action: "claimpay" }, intentKind: "create_claim_link", summary: `Claim completed with hash ${FAKE_HASH}` },
      decisionJson: { decision: "prepared_claim_link", transactionHash: FAKE_HASH, completed: true },
    });
    const reply = await runStatus(claim.id, flowDeps(repo));
    assert.match(reply.text, /CLAIM APPROVED — PAYMENT PREPARED/);
    assert.equal(reply.text.includes(FAKE_HASH), false, "forged hash must never surface");
    assert.equal(reply.text.includes("TX HASH"), false);
  });

  it("20. all replies contain no banned internal terms, raw JSON markers, or secrets", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const replies = [
      (await runStatus(claim.id, flowDeps(repo))).text,
      (await runStatus(null, flowDeps(repo))).text,
      (await runStatus("00000000-0000-4000-8000-000000000000", flowDeps(repo))).text,
    ];
    for (const text of replies) {
      for (const banned of BANNED_TERMS) {
        assert.equal(text.includes(banned), false, `reply contains banned term "${banned}"`);
      }
    }
  });

  it("21. status reads create no payout, claim, audit, or execution rows", async () => {
    const { repo, workspace } = await makeFixture();
    const { claim } = await makeClaim(repo, workspace, { claimed: true });
    const sizes = {
      claims: repo.claimLinks.size,
      payouts: repo.payouts.size,
      items: repo.payoutItems.size,
      attempts: repo.executionAttempts.size,
      audits: repo.auditEvents.length,
      runs: repo.agentRuns.size,
    };
    await runStatus(claim.id, flowDeps(repo));
    await runStatus("00000000-0000-4000-8000-000000000000", flowDeps(repo));
    await runStatus(null, flowDeps(repo));
    assert.equal(repo.claimLinks.size, sizes.claims);
    assert.equal(repo.payouts.size, sizes.payouts);
    assert.equal(repo.payoutItems.size, sizes.items);
    assert.equal(repo.executionAttempts.size, sizes.attempts);
    assert.equal(repo.auditEvents.length, sizes.audits);
    assert.equal(repo.agentRuns.size, sizes.runs);
  });

  it("22. the command menu includes claimstatus as a community command", () => {
    const names = SOLVO_COMMANDS.map((command) => command.name);
    assert.equal(names.includes("claimstatus"), true);
    const claimstatus = SOLVO_COMMANDS.find((command) => command.name === "claimstatus");
    assert.equal(claimstatus?.scope, "community");
  });

  it("24. the claim-status flow imports no KeeperHub/execution writer/model provider", () => {
    for (const file of ["src/server/telegram/flows/claim-status-flow.ts", "src/server/claim/messages.ts"]) {
      const source = readFileSync(file, "utf8");
      const imports = source
        .split("\n")
        .filter((line) => line.trim().startsWith("import"))
        .join("\n");
      for (const banned of [
        "execution-service",
        "keeperhub",
        "mcp-client",
        "judge",
        "webhook",
        "openai",
        "anthropic",
        "ai-sdk",
        "node:http",
      ]) {
        assert.equal(imports.includes(banned), false, `${file} imports ${banned}`);
      }
    }
  });
});

async function unavailableTextFor(repo: MemoryRepository): Promise<string> {
  const reply = await runStatus("00000000-0000-4000-8000-000000000000", flowDeps(repo));
  return reply.text;
}
