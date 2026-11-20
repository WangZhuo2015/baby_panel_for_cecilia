import assert from "node:assert/strict";
import test from "node:test";
import { getRetryAfterMs, isRetryableModelStageError } from "../../lib/agent/stream-retry";

test("stream retry classifies transient provider failures and rejects permanent failures", () => {
  assert.equal(isRetryableModelStageError({ status: 429 }), true);
  assert.equal(isRetryableModelStageError({ status: 503 }), true);
  assert.equal(isRetryableModelStageError(new Error("fetch failed")), true);
  assert.equal(isRetryableModelStageError({ status: 401, message: "unauthorized" }), false);
  assert.equal(isRetryableModelStageError(new Error("invalid request")), false);
});

test("default profile is the official GPT-6 API", async () => {
  const fs = await import("node:fs");
  const config = fs.readFileSync("lib/config.ts", "utf-8");
  assert.ok(config.includes("getActiveLlmProfile"), "lib/config should resolve the selected LLM profile");
  const profiles = fs.readFileSync("lib/llm-profiles.ts", "utf-8");
  assert.ok(profiles.includes('"gpt-6.2-sol"'), "the official profile should default to GPT-6.2 Sol");
  const model = fs.readFileSync("lib/agent/model.ts", "utf-8");
  assert.ok(model.includes("openAIResponsesApi()"), "the official profile should use the Responses API");
});

test("TDD: isRateLimitError should detect 429", async () => {
  const { isRateLimitError } = await import("../../lib/agent/run.js");
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError({ message: "429 Too Many Requests" }), true);
  assert.equal(isRateLimitError({ message: "rate limit exceeded" }), true);
  assert.equal(isRateLimitError({ message: "ok" }), false);
  assert.equal(isRateLimitError(null), false);
});

test("TDD: getRetryAfterMs should parse header", async () => {
  const { getRetryAfterMs } = await import("../../lib/agent/run.js");
  assert.equal(getRetryAfterMs({ headers: { "retry-after": "5" } }), 5000);
  assert.equal(getRetryAfterMs({ response: { headers: new Headers({ "retry-after": "2" }) } }), 2000);
  assert.equal(getRetryAfterMs({ headers: {} }), null);
});

test("Retry-After HTTP date is parsed as a bounded nonnegative delay", () => {
  const delay = getRetryAfterMs({ headers: { "retry-after": new Date(Date.now() + 1500).toUTCString() } });
  assert.ok(delay !== null && delay >= 0 && delay <= 2000);
});
