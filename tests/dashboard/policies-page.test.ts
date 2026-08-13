import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExecutionState } from "../../src/server/execution/state-machine.ts";
import {
  buildPolicyPageModel,
  policyApprovalLabel,
  policyCapabilitySummary,
  policyModeNote,
  policyNetworkLabel,
} from "../../src/server/dashboard/policies-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { makeFixture, MEMBER, NOW, OWNER, TOKEN_ADDRESS } from "./fixtures.ts";

function ctx(role: "owner" | "approver" | "member" | null, workspaceId: string, status: "active" | "removed" | null = "active"): DashboardContext {
  return makeDashboardContext({
    workspaceId,
    telegramUserId: role === "owner" ? OWNER : role === "approver" ? "444555666" : role === "member" ? MEMBER : "999888777",
    role,
    status,
    mode: role === null ? null : "community",
    nowIso: NOW,
  });
}

describe("policies page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    assert.deepEqual(await buildPolicyPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildPolicyPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildPolicyPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.modeLabel, "COMMUNITY", role);
        assert.equal(model.statusLabel, "ACTIVE", role);
      }
    }
  });

  it("is workspace-scoped: values come from the operator's workspace row", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.createWorkspace({
      mode: "development",
      name: "Other WS",
      telegramChatId: "-100999",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
      perTransactionLimitBaseUnits: "2000000",
      dailyLimitBaseUnits: "5000000",
      approvalPolicy: "requires_approval",
      status: "active",
    });

    const model = await buildPolicyPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.modeLabel, "COMMUNITY");
    assert.equal(model.perTransactionLimitUsdc, "1");
    assert.equal(model.dailyLimitUsdc, "10");
    void otherWorkspaceId;
  });

  it("displays the workspace mode safely and never the raw token address", async () => {
    const { repo, workspaceId } = await makeFixture();
    const model = await buildPolicyPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.networkLabel, "BASE · USDC");
    assert.equal(JSON.stringify(model).includes(TOKEN_ADDRESS), false, "raw token address leaked");
  });

  it("shows limits, approval requirement, and spent/remaining today truthfully", async () => {
    const { repo, workspaceId } = await makeFixture();
    const { itemId } = await addSpendItem(repo, workspaceId, "completed", "30000");

    const model = await buildPolicyPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.perTransactionLimitUsdc, "1");
    assert.equal(model.dailyLimitUsdc, "10");
    assert.equal(model.approvalPolicyLabel, "REQUIRED");
    assert.equal(model.spentTodayUsdc, "0.03");
    assert.equal(model.remainingTodayUsdc, "9.97");
    void itemId;
  });

  it("never invents a limit that is not stored", async () => {
    const { repo } = await makeFixture();
    const noLimitWs = await repo.createWorkspace({
      mode: "community",
      name: "No limits",
      telegramChatId: "-100000",
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
      perTransactionLimitBaseUnits: null,
      dailyLimitBaseUnits: null,
      approvalPolicy: "requires_approval",
      status: "active",
    });
    const model = await buildPolicyPageModel(repo, ctx("owner", noLimitWs.id));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.perTransactionLimitUsdc, null, "per-tx limit invented");
    assert.equal(model.dailyLimitUsdc, null, "daily limit invented");
    assert.equal(model.remainingTodayUsdc, null, "remaining budget invented without a daily limit");
    assert.equal(model.spentTodayUsdc, "0");
  });

  it("reports the role capability summary per role", async () => {
    const { repo, workspaceId } = await makeFixture();
    const owner = await buildPolicyPageModel(repo, ctx("owner", workspaceId));
    assert.equal(owner.ok, true);
    if (owner.ok) {
      assert.equal(owner.capability.roleLabel, "OWNER");
      assert.match(owner.capability.summary, /manage policies later/);
      assert.match(owner.capability.summary, /not enabled yet/);
    }
    const approver = await buildPolicyPageModel(repo, ctx("approver", workspaceId));
    assert.equal(approver.ok, true);
    if (approver.ok) {
      assert.equal(approver.capability.roleLabel, "APPROVER");
      assert.match(approver.capability.summary, /cannot manage/);
    }
    const member = await buildPolicyPageModel(repo, ctx("member", workspaceId));
    assert.equal(member.ok, true);
    if (member.ok) {
      assert.equal(member.capability.roleLabel, "MEMBER");
      assert.match(member.capability.summary, /view-only/);
    }
  });

  it("mode notes are constant product copy with no env values", async () => {
    assert.match(policyModeNote("judge") ?? "", /\/judgepay/);
    assert.match(policyModeNote("sandbox") ?? "", /no funds move/);
    assert.equal(policyModeNote("community"), null);
    const { repo } = await makeFixture();
    const judgeWs = await repo.createWorkspace({
      mode: "judge",
      name: "Judge WS",
      telegramChatId: null,
      chainId: "8453",
      tokenAddress: TOKEN_ADDRESS,
      perTransactionLimitBaseUnits: "10000",
      dailyLimitBaseUnits: "250000",
      approvalPolicy: "auto_approve_within_judge_policy",
      status: "active",
    });
    const judge = await buildPolicyPageModel(repo, ctx("owner", judgeWs.id));
    assert.equal(judge.ok, true);
    if (judge.ok) {
      assert.equal(judge.modeLabel, "JUDGE");
      assert.equal(judge.approvalPolicyLabel, "JUDGE POLICY");
      assert.ok(judge.modeNote !== null);
    }
    const serialized = JSON.stringify(judge);
    assert.ok(!serialized.includes("JUDGE_MODE_ENABLED"));
    assert.ok(!serialized.includes("TELEGRAM_JUDGE_USER_IDS"));
    assert.ok(!serialized.includes("DATABASE_URL"));
  });

  it("label helpers are pure and never leak addresses or secrets", () => {
    assert.equal(policyNetworkLabel("8453", TOKEN_ADDRESS), "BASE · USDC");
    assert.equal(policyNetworkLabel("8453", TOKEN_ADDRESS.toLowerCase()), "BASE · USDC");
    assert.equal(policyNetworkLabel("1", TOKEN_ADDRESS), "1 · USDC");
    assert.equal(policyNetworkLabel("8453", "0x9999999999999999999999999999999999999999"), "BASE · TOKEN");
    assert.equal(policyApprovalLabel("requires_approval"), "REQUIRED");
    assert.equal(policyApprovalLabel("approval_required"), "REQUIRED");
    assert.equal(policyApprovalLabel("auto_approve_within_judge_policy"), "JUDGE POLICY");
    assert.equal(policyApprovalLabel("something-else"), "NOT CONFIGURED");
    assert.match(policyCapabilitySummary("owner"), /manage policies later/);
    assert.match(policyCapabilitySummary("approver"), /cannot manage/);
    assert.match(policyCapabilitySummary("member"), /view-only/);
  });

  it("page model is JSON-serializable with no internal shapes", async () => {
    const { repo, workspaceId } = await makeFixture();
    const model = await buildPolicyPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(model));
    assert.equal(roundTrip.modeLabel, "COMMUNITY");
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.ok(!serialized.includes("DATABASE_URL"));
    assert.ok(!serialized.includes("sk-"));
  });
});

/** Seed one payout item that counts toward today's spend. */
async function addSpendItem(repo: Awaited<ReturnType<typeof makeFixture>>["repo"], workspaceId: string, status: ExecutionState, amountBaseUnits: string) {
  const payout = await repo.createPayout({
    workspaceId,
    requesterId: MEMBER,
    sourceType: "direct",
    status: "completed",
    totalAmountBaseUnits: amountBaseUnits,
    currencySymbol: "USDC",
    chainId: "8453",
    tokenAddress: TOKEN_ADDRESS,
  });
  const { item } = await repo.createPayoutItem({
    payoutId: payout.id,
    recipientAddress: "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486",
    amountBaseUnits,
    memo: "spend",
    status,
    idempotencyKey: `spend:${workspaceId}:${payout.id}`,
  });
  return { itemId: item.id };
}
