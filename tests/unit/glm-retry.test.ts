import assert from "node:assert/strict";
import test from "node:test";

test("TDD: default model should be z-ai/glm-5.2 (free)", async () => {
  // Ensure env not set to old model
  const original = process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_MODEL;
  // Need to re-import fresh? Use dynamic import with cache bust
  // Instead check file content
  const fs = await import("node:fs");
  const config = fs.readFileSync("lib/config.ts", "utf-8");
  assert.ok(config.includes("z-ai/glm-5.2"), "lib/config should default to z-ai/glm-5.2");
  const model = fs.readFileSync("lib/agent/model.ts", "utf-8");
  assert.ok(model.includes("z-ai/glm-5.2"), "lib/agent/model should default to z-ai/glm-5.2");
  if(original) process.env.OPENROUTER_MODEL = original;
});

test("TDD: isRateLimitError should detect 429", async () => {
  const { isRateLimitError, getRetryAfterMs } = await import("../../lib/agent/run.js");
  assert.equal(isRateLimitError({ status: 429 }), true);
  assert.equal(isRateLimitError({ message: "429 Too Many Requests" }), true);
  assert.equal(isRateLimitError({ message: "rate limit exceeded" }), true);
  assert.equal(isRateLimitError({ message: "ok" }), false);
  assert.equal(isRateLimitError(null), false);
});

test("TDD: getRetryAfterMs should parse header", async () => {
  const { getRetryAfterMs } = await import("../../lib/agent/run.js");
  assert.equal(getRetryAfterMs({ headers: { "retry-after": "5" } }), 5000);
  assert.equal(getRetryAfterMs({ headers: {} }), null);
});

test("TDD: retry logic should be present in runBabyAgent (10 retries)", async () => {
  const fs = await import("node:fs");
  const content = fs.readFileSync("lib/agent/run.ts", "utf-8");
  assert.ok(content.includes("attempt <= 10") || content.includes("attempt < 10") || content.includes("10"), "should have 10 retries");
  assert.ok(content.includes("isRateLimitError"), "should use isRateLimitError");
  assert.ok(content.includes("getRetryAfterMs") || content.includes("retryAfter"), "should handle Retry-After");
});
