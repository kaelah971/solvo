import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearTelegramWebhook,
  getWebhookStatus,
  isValidWebhookUrl,
  setTelegramWebhook,
} from "../../src/server/telegram/webhook-admin.ts";

type FakeApi = {
  setWebhook: (url: string, extra?: Record<string, unknown>) => Promise<unknown>;
  deleteWebhook: (extra?: Record<string, unknown>) => Promise<unknown>;
  getWebhookInfo: () => Promise<{ url?: string; last_error_message?: string; pending_update_count?: number }>;
  calls: Array<{ method: string; args: unknown[] }>;
};

function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    setWebhook: async (url, extra) => {
      calls.push({ method: "setWebhook", args: [url, extra] });
    },
    deleteWebhook: async (extra) => {
      calls.push({ method: "deleteWebhook", args: [extra] });
    },
    getWebhookInfo: async () => ({ url: "https://example.com/api/telegram/webhook" }),
    ...overrides,
  };
}

const GOOD_URL = "https://solvo.example.com/api/telegram/webhook";

describe("webhook admin", () => {
  it("validates HTTPS URLs only", () => {
    assert.equal(isValidWebhookUrl(GOOD_URL), true);
    assert.equal(isValidWebhookUrl("http://example.com/api"), false);
    assert.equal(isValidWebhookUrl("ftp://example.com"), false);
    assert.equal(isValidWebhookUrl("not a url"), false);
    assert.equal(isValidWebhookUrl(""), false);
    assert.equal(isValidWebhookUrl("https://"), false);
  });

  it("sets and verifies a webhook with the secret", async () => {
    let infoUrl = "";
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: infoUrl }),
    });
    api.setWebhook = async (url, extra) => {
      infoUrl = url;
      api.calls.push({ method: "setWebhook", args: [url, extra] });
    };

    const result = await setTelegramWebhook(api, { url: GOOD_URL, secretToken: "s3cret" });
    assert.equal(result.ok, true);
    assert.match(result.message, /set and verified/);
    assert.ok(!result.message.includes("s3cret"), "secret must never appear in output");
    assert.equal(api.calls[0].method, "setWebhook");
    assert.deepEqual(api.calls[0].args[1], { secret_token: "s3cret" });
  });

  it("sets a webhook without a secret when none is configured", async () => {
    let infoUrl = "";
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: infoUrl }),
    });
    api.setWebhook = async (url, extra) => {
      infoUrl = url;
      api.calls.push({ method: "setWebhook", args: [url, extra] });
    };
    const result = await setTelegramWebhook(api, { url: GOOD_URL, secretToken: null });
    assert.equal(result.ok, true);
    assert.deepEqual(api.calls[0].args[1], {});
  });

  it("rejects a bad URL before calling Telegram", async () => {
    const api = fakeApi();
    const result = await setTelegramWebhook(api, { url: "http://insecure.example.com", secretToken: null });
    assert.equal(result.ok, false);
    assert.match(result.message, /HTTPS/);
    assert.equal(api.calls.length, 0, "no API call may be made for a bad URL");
  });

  it("is idempotent when the webhook is already set to the same URL", async () => {
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: GOOD_URL }),
    });
    const result = await setTelegramWebhook(api, { url: GOOD_URL, secretToken: null });
    assert.equal(result.ok, true);
    assert.match(result.message, /verified/);
  });

  it("reports when verification does not match", async () => {
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: "https://other.example.com/webhook" }),
    });
    const result = await setTelegramWebhook(api, { url: GOOD_URL, secretToken: null });
    assert.equal(result.ok, false);
    assert.match(result.message, /verification shows/);
  });

  it("clears the webhook and confirms", async () => {
    let infoUrl = GOOD_URL;
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: infoUrl }),
    });
    api.deleteWebhook = async () => {
      infoUrl = "";
      api.calls.push({ method: "deleteWebhook", args: [] });
    };
    const result = await clearTelegramWebhook(api);
    assert.equal(result.ok, true);
    assert.match(result.message, /cleared/);
    assert.equal(api.calls[0].method, "deleteWebhook");
  });

  it("clearing when already clear is still a success", async () => {
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: "" }),
    });
    const result = await clearTelegramWebhook(api);
    assert.equal(result.ok, true);
  });

  it("getWebhookStatus reports current state without tokens", async () => {
    const api = fakeApi({
      getWebhookInfo: async () => ({ url: GOOD_URL, pending_update_count: 3 }),
    });
    const result = await getWebhookStatus(api);
    assert.equal(result.ok, true);
    assert.match(result.message, /URL https:\/\/solvo\.example\.com/);
    assert.match(result.message, /3 pending update/);
  });
});
