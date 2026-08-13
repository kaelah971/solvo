import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMembersPageModel,
  buildRecipientsPageModel,
  memberRoleLabel,
  memberStatusLabel,
} from "../../src/server/dashboard/directory-page.ts";
import { makeDashboardContext } from "../../src/server/dashboard/access.ts";
import type { DashboardContext } from "../../src/server/dashboard/types.ts";
import { makeFixture, MEMBER, NOW, OWNER } from "./fixtures.ts";

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

const WALLET = "0x76d7a718ccdc1c132c52d4c05ea0c2fa8e657486";

describe("recipients page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: WALLET, createdBy: MEMBER });
    assert.deepEqual(await buildRecipientsPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildRecipientsPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: WALLET, createdBy: MEMBER });
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildRecipientsPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.items.length, 1);
        assert.equal(model.empty, false);
      }
    }
  });

  it("is workspace-scoped and shows the honest empty state", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId: otherWorkspaceId, alias: "foreign", walletAddress: WALLET, createdBy: MEMBER });
    const model = await buildRecipientsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
    assert.equal(model.empty, true);
  });

  it("shows alias and created/updated timestamps", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId, alias: "endurance", walletAddress: WALLET, createdBy: MEMBER });
    const model = await buildRecipientsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items[0].alias, "endurance");
    assert.equal(model.items[0].createdAt.length > 0, true);
    assert.equal(model.items[0].updatedAt.length > 0, true);
    assert.equal(model.items[0].createdByLabel?.includes("…"), true);
  });

  it("masks wallet addresses for member role, full for owner/approver", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: WALLET, createdBy: MEMBER });

    const member = await buildRecipientsPageModel(repo, ctx("member", workspaceId));
    assert.equal(member.ok, true);
    if (member.ok) assert.equal(member.items[0].wallet, "0x76d7…7486");

    for (const role of ["owner", "approver"] as const) {
      const full = await buildRecipientsPageModel(repo, ctx(role, workspaceId));
      assert.equal(full.ok, true);
      if (full.ok) assert.equal(full.items[0].wallet, WALLET, role);
    }
  });

  it("never exposes cross-workspace recipients", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId: otherWorkspaceId, alias: "sneaky", walletAddress: WALLET, createdBy: MEMBER });
    const model = await buildRecipientsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 0);
  });

  it("page items are JSON-serializable with no token/provider/execution material", async () => {
    const { repo, workspaceId } = await makeFixture();
    await repo.addRecipient({ workspaceId, alias: "blossom", walletAddress: WALLET, createdBy: MEMBER });
    const model = await buildRecipientsPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const roundTrip = JSON.parse(JSON.stringify(model));
    assert.equal(roundTrip.items.length, 1);
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("tokenHash"));
    assert.ok(!serialized.includes("token_prefix"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("interpretation_json"));
    assert.ok(!serialized.includes("decision_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
  });
});

describe("members page model", () => {
  it("nonmember and inactive contexts return the same unavailable result", async () => {
    const { repo, workspaceId } = await makeFixture();
    assert.deepEqual(await buildMembersPageModel(repo, ctx(null, workspaceId)), { ok: false });
    assert.deepEqual(await buildMembersPageModel(repo, ctx("owner", workspaceId, "removed")), { ok: false });
  });

  it("renders for active owner, approver, and member", async () => {
    const { repo, workspaceId } = await makeFixture();
    for (const role of ["owner", "approver", "member"] as const) {
      const model = await buildMembersPageModel(repo, ctx(role, workspaceId));
      assert.equal(model.ok, true, role);
      if (model.ok) {
        assert.equal(model.items.length, 3, role);
        assert.equal(model.empty, false, role);
      }
    }
  });

  it("is workspace-scoped: foreign members never appear", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.addWorkspaceMember({ workspaceId: otherWorkspaceId, telegramUserId: "555666777", role: "owner" });
    const model = await buildMembersPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    assert.equal(model.items.length, 3);
    assert.ok(model.items.every((item) => item.view.maskedId !== "555666777"));
  });

  it("shows masked identities with role and status labels", async () => {
    const { repo, workspaceId } = await makeFixture();
    const model = await buildMembersPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const owner = model.items.find((item) => item.roleLabel === "OWNER");
    assert.ok(owner);
    assert.ok(owner.view.maskedId.includes("…"));
    assert.equal(owner.view.maskedId.includes("111222333"), false, "raw telegram id leaked");
    assert.equal(owner.statusLabel, "ACTIVE");
    assert.equal(owner.view.createdAt.length > 0, true);
    assert.equal(owner.view.updatedAt.length > 0, true);
    assert.equal(model.items.some((item) => item.roleLabel === "APPROVER"), true);
    assert.equal(model.items.some((item) => item.roleLabel === "MEMBER"), true);
  });

  it("never exposes cross-workspace members and stays JSON-serializable", async () => {
    const { repo, workspaceId, otherWorkspaceId } = await makeFixture();
    await repo.addWorkspaceMember({ workspaceId: otherWorkspaceId, telegramUserId: "999000111", role: "owner" });
    const model = await buildMembersPageModel(repo, ctx("owner", workspaceId));
    assert.equal(model.ok, true);
    if (!model.ok) return;
    const serialized = JSON.stringify(model);
    assert.ok(!serialized.includes("999000111"));
    assert.ok(!serialized.includes("token_hash"));
    assert.ok(!serialized.includes("candidates_json"));
    assert.ok(!serialized.includes("keeperhub_execution_id"));
    assert.equal(JSON.parse(JSON.stringify(model)).items.length, 3);
  });

  it("display label helpers map every role and status truthfully", () => {
    assert.equal(memberRoleLabel("owner"), "OWNER");
    assert.equal(memberRoleLabel("approver"), "APPROVER");
    assert.equal(memberRoleLabel("member"), "MEMBER");
    assert.equal(memberStatusLabel("active"), "ACTIVE");
    assert.equal(memberStatusLabel("removed"), "INACTIVE");
  });
});
