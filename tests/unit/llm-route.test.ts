import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";

function fixture() {
  const state = { authenticated: true, allowed: true, scopes: 0, handlers: 0, failScope: false, metadata: null as unknown };
  const module = { exports: {} as { llmRoute: (feature: string, handler: (request: Request) => Promise<Response>) => (request: Request) => Promise<Response> } };
  const mocks: Record<string, unknown> = {
    "next/server": { NextResponse: Response },
    "@/lib/config": { GROWDESK_CONFIG: { enabled: true } },
    "@/lib/api-helpers": { requireAuth: () => assert.fail("Shared AI must not fall back to legacy authentication") },
    "@/lib/growdesk/session": { resolveBffSession: async () => state.authenticated ? { user: { id: "test_verified_user" }, accessToken: "test_access_token" } : null },
    "@/lib/growdesk/csrf": { verifyBffCsrf: (request: Request) => request.headers.get("x-test-csrf") === "test_valid" ? null : Response.json({ error: "Forbidden" }, { status: 403 }) },
    "@/lib/rate-limit": { checkRateLimit: () => ({ success: state.allowed, resetSeconds: 15 }) },
    "@/lib/llm-context": { withLlmFeature: async (owner: string, feature: string, token: string, work: () => Promise<Response>) => {
      state.scopes++; assert.equal(owner, "test_verified_user"); assert.equal(token, "test_access_token"); assert(["tips", "daily_summary"].includes(feature));
      if (state.failScope) throw new Error("test_unavailable_preferences");
      return work();
    } },
    "@/lib/llm-provenance": { actualLlmModel: () => state.metadata, withLlmProvenance: (work: () => Promise<Response>) => work() },
  };
  const code = transformSync(readFileSync(new URL("../../lib/llm-route.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
    if (!(id in mocks)) throw new Error("Unexpected dependency: " + id);
    return mocks[id];
  }, Headers, Response, Request, console });
  const route = module.exports.llmRoute("tips", async () => { state.handlers++; return Response.json(["test_tip"]); });
  return { state, route, wrap: module.exports.llmRoute };
}

test("AI feature wrapper rejects missing identity, cross-site requests, missing CSRF and rate limits before model work", async () => {
  const f = fixture();
  f.state.authenticated = false;
  assert.equal((await f.route(new Request("https://test.invalid/api/ai/tips"))).status, 401);
  f.state.authenticated = true;
  assert.equal((await f.route(new Request("https://test.invalid/api/ai/tips", { headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
  assert.equal((await f.route(new Request("https://test.invalid/api/ai/tips", { method: "POST" }))).status, 403);
  f.state.allowed = false;
  assert.equal((await f.route(new Request("https://test.invalid/api/ai/tips"))).status, 429);
  assert.equal(f.state.scopes, 0); assert.equal(f.state.handlers, 0);
});

test("unavailable saved preferences fail closed and do not call the model handler", async () => {
  const f = fixture(); f.state.failScope = true;
  assert.equal((await f.route(new Request("https://test.invalid/api/ai/tips"))).status, 503);
  assert.equal(f.state.handlers, 0);
});

test("cached results keep their original model while array endpoints retain their response shape", async () => {
  const f = fixture();
  f.state.metadata = { source: "api", provider: "test_current_provider", model: "test_current_model" };
  const original = { source: "api", provider: "test_cached_provider", model: "test_cached_model" };
  const route = f.wrap("tips", async () => Response.json({ summary: { isAiGenerated: true, llm: original } }));
  const response = await route(new Request("https://test.invalid/api/ai/tips"));
  assert.deepEqual((await response.json()).llm, original);
  assert.equal(response.headers.get("X-LLM-Model"), original.model);
  const array = await f.route(new Request("https://test.invalid/api/ai/tips"));
  assert.deepEqual(await array.json(), ["test_tip"]);
  assert.equal(array.headers.get("X-LLM-Model"), "test_current_model");
  assert.equal(array.headers.get("Cache-Control"), "no-store");
});

test("a removed AI profile does not block deterministic daily statistics", async () => {
  const f = fixture(); f.state.failScope = true;
  const route = f.wrap("daily_summary", async () => Response.json({ summary: { source: "deterministic", isAiGenerated: false, metrics: { test_count: 2 } } }));
  const response = await route(new Request("https://test.invalid/api/ai/daily-summary"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.summary.metrics.test_count, 2); assert.equal(body.llm, null);
  const post = await route(new Request("https://test.invalid/api/ai/daily-summary", { method: "POST", headers: { "x-test-csrf": "test_valid" } }));
  assert.equal(post.status, 503);
});
