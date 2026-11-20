import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { transformSync } from "esbuild";

class PlanError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
function harness({ bff = true, authenticated = true } = {}) {
  const calls: unknown[][] = [];
  const plan = {
    status: (owner: string) => { calls.push(["status", owner]); return { profiles: [], pending: [] }; },
    models: async (owner: string, id: string) => { calls.push(["models", owner, id]); if (id === "other-owner") throw new PlanError("chatgpt_not_connected"); return [{ id: "test-gpt", name: "Test GPT" }]; },
    start: async (owner: string, options: unknown) => { calls.push(["start", owner, options]); return { authorization_url: "https://auth.openai.com/api/accounts/authorize?state=test" }; },
    disconnect: async (owner: string, id: string) => { calls.push(["disconnect", owner, id]); return { revoked: true }; },
  };
  const filename = path.resolve(import.meta.dirname, "../../app/api/ai/chatgpt/route.ts");
  const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} as Record<string, (request: Request) => Promise<Response>> };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/api-helpers": { requireAuth: async () => { calls.push(["legacy-auth"]); if (bff) throw new Error("No legacy fallback in BFF mode"); return authenticated ? { user: { id: "test_legacy_user" } } : { errorResponse: Response.json({}, { status: 401 }) }; } },
    "@/lib/chatgpt-plan": { getChatGPTPlan: () => plan, ChatGPTPlanError: PlanError, planErrorMessage: () => "test-plan-error" },
    "@/lib/rate-limit": { checkRateLimit: () => ({ success: true }) },
    "@/lib/config": { GROWDESK_CONFIG: { enabled: bff } },
    "@/lib/growdesk/session": { resolveBffSession: async () => authenticated ? { user: { id: "test_bff_user" } } : null },
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => { if (!(id in mocks)) throw new Error("Unmocked boundary: " + id); return mocks[id]; }, Request, Response, URL, console });
  const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}, query = "") => new Request("https://test.invalid/api/ai/chatgpt" + query, { method, headers: { Host: "test.invalid", Origin: "https://test.invalid", "Content-Type": "application/json", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { route: module.exports, calls, request };
}

test("subscription routes require login before reading credentials in both auth modes", async () => {
  for (const bff of [true, false]) {
    const h = harness({ bff, authenticated: false });
    assert.equal((await h.route.GET(h.request())).status, 401);
    assert.equal((await h.route.POST(h.request("POST", { action: "connect" }))).status, 401);
    assert.equal(h.calls.some(call => ["status", "start"].includes(String(call[0]))), false);
  }
});
test("subscription status/models bind the BFF identity and never use legacy auth", async () => {
  const h = harness();
  assert.equal((await h.route.GET(h.request())).status, 200);
  const result = await h.route.GET(h.request("GET", undefined, {}, "?profile_id=test_profile"));
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls, [["status", "test_bff_user"], ["models", "test_bff_user", "test_profile"]]);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("subscription mutations reject different origins/ports and non-JSON content", async () => {
  const h = harness();
  const invalidHeaders: Record<string, string>[] = [{ Origin: "https://evil.invalid" }, { Origin: "https://test.invalid:8443" }, { Origin: "" }, { "Content-Type": "text/plain" }];
  for (const headers of invalidHeaders) {
    assert.equal((await h.route.POST(h.request("POST", { action: "connect" }, headers))).status, 403);
  }
  assert.equal(h.calls.length, 0);
});
test("connect/disconnect use the authenticated application owner, ignoring forged owner fields", async () => {
  const h = harness({ bff: false });
  assert.equal((await h.route.POST(h.request("POST", { action: "connect", owner: "test_other_user" }))).status, 200);
  assert.equal((await h.route.POST(h.request("POST", { action: "disconnect", profile_id: "test_profile" }))).status, 200);
  assert.ok(h.calls.some(call => call[0] === "start" && call[1] === "test_legacy_user"));
  assert.ok(h.calls.some(call => call[0] === "disconnect" && call[1] === "test_legacy_user" && call[2] === "test_profile"));
});
test("foreign connections and malformed bodies return sanitized errors", async () => {
  const h = harness();
  const denied = await h.route.GET(h.request("GET", undefined, {}, "?profile_id=other-owner"));
  assert.equal(denied.status, 400); assert.equal((await denied.json()).error, "chatgpt_not_connected");
  for (const body of [{ action: "delete" }, { action: "connect", profile_id: {} }]) assert.equal((await h.route.POST(h.request("POST", body))).status, 400);
});


test("subscription endpoint crosses the migration fence only for its protected GET/POST handlers", () => {
  for (const backend of ["go", "typescript"] as const) {
    for (const method of ["GET", "POST"]) assert.equal(isBridgedMethod("/api/ai/chatgpt", method, backend), true);
    for (const method of ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) assert.equal(isBridgedMethod("/api/ai/chatgpt", method, backend), false);
    assert.equal(isBridgedMethod("/api/ai/chatgpt/extra", "POST", backend), false);
  }
});
