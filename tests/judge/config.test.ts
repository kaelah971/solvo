import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getJudgeConfig, JudgeConfigError } from "../../src/server/judge/config.ts";

describe("judge config", () => {
  it("defaults to disabled, public self-serve, with M6.1 caps", () => {
    const config = getJudgeConfig({});
    assert.equal(config.enabled, false);
    assert.equal(config.adminUserIds.size, 0, "empty allowlist = public self-serve");
    assert.equal(config.perTxLimitBaseUnits, "10000", "0.01 USDC");
    assert.equal(config.dailyLimitBaseUnits, "250000", "0.25 USDC");
    assert.equal(config.lifetimeLimitBaseUnits, "1000000", "1.00 USDC");
    assert.equal(config.maxSuccessfulPaymentsPerUser, 1);
    assert.equal(config.keeperhubJudgeIntegrationId, null);
  });

  it("parses the admin allowlist, keeping only numeric IDs", () => {
    const config = getJudgeConfig({
      JUDGE_MODE_ENABLED: "true",
      TELEGRAM_JUDGE_USER_IDS: "123456789, alice, 987654321, ",
    });
    assert.equal(config.enabled, true);
    assert.deepEqual([...config.adminUserIds].sort(), ["123456789", "987654321"]);
  });

  it("accepts custom caps, lifetime limit and per-user max", () => {
    const config = getJudgeConfig({
      JUDGE_PER_TX_LIMIT_USDC: "0.05",
      JUDGE_DAILY_LIMIT_USDC: "0.50",
      JUDGE_LIFETIME_LIMIT_USDC: "2.00",
      JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER: "3",
      KEEPERHUB_JUDGE_INTEGRATION_ID: "idk-judge",
    });
    assert.equal(config.perTxLimitBaseUnits, "50000");
    assert.equal(config.dailyLimitBaseUnits, "500000");
    assert.equal(config.lifetimeLimitBaseUnits, "2000000");
    assert.equal(config.maxSuccessfulPaymentsPerUser, 3);
    assert.equal(config.keeperhubJudgeIntegrationId, "idk-judge");
  });

  it("rejects invalid cap and per-user values", () => {
    assert.throws(() => getJudgeConfig({ JUDGE_PER_TX_LIMIT_USDC: "banana" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_DAILY_LIMIT_USDC: "-1" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_LIFETIME_LIMIT_USDC: "0" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER: "0" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_MAX_SUCCESSFUL_PAYMENTS_PER_USER: "x" }), JudgeConfigError);
  });

  it("accepts 'TRUE' case-insensitively for the enable flag", () => {
    assert.equal(getJudgeConfig({ JUDGE_MODE_ENABLED: "TRUE" }).enabled, true);
    assert.equal(getJudgeConfig({ JUDGE_MODE_ENABLED: "yes" }).enabled, false);
  });
});
