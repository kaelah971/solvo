import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryRepository } from "../../src/server/db/memory-repository.ts";
import { FakeGateway, createApprovedItem } from "./fixtures.ts";
import { ExecutionService } from "../../src/server/execution/execution-service.ts";

const CHAIN_ID = "8453";
const TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

describe("audit trail", () => {
  it("appends audit events for the full happy path", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId, workspaceId, payoutId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "completed");

    const events = repo.auditEvents.filter(
      (event) => event.workspace_id === workspaceId && event.payout_id === payoutId,
    );
    const types = events.map((event) => event.event_type);
    for (const expected of [
      "simulation_started",
      "simulation_passed",
      "execution_submitted",
      "execution_completed",
    ]) {
      assert.ok(types.includes(expected), `missing audit event ${expected}; got ${types.join(", ")}`);
    }
    for (const event of events) {
      assert.equal(typeof event.metadata, "object");
      assert.ok(!JSON.stringify(event.metadata).includes("kh_"), "audit metadata must not contain secrets");
    }
  });

  it("appends simulation_failed audit and no execute audit on revert", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({
      simulate: {
        success: false,
        wouldRevert: true,
        from: null,
        to: null,
        value: null,
        gasEstimate: null,
        revertReason: "Error(revert)",
        code: null,
        balanceWei: null,
        requiredWei: null,
        shortfallWei: null,
        error: "Error(revert)",
      },
    });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId, workspaceId, payoutId } = await createApprovedItem(repo);

    await service.executePayoutItem(itemId);

    const types = repo.auditEvents
      .filter((event) => event.workspace_id === workspaceId && event.payout_id === payoutId)
      .map((event) => event.event_type);
    assert.ok(types.includes("simulation_started"));
    assert.ok(types.includes("simulation_failed"));
    assert.ok(!types.includes("execution_submitted"));
    assert.ok(!types.includes("execution_completed"));
  });

  it("appends execution_submitted before execution_completed on synchronous completion (M5.1 regression)", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({});
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId, workspaceId, payoutId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "completed");

    const events = repo.auditEvents.filter(
      (event) => event.workspace_id === workspaceId && event.payout_id === payoutId,
    );
    const types = events.map((event) => event.event_type);
    const submittedIndex = types.indexOf("execution_submitted");
    const completedIndex = types.indexOf("execution_completed");
    assert.ok(submittedIndex !== -1, "execution_submitted must be persisted");
    assert.ok(completedIndex !== -1, "execution_completed must be persisted");
    assert.ok(
      submittedIndex < completedIndex,
      `execution_submitted (index ${submittedIndex}) must be persisted before execution_completed (index ${completedIndex}); got ${types.join(", ")}`,
    );
    const submitted = events[submittedIndex];
    const completed = events[completedIndex];
    assert.ok(
      submitted.created_at <= completed.created_at,
      `timestamps must not regress: submitted ${submitted.created_at} vs completed ${completed.created_at}`,
    );
  });

  it("appends execution_unknown audit for ambiguous outcomes", async () => {
    const repo = new MemoryRepository();
    const gateway = new FakeGateway({ executeError: new Error("fetch failed") });
    const service = new ExecutionService(repo, gateway, { chainId: CHAIN_ID, tokenAddress: TOKEN });
    const { itemId, workspaceId, payoutId } = await createApprovedItem(repo);

    const outcome = await service.executePayoutItem(itemId);
    assert.equal(outcome.kind, "unknown");

    const types = repo.auditEvents
      .filter((event) => event.workspace_id === workspaceId && event.payout_id === payoutId)
      .map((event) => event.event_type);
    assert.ok(types.includes("execution_unknown"));
  });
});
