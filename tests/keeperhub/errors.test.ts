import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyExecutionStatus, classifyToolFailure, SolvoError } from "../../src/server/keeperhub/errors.ts";

describe("classifyToolFailure", () => {
  it("classifies transport failures as unknown transport errors", () => {
    const error = classifyToolFailure("fetch failed: ECONNREFUSED");
    assert.equal(error.kind, "transport_timeout");
    assert.equal(error.phase, "unknown");
  });

  it("classifies authentication failures", () => {
    const error = classifyToolFailure("Error: 401 invalid_token");
    assert.equal(error.kind, "auth_invalid");
  });

  it("classifies missing wallet integration", () => {
    const error = classifyToolFailure("Error: wallet integration not configured");
    assert.equal(error.kind, "wallet_not_configured");
  });

  it("classifies insufficient balance markers", () => {
    const error = classifyToolFailure('{"code":"insufficient_balance"}');
    assert.equal(error.kind, "insufficient_balance");
  });

  it("classifies daily spending cap rejection", () => {
    const error = classifyToolFailure("Daily spending cap exceeded");
    assert.equal(error.kind, "rejected_before_execution");
  });

  it("classifies MCP input-validation errors with a schema-mismatch hint", () => {
    const payload = 'MCP error -32602: Input validation error: Invalid arguments for tool get_wallet_integration: [{"expected":"string","code":"invalid_type","path":["integrationId"],"message":"Invalid input: expected string, received undefined"}]';
    const error = classifyToolFailure(payload);
    assert.equal(error.kind, "rejected_before_execution");
    assert.match(error.message, /live tool schema/);
    assert.ok(error.detail);
  });

  it("classifies status lookups distinctly", () => {
    const error = classifyToolFailure("Error: 404 not found", "status");
    assert.equal(error.kind, "status_lookup_failed");
  });

  it("defaults to rejected-before-execution for other KeeperHub errors", () => {
    const error = classifyToolFailure("Error: Invalid recipient address");
    assert.equal(error.kind, "rejected_before_execution");
    assert.equal(error.phase, "rejected_before_execution");
  });
});

describe("classifyExecutionStatus", () => {
  it("maps KeeperHub status words to internal statuses", () => {
    assert.equal(classifyExecutionStatus("completed"), "completed");
    assert.equal(classifyExecutionStatus("failed"), "failed");
    assert.equal(classifyExecutionStatus("running"), "running");
    assert.equal(classifyExecutionStatus("pending"), "pending");
  });
});

describe("SolvoError", () => {
  it("carries kind, phase and detail", () => {
    const error = new SolvoError("execution_failed", "boom", "detail");
    assert.ok(error instanceof Error);
    assert.equal(error.kind, "execution_failed");
    assert.equal(error.phase, "execution_failed");
    assert.equal(error.detail, "detail");
  });
});
