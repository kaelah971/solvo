import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consumeDashboardLoginToken,
  createDashboardLoginLink,
  DASHBOARD_LOGIN_EXPIRY_MINUTES,
  dashboardLoginTokenIsWellFormed,
  hashDashboardLoginToken,
  issueDashboardSessionFromLoginToken,
  verifyDashboardLoginToken,
} from "../../src/server/dashboard/login-links.ts";
import {
  buildDashboardSessionCookieValue,
  parseDashboardSessionCookie,
  requireDashboardContext,
} from "../../src/server/dashboard/session.ts";
import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { makeWorkspace, NOW, OUTSIDER, OWNER } from "./fixtures.ts";

const SECRET = "test-secret";
const APP_URL = "https://solvo.example";
const FIVE_MIN = new Date(new Date(NOW).getTime() + 5 * 60 * 1000).toISOString();
const AFTER_TEN = new Date(new Date(NOW).getTime() + 11 * 60 * 1000).toISOString();

async function issueLink(
  repo: MemoryRepository,
  workspaceId: string,
  user = OWNER,
  role: "owner" | "approver" | "member" = "owner",
) {
  return createDashboardLoginLink({
    repo,
    workspaceId,
    telegramUserId: user,
    memberId: "member-row",
    role,
    nowIso: NOW,
    appUrl: APP_URL,
  });
}

describe("dashboard login links (token service)", () => {
  it("creates a high-entropy raw token and returns it exactly once", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(dashboardLoginTokenIsWellFormed(result.token));
    // base64url of 32 CSPRNG bytes → ≥256 bits of entropy.
    assert.ok(result.token.length >= 43);
    assert.ok(result.link.startsWith(`${APP_URL}/auth/telegram-link?token=`));
    assert.ok(result.link.includes(result.token));
    assert.equal(result.expiresAt, new Date(new Date(NOW).getTime() + 10 * 60 * 1000).toISOString());
    assert.equal(repo.dashboardLoginTokens.size, 1);
  });

  it("stores only the token hash — the raw token never appears in storage", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const stored = [...repo.dashboardLoginTokens.values()][0];
    assert.equal(stored.token_hash, hashDashboardLoginToken(result.token));
    assert.notEqual(stored.token_hash, result.token);
    assert.ok(!JSON.stringify(stored).includes(result.token));
  });

  it("verifies a valid token and rejects unknown tokens", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const valid = await verifyDashboardLoginToken(repo, result.token, FIVE_MIN);
    assert.equal(valid.ok, true);
    if (valid.ok) {
      assert.equal(valid.record.workspace_id, workspaceId);
      assert.equal(valid.record.telegram_user_id, OWNER);
      assert.equal(valid.record.member_id, "member-row");
      assert.equal(valid.record.role, "owner");
    }

    assert.deepEqual(await verifyDashboardLoginToken(repo, "not-a-real-token-value-xxxxxxxxxxxxxxxxxxxxxxxxx", NOW), {
      ok: false,
      kind: "unknown",
    });
    assert.deepEqual(await verifyDashboardLoginToken(repo, "short", NOW), { ok: false, kind: "unknown" });
  });

  it("rejects expired tokens", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(await verifyDashboardLoginToken(repo, result.token, AFTER_TEN), { ok: false, kind: "expired" });
  });

  it("rejects used tokens", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const consumed = await consumeDashboardLoginToken(repo, result.token, FIVE_MIN);
    assert.ok(consumed);
    assert.deepEqual(await verifyDashboardLoginToken(repo, result.token, FIVE_MIN), { ok: false, kind: "used" });
  });

  it("consumes a token exactly once; a second consume fails", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const first = await consumeDashboardLoginToken(repo, result.token, FIVE_MIN);
    assert.ok(first);
    assert.equal(first.used_at, FIVE_MIN);
    const second = await consumeDashboardLoginToken(repo, result.token, AFTER_TEN);
    assert.equal(second, null);
  });

  it("tokens are scoped to workspace + user + member; role is stored", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const approver = await createDashboardLoginLink({
      repo,
      workspaceId,
      telegramUserId: "444555666",
      memberId: "member-approver",
      role: "approver",
      nowIso: NOW,
      appUrl: APP_URL,
    });
    assert.equal(approver.ok, true);
    if (!approver.ok) return;
    const verified = await verifyDashboardLoginToken(repo, approver.token, FIVE_MIN);
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.record.telegram_user_id, "444555666");
      assert.equal(verified.record.member_id, "member-approver");
      assert.equal(verified.record.role, "approver");
    }
  });

  it("raw tokens never appear in audit metadata or error paths", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(repo.auditEvents.length, 0, "token creation writes no audit rows");
    // The raw token appears in the returned link (by design) and nowhere else.
    for (const stored of repo.dashboardLoginTokens.values()) {
      assert.ok(!JSON.stringify(stored).includes(result.token), "raw token persisted");
    }
  });
});

describe("issueDashboardSessionFromLoginToken", () => {
  it("valid token sets a signed HttpOnly SameSite=Strict session cookie and redirects to /app", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const session = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: result.token,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(session.kind, "redirect");
    if (session.kind !== "redirect") return;
    assert.equal(session.redirectTo, "/app");
    assert.equal(session.cookie.name, "solvo_dash_session");
    assert.equal(session.cookie.attributes.httpOnly, true);
    assert.equal(session.cookie.attributes.sameSite, "strict");
    assert.equal(session.cookie.attributes.secure, true);
    assert.equal(session.cookie.attributes.maxAge, 7 * 24 * 60 * 60);
    // The token is consumed exactly once.
    assert.deepEqual(await verifyDashboardLoginToken(repo, result.token, FIVE_MIN), { ok: false, kind: "used" });
    // The cookie is payload.signature and parses back to the session.
    assert.equal(session.cookie.value.split(".").length, 2);
    const parsed = parseDashboardSessionCookie(`solvo_dash_session=${session.cookie.value}`, SECRET);
    assert.deepEqual(parsed, { workspaceId, telegramUserId: OWNER });
  });

  it("invalid, expired, and used tokens all return the same unavailable result", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const expired = await issueLink(repo, workspaceId);
    const used = await issueLink(repo, workspaceId);
    assert.equal(expired.ok, true);
    assert.equal(used.ok, true);
    if (!expired.ok || !used.ok) return;

    await consumeDashboardLoginToken(repo, used.token, FIVE_MIN);

    const invalid = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: "malformed-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    const expiredResult = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: expired.token,
      nowIso: AFTER_TEN,
      secret: SECRET,
      secureCookie: true,
    });
    const usedResult = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: used.token,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(invalid, { kind: "unavailable" });
    assert.deepEqual(expiredResult, { kind: "unavailable" });
    assert.deepEqual(usedResult, { kind: "unavailable" });
  });

  it("nonmember or inactive member never gets a session, and the token is not consumed", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const outsider = await issueLink(repo, workspaceId, OUTSIDER, "member");
    assert.equal(outsider.ok, true);
    if (!outsider.ok) return;

    const result = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: outsider.token,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(result, { kind: "unavailable" });
    // The token was NOT consumed — still unused and valid.
    const stillValid = await verifyDashboardLoginToken(repo, outsider.token, FIVE_MIN);
    assert.equal(stillValid.ok, true);
    if (stillValid.ok) assert.equal(stillValid.record.used_at, null);

    // Removed member: token issued while active, then membership removed.
    const ownerToken = await issueLink(repo, workspaceId, OWNER, "owner");
    assert.equal(ownerToken.ok, true);
    if (!ownerToken.ok) return;
    await repo.removeWorkspaceMember(workspaceId, OWNER);
    const removedResult = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: ownerToken.token,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.deepEqual(removedResult, { kind: "unavailable" });
  });

  it("issued session survives a fresh /app membership re-check; removal kills it", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    const result = await issueLink(repo, workspaceId);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const issued = await issueDashboardSessionFromLoginToken({
      repo,
      rawToken: result.token,
      nowIso: FIVE_MIN,
      secret: SECRET,
      secureCookie: true,
    });
    assert.equal(issued.kind, "redirect");
    if (issued.kind !== "redirect") return;

    // Simulate the /app flow: cookie → session → repo re-check.
    const session = parseDashboardSessionCookie(`solvo_dash_session=${issued.cookie.value}`, SECRET);
    assert.deepEqual(session, { workspaceId, telegramUserId: OWNER });
    const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.equal(required.ok, true);
    if (required.ok) assert.equal(required.ctx.role, "owner");

    // Removed member loses access even with the still-valid cookie.
    await repo.removeWorkspaceMember(workspaceId, OWNER);
    const afterRemoval = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.deepEqual(afterRemoval, { ok: false });
  });

  it("a cookie claiming another workspace is rejected by the membership re-check", async () => {
    const repo = new MemoryRepository();
    const workspaceId = await makeWorkspace(repo);
    // A second workspace where OWNER is NOT a member.
    const foreign = await repo.createWorkspace({
      mode: "community",
      name: "Foreign WS",
      telegramChatId: "-100888",
      chainId: "8453",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      perTransactionLimitBaseUnits: "1000000",
      dailyLimitBaseUnits: "10000000",
      approvalPolicy: "approval_required",
    });
    void workspaceId;

    // A perfectly signed cookie pointing at the foreign workspace must fail
    // the repo membership re-check on /app.
    const forgedValue = buildDashboardSessionCookieValue({ workspaceId: foreign.id, telegramUserId: OWNER }, SECRET);
    const session = parseDashboardSessionCookie(`solvo_dash_session=${forgedValue}`, SECRET);
    assert.deepEqual(session, { workspaceId: foreign.id, telegramUserId: OWNER });
    const required = await requireDashboardContext({ repo, session, nowIso: FIVE_MIN });
    assert.deepEqual(required, { ok: false });
  });

  it("DASHBOARD_LOGIN_EXPIRY_MINUTES matches the Telegram reply copy", () => {
    assert.equal(DASHBOARD_LOGIN_EXPIRY_MINUTES, 10);
  });
});
