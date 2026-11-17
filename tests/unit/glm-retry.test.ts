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

test("Retry-After accepts delta seconds and case-insensitive response headers", () => {
  assert.equal(getRetryAfterMs({ headers: { "Retry-After": "5" } }), 5000);
  assert.equal(getRetryAfterMs({ response: { headers: new Headers({ "retry-after": "2" }) } }), 2000);
  assert.equal(getRetryAfterMs({ headers: {} }), null);
});

test("Retry-After HTTP date is parsed as a bounded nonnegative delay", () => {
  const delay = getRetryAfterMs({ headers: { "retry-after": new Date(Date.now() + 1500).toUTCString() } });
  assert.ok(delay !== null && delay >= 0 && delay <= 2000);
});
