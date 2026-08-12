import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertTransition,
  canTransition,
  EXECUTION_STATES,
  isExecutionState,
  isFailureTerminal,
  isTerminal,
  StateTransitionError,
  type ExecutionState,
} from "../../src/server/execution/state-machine.ts";

describe("state machine", () => {
  it("accepts the full happy path", () => {
    const path: ExecutionState[] = [
      "draft",
      "validated",
      "pending_approval",
      "approved",
      "simulating",
      "submitted",
      "confirming",
      "completed",
    ];
    for (let i = 1; i < path.length; i += 1) {
      assert.equal(canTransition(path[i - 1], path[i]), true, `${path[i - 1]} → ${path[i]}`);
    }
  });

  it("rejects invalid transitions", () => {
    assert.equal(canTransition("draft", "completed"), false);
    assert.equal(canTransition("pending_approval", "simulating"), false);
    assert.equal(canTransition("completed", "draft"), false);
    assert.equal(canTransition("cancelled", "approved"), false);
  });

  it("throws StateTransitionError with from/to details", () => {
    assert.throws(
      () => assertTransition("draft", "completed"),
      (error: unknown) => error instanceof StateTransitionError && error.from === "draft" && error.to === "completed",
    );
  });

  it("cannot submit before approved", () => {
    const froms: ExecutionState[] = ["draft", "validated", "pending_approval"];
    for (const from of froms) {
      assert.equal(canTransition(from, "submitted"), false, `${from} → submitted must be rejected`);
    }
    assert.equal(canTransition("approved", "simulating"), true);
    assert.equal(canTransition("simulating", "submitted"), true);
  });

  it("simulation_failed cannot transition to submitted", () => {
    assert.equal(canTransition("simulation_failed", "submitted"), false);
  });

  it("simulation_failed can resume via simulating only (manual)", () => {
    assert.equal(canTransition("simulation_failed", "simulating"), true);
  });

  it("execution_unknown is not a failure state and never auto-completes", () => {
    assert.equal(isFailureTerminal("execution_unknown"), false);
    assert.equal(isTerminal("execution_unknown"), false);
    assert.equal(canTransition("execution_unknown", "completed"), true);
    assert.equal(canTransition("execution_unknown", "execution_failed"), true);
  });

  it("completed and cancelled are terminal", () => {
    assert.equal(isTerminal("completed"), true);
    assert.equal(isTerminal("cancelled"), true);
  });

  it("failure states are recognized", () => {
    assert.equal(isFailureTerminal("validation_failed"), true);
    assert.equal(isFailureTerminal("simulation_failed"), true);
    assert.equal(isFailureTerminal("execution_failed"), true);
  });

  it("every state has an explicit transition list and is validated", () => {
    for (const state of EXECUTION_STATES) {
      assert.equal(isExecutionState(state), true);
    }
    assert.equal(isExecutionState("nonsense"), false);
  });
});
