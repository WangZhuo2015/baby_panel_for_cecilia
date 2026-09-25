import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveGrowDeskApiUrl,
  resolveGrowDeskBackendImplementation,
} from "../../lib/config";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

test("Go backend selector preserves the existing TypeScript default and supports an isolated Go URL", () => {
  assert.equal(resolveGrowDeskBackendImplementation({}), "typescript");
  assert.equal(resolveGrowDeskBackendImplementation({ GROWDESK_BACKEND: "go" }), "go");
  assert.equal(resolveGrowDeskBackendImplementation({ GROWDESK_BACKEND: "native-go" }), "go");
  assert.equal(resolveGrowDeskBackendImplementation({ GROWDESK_BACKEND: "fastify" }), "typescript");

  assert.equal(resolveGrowDeskApiUrl({}), "http://127.0.0.1:3080");
  assert.equal(
    resolveGrowDeskApiUrl({ GROWDESK_BACKEND: "go" }),
    "http://127.0.0.1:3081",
  );
  assert.equal(
    resolveGrowDeskApiUrl({
      GROWDESK_BACKEND: "go",
      GROWDESK_GO_API_URL: "http://127.0.0.1:4100/",
    }),
    "http://127.0.0.1:4100",
  );
  assert.equal(
    resolveGrowDeskApiUrl({
      GROWDESK_BACKEND: "go",
      GROWDESK_GO_API_URL: "http://127.0.0.1:4100",
      GROWDESK_API_URL: "http://127.0.0.1:4200/",
    }),
    "http://127.0.0.1:4200",
    "the existing explicit GROWDESK_API_URL remains the highest-priority override",
  );
  assert.throws(
    () => resolveGrowDeskBackendImplementation({ GROWDESK_BACKEND: "rust" }),
    /GROWDESK_BACKEND/,
  );
});

test("Go mode keeps canonical BFF routes but blocks Web-local state and execution", () => {
  for (const [path, method] of [
    ["/api/auth/login", "POST"],
    ["/api/auth/register", "POST"],
    ["/api/records/feeding", "GET"],
    ["/api/records/feeding", "POST"],
    ["/api/growth", "POST"],
    ["/api/medical/reports", "GET"],
    ["/api/vaccines/selections", "PUT"],
    ["/api/notifications", "GET"],
    ["/api/ai/sessions", "GET"],
    ["/api/agent/voice", "POST"],
    ["/api/ai/chat", "POST"],
    ["/api/ai/daily-summary", "GET"],
    ["/api/ai/tips", "GET"],
    ["/api/growth/ocr", "POST"],
    ["/api/medical/ocr", "POST"],
    ["/api/push/test", "POST"],
    ["/api/asr/transcribe", "POST"],
    ["/api/ai/parse-record", "POST"],
    ["/api/ai/parse-nutrition", "POST"],
    ["/api/ai/search", "GET"],
    ["/api/ai/search", "POST"],
    ["/api/mcp/usage", "GET"],
    ["/api/cron/daily-summary", "POST"],
  ] as const) {
    assert.equal(isBridgedMethod(path, method, "go"), true, `${method} ${path}`);
  }

  for (const [path, method] of [
    ["/api/ai/jobs", "GET"],
    ["/api/ai/jobs/550e8400-e29b-41d4-a716-446655440000", "GET"],
    ["/api/ai/jobs/550e8400-e29b-41d4-a716-446655440000", "PATCH"],
    ["/api/user/tokens", "GET"],
    ["/api/user/tokens", "POST"],
  ] as const) {
    assert.equal(isBridgedMethod(path, method, "go"), false, `${method} ${path}`);
  }
});

test("TypeScript GrowDesk mode retains transitional AI-job reachability", () => {
  assert.equal(isBridgedMethod("/api/ai/jobs", "GET", "typescript"), true);
  assert.equal(
    isBridgedMethod("/api/ai/jobs/550e8400-e29b-41d4-a716-446655440000", "GET", "typescript"),
    true,
  );
  assert.equal(
    isBridgedMethod("/api/ai/jobs/550e8400-e29b-41d4-a716-446655440000", "PATCH", "typescript"),
    true,
  );
  assert.equal(
    isBridgedMethod("/api/ai/jobs/550e8400-e29b-41d4-a716-446655440000", "POST", "typescript"),
    false,
  );
});


test("Go handler guards reject transitional PAT and AI-job state before database access", async () => {
  const previousEnabled = process.env.GROWDESK_ENABLED;
  const previousBackend = process.env.GROWDESK_BACKEND;
  process.env.GROWDESK_ENABLED = "true";
  process.env.GROWDESK_BACKEND = "go";
  try {
    const jobs = await import("../../app/api/ai/jobs/route");
    const job = await import("../../app/api/ai/jobs/[id]/route");
    const tokens = await import("../../app/api/user/tokens/route");

    assert.equal((await jobs.GET(new Request("http://test.invalid/api/ai/jobs"))).status, 501);
    assert.equal((await tokens.GET(new Request("http://test.invalid/api/user/tokens"))).status, 501);
    assert.equal((await tokens.POST(new Request("http://test.invalid/api/user/tokens", { method: "POST" }))).status, 501);

    const context = { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }) };
    assert.equal((await job.GET(new Request("http://test.invalid/api/ai/jobs/x"), context)).status, 501);
    assert.equal((await job.PATCH(new Request("http://test.invalid/api/ai/jobs/x", { method: "PATCH" }), context)).status, 501);
  } finally {
    if (previousEnabled === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previousEnabled;
    if (previousBackend === undefined) delete process.env.GROWDESK_BACKEND;
    else process.env.GROWDESK_BACKEND = previousBackend;
  }
});
