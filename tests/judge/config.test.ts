import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getJudgeConfig, JudgeConfigError } from "../../src/server/judge/config.ts";

describe("judge config", () => {
  it("defaults to disabled with no allowlist", () => {
    const config = getJudgeConfig({});
    assert.equal(config.enabled, false);
    assert.equal(config.judgeUserIds.size, 0);
    assert.equal(config.perTxLimitBaseUnits, "100000");
    assert.equal(config.dailyLimitBaseUnits, "1000000");
    assert.equal(config.keeperhubJudgeIntegrationId, null);
  });

  it("parses the allowlist, keeping only numeric IDs", () => {
    const config = getJudgeConfig({
      JUDGE_MODE_ENABLED: "true",
      TELEGRAM_JUDGE_USER_IDS: "123456789, alice, 987654321, ",
    });
    assert.equal(config.enabled, true);
    assert.deepEqual([...config.judgeUserIds].sort(), ["123456789", "987654321"]);
  });

  it("accepts custom caps and integration id", () => {
    const config = getJudgeConfig({
      JUDGE_PER_TX_LIMIT_USDC: "0.05",
      JUDGE_DAILY_LIMIT_USDC: "0.50",
      KEEPERHUB_JUDGE_INTEGRATION_ID: "idk-judge",
    });
    assert.equal(config.perTxLimitBaseUnits, "50000");
    assert.equal(config.dailyLimitBaseUnits, "500000");
    assert.equal(config.keeperhubJudgeIntegrationId, "idk-judge");
  });

  it("rejects invalid cap values", () => {
    assert.throws(() => getJudgeConfig({ JUDGE_PER_TX_LIMIT_USDC: "banana" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_DAILY_LIMIT_USDC: "-1" }), JudgeConfigError);
    assert.throws(() => getJudgeConfig({ JUDGE_PER_TX_LIMIT_USDC: "0" }), JudgeConfigError);
  });

  it("accepts 'TRUE' case-insensitively for the enable flag", () => {
    assert.equal(getJudgeConfig({ JUDGE_MODE_ENABLED: "TRUE" }).enabled, true);
    assert.equal(getJudgeConfig({ JUDGE_MODE_ENABLED: "yes" }).enabled, false);
  });
});
