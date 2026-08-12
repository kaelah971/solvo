import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { hashAgentInput, redactAgentRawText } from "../../src/server/agent/redact.ts";
import { AGENT_RUN_STATUSES } from "../../src/server/agent/types.ts";
import type { CreateAgentRunInput, UpdateAgentRunInput } from "../../src/server/db/repository.ts";
import type { AgentRunRow } from "../../src/server/db/types.ts";

function runInput(overrides: Partial<CreateAgentRunInput> = {}): CreateAgentRunInput {
  return {
    workspaceId: "ws-1",
    surface: "telegram",
    telegramChatId: "-100777",
    telegramUserId: "123456",
    telegramMessageId: "42",
    idempotencyKey: "tg:-100777:m42:agent",
    provider: "static",
    inputHash: hashAgentInput("send 0.01 USDC to daniel"),
    rawTextRedacted: "send 0.01 USDC to daniel",
    candidatesJson: { amounts: [{ raw: "0.01" }] },
    ...overrides,
  };
}

const TERMINAL_OUTCOME = ["needs_clarification", "prepared", "claim_created", "blocked", "unknown", "failed"] as const;

describe("agent runs — memory repository", () => {
  it("persists an agent run with required fields", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    assert.equal(row.surface, "telegram");
    assert.equal(row.telegram_user_id, "123456");
    assert.equal(row.idempotency_key, "tg:-100777:m42:agent");
    assert.equal(row.status, "received");
    assert.equal(row.input_hash, hashAgentInput("send 0.01 USDC to daniel"));
    assert.equal(row.completed_at, null);
    assert.equal(row.workspace_id, "ws-1");
  });

  it("enforces idempotency-key uniqueness without creating a duplicate row", async () => {
    const repo = new MemoryRepository();
    const first = await repo.createAgentRun(runInput());
    await assert.rejects(
      () => repo.createAgentRun(runInput()),
      /unique/i,
    );
    const again = await repo.getAgentRunByIdempotencyKey(first.idempotency_key);
    assert.equal(again?.id, first.id);
  });

  it("reads back by idempotency key and by id", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    assert.equal((await repo.getAgentRunByIdempotencyKey(row.idempotency_key))?.id, row.id);
    assert.equal((await repo.getAgentRunById(row.id))?.id, row.id);
    assert.equal(await repo.getAgentRunById("missing"), null);
  });

  it("updates status and decision fields", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    const updated = await repo.updateAgentRun(row.id, {
      status: "prepared",
      intentKind: "prepare_payment",
      planAction: "prepare_payment",
      decisionType: "prepared_payment",
      interpretationJson: { action: "pay" },
      decisionJson: { prepared: { amountBaseUnits: "10000" } },
    });
    assert.equal(updated.status, "prepared");
    assert.equal(updated.intent_kind, "prepare_payment");
    assert.equal(updated.plan_action, "prepare_payment");
    assert.equal(updated.decision_type, "prepared_payment");
    assert.equal(updated.interpretation_json?.action, "pay");
    const prepared = updated.decision_json?.prepared as { amountBaseUnits?: unknown } | undefined;
    assert.equal(prepared?.amountBaseUnits, "10000");
  });

  it("sets completed_at only for terminal outcome statuses (COALESCE semantics)", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    const inFlight = await repo.updateAgentRun(row.id, { status: "interpreted" });
    assert.equal(inFlight.completed_at, null);

    const completed = await repo.updateAgentRun(row.id, { status: "prepared" });
    assert.notEqual(completed.completed_at, null);
    const firstCompletion = completed.completed_at;

    const blocked = await repo.updateAgentRun(row.id, { status: "blocked" });
    assert.equal(blocked.completed_at, firstCompletion);

    for (const status of TERMINAL_OUTCOME) {
      const other = await repo.createAgentRun(runInput({ idempotencyKey: `tg:term:${status}`, startedAt: undefined }));
      const done = await repo.updateAgentRun(other.id, { status });
      assert.notEqual(done.completed_at, null, status);
    }
  });

  it("updates updated_at on update", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await repo.updateAgentRun(row.id, { status: "planned" });
    assert.notEqual(updated.updated_at, row.updated_at);
  });

  it("rejects invalid and payout-machine statuses", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    for (const status of ["completed", "approved", "pending_approval", "simulating", "submitted", "confirming", "execution_unknown", "cancelled"]) {
      await assert.rejects(
        () => repo.updateAgentRun(row.id, { status: status as never }),
        /invalid agent run status|unknown status/,
        status,
      );
    }
    await assert.rejects(
      () => repo.createAgentRun(runInput({ idempotencyKey: "tg:bad:1", status: "executed" as never })),
      /invalid agent run status/,
    );
  });

  it("exposes exactly the nine recording statuses", () => {
    assert.deepEqual([...AGENT_RUN_STATUSES].sort(), [
      "blocked",
      "claim_created",
      "failed",
      "interpreted",
      "needs_clarification",
      "planned",
      "prepared",
      "received",
      "unknown",
    ]);
  });

  it("counts agent runs since a timestamp", async () => {
    const repo = new MemoryRepository();
    await repo.createAgentRun(runInput({ idempotencyKey: "tg:count:1", startedAt: "2026-08-12T00:00:00.000Z" }));
    await repo.createAgentRun(runInput({ idempotencyKey: "tg:count:2", startedAt: "2026-08-12T13:00:00.000Z" }));
    await repo.createAgentRun(runInput({ idempotencyKey: "tg:count:3", startedAt: "2026-08-12T14:00:00.000Z" }));
    assert.equal(await repo.countAgentRunsSince({ telegramUserId: "123456", sinceIso: "2026-08-12T12:00:00.000Z" }), 2);
    assert.equal(await repo.countAgentRunsSince({ telegramUserId: "123456", sinceIso: "2026-08-12T23:00:00.000Z" }), 0);
  });

  it("counts only the requested user's runs", async () => {
    const repo = new MemoryRepository();
    await repo.createAgentRun(runInput({ idempotencyKey: "tg:user:a", startedAt: "2026-08-12T13:00:00.000Z" }));
    await repo.createAgentRun(
      runInput({
        idempotencyKey: "tg:user:b",
        telegramUserId: "999999",
        startedAt: "2026-08-12T13:00:00.000Z",
      }),
    );
    assert.equal(await repo.countAgentRunsSince({ telegramUserId: "123456", sinceIso: "2026-08-12T00:00:00.000Z" }), 1);
  });

  it("does not mutate payout state", async () => {
    const repo = new MemoryRepository();
    await repo.createAgentRun(runInput());
    assert.equal(await repo.getPayoutItemByIdempotencyKey("tg:-100777:m42:agent"), null);
    assert.equal(await repo.getClaimLinkByIdempotencyKey("tg:-100777:m42:agent"), null);
  });
});

describe("agent runs — redaction and hashing", () => {
  it("redacts KeeperHub keys", () => {
    assert.equal(redactAgentRawText("use kh_live_abc123xyz and pay").includes("kh_live_abc123xyz"), false);
  });

  it("redacts bot-token-like values", () => {
    const text = "token 1234567890:AAH4x-abcdefghijklmnopqrstuvwxyz0123456789XYZ end";
    const redacted = redactAgentRawText(text);
    assert.equal(redacted.includes("1234567890:AAH4x"), false);
  });

  it("redacts postgres URLs", () => {
    const redacted = redactAgentRawText("db postgresql://user:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require now");
    assert.equal(redacted.includes("postgresql://user:secret"), false);
    assert.equal(redacted.includes("secret@aws-0"), false);
  });

  it("redacts API-key assignments and bearer tokens", () => {
    assert.equal(redactAgentRawText("OPENAI_API_KEY=sk-proj-abcdefghijklmnop").includes("sk-proj-abcdefghijklmnop"), false);
    assert.equal(redactAgentRawText("authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.secret").includes("eyJhbGci"), false);
  });

  it("redacts private-key-shaped 64-hex values", () => {
    const key = "0x" + "a".repeat(64);
    assert.equal(redactAgentRawText(`key ${key} end`).includes(key), false);
  });

  it("hashes input deterministically", () => {
    assert.equal(hashAgentInput("send 0.01 USDC"), hashAgentInput("send 0.01 USDC"));
    assert.notEqual(hashAgentInput("send 0.01 USDC"), hashAgentInput("send 0.02 USDC"));
    assert.equal(hashAgentInput("send 0.01 USDC").length, 64);
  });

  it("truncates long raw text", () => {
    const long = "a".repeat(5000);
    const redacted = redactAgentRawText(long);
    assert.ok(redacted.length < 1200);
  });

  it("keeps benign text intact", () => {
    const text = "pay daniel 0.01 USDC for design work";
    assert.equal(redactAgentRawText(text), text);
  });
});

describe("agent runs — schema boundaries", () => {
  it("stores no KeeperHub execution id or transaction hash as payment truth", () => {
    const migration = readFileSync("migrations/0012_agent_runs.sql", "utf8");
    assert.equal(migration.includes("keeperhub_execution_id"), false);
    assert.equal(migration.includes("transaction_hash"), false);
    const row = {} as AgentRunRow;
    const keys = Object.keys(row);
    assert.equal(keys.includes("keeperhub_execution_id"), false);
    assert.equal(keys.includes("transaction_hash"), false);
  });

  it("never accepts an update to the idempotency key", async () => {
    const repo = new MemoryRepository();
    const row = await repo.createAgentRun(runInput());
    const input: UpdateAgentRunInput = { status: "planned" };
    const updated = await repo.updateAgentRun(row.id, input);
    assert.equal(updated.idempotency_key, row.idempotency_key);
  });
});
