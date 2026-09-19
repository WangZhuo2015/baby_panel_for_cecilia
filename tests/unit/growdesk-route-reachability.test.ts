import test from "node:test";
import assert from "node:assert/strict";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

test("implemented registration and durable conversation routes are reachable through the migration fence", () => {
  assert.equal(isBridgedMethod("/api/auth/register", "POST"), true);
  const detail = "/api/ai/sessions/550e8400-e29b-41d4-a716-446655440000";
  for (const method of ["GET", "PATCH", "DELETE"]) assert.equal(isBridgedMethod(detail, method), true);
  for (const method of ["POST", "PUT"]) assert.equal(isBridgedMethod(detail, method), false);
  assert.equal(isBridgedMethod(`${detail}/messages`, "POST"), false);
  assert.equal(isBridgedMethod("/api/auth/register", "GET"), false);
});

test("conversation writes reject foreign origins before resolving a session or contacting the database", async () => {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  try {
    const collection = await import("../../app/api/ai/sessions/route");
    const detail = await import("../../app/api/ai/sessions/[id]/route");
    const context = { params: Promise.resolve({ id: "550e8400-e29b-41d4-a716-446655440000" }) };
    for (const method of ["POST", "PATCH", "DELETE"] as const) {
      const request = new Request("https://test.invalid/api/ai/sessions", {
        method, headers: { origin: "https://test-attacker.invalid", "content-type": "application/json" },
        body: JSON.stringify({ title: "test_title" }),
      });
      const response = method === "POST" ? await collection.POST(request) : await detail[method](request, context);
      assert.equal(response.status, 403, method);
    }
  } finally {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
  }
});
