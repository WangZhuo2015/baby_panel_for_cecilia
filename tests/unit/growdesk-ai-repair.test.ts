import test from "node:test";
import { verifyBffCsrf } from "../../lib/growdesk/csrf";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { BridgeError, bridgeErrorResponse, requireData } from "../../lib/growdesk/bridge-protocol";

// Execute the actual module with explicit boundaries; no SQLite, file-store or LLM side effects.
const require = createRequire(import.meta.url);
function load(relative: string, mocks: Record<string, unknown>) {
  const filename = path.resolve(import.meta.dirname, "../..", relative);
  const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("node:")) return require(id);
    throw new Error(`Unmocked import: ${id}`);
  }, process, Request, Response, URL, URLSearchParams, TextEncoder, ReadableStream, console });
  return module.exports;
}
const session = { id: "test_session", userId: "test_user", babyId: "test_baby", title: "test_title", contextType: "food", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", messages: [], messageCount: 0, lastMessage: null };
function chat(enabled = true, validSession = true, deniedBaby = false) {
  const calls: string[] = [];
  const bff = { user: { id: "test_user" }, accessToken: "test_token" };
  const route = load("app/api/ai/chat/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/config": { GROWDESK_CONFIG: { enabled } },
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("Legacy prisma must not run"); } }) },
    "@/lib/api-helpers": {
      requireAuth: async () => { calls.push("legacyAuth"); return { errorResponse: Response.json({ error: "test_legacy_rejected" }, { status: 401 }) }; },
      requireBaby: async () => { calls.push("legacyBaby"); throw new Error("Legacy baby lookup must not run"); },
    },
    "@/lib/growdesk/session": { resolveBffSession: async () => { calls.push("bff"); return validSession ? bff : null; } },
    "@/lib/growdesk/client": { growdeskFetch: async () => { throw new Error("Use mocked loadWebBaby"); } },
    "@/lib/growdesk/bridge-identity": { loadWebBaby: async (_fetch: unknown, token: string, babyId: string) => { calls.push("baby"); assert.equal(token, "test_token"); assert.equal(babyId, "test_baby"); if (deniedBaby) throw new BridgeError(403, "BABY_ACCESS_DENIED", "test_denied"); return { id: babyId, familyId: "test_family" }; } },
    "@/lib/growdesk/bridge-protocol": { BridgeError },
    "@/lib/growdesk/ai-sessions": { bffAiSessionStore: { getSession: async (_id: string, userId: string, token: string) => { assert.equal(userId, "test_user"); assert.equal(token, "test_token"); return session; }, createSession: async () => session, addMessage: async () => { calls.push("append"); return {}; } } },
    "@/lib/rate-limit": { getClientIp: () => "test_ip", checkRateLimit: () => ({ success: true }) },
    "@/lib/archive": { archiveText: async () => {} },
    "@/lib/agent": { createLlmBackend: () => ({ getApiKey: () => "test_fake_key" }), buildAgentSystemPrompt: () => "test_prompt", activeChatRunManager: { get: () => null, startRun: () => { calls.push("run"); }, attachSubscriber: (_id: string, cb: any) => cb({ type: "done" }) } },
  });
  return { route, calls };
}
function post() { return new Request("https://test.invalid/api/ai/chat", { method: "POST", body: JSON.stringify({ babyId: "test_baby", contextType: "food", messages: [{ role: "user", content: "test_question" }] }) }); }

test("A1 GET uses only the authenticated BFF user in GrowDesk mode", async () => {
  const { route, calls } = chat();
  const response = await route.GET(new Request("https://test.invalid/api/ai/chat?sessionId=test_session"));
  assert.equal(response.status, 200, "BFF login must reach chat GET without legacy JWT");
  assert.deepEqual(calls, ["bff"]);
});
test("A1 POST authorizes the baby through GrowDesk, never legacy Prisma", async () => {
  const { route, calls } = chat();
  const response = await route.POST(post());
  assert.equal(response.status, 200, "BFF login must reach chat POST without legacy JWT");
  assert.match(await response.text(), /\[DONE\]/);
  assert.deepEqual(calls, ["bff", "baby", "append", "run"]);
});
test("A1 missing BFF session does not fall back to legacy auth for GET or POST", async () => {
  for (const method of ["GET", "POST"]) {
    const { route, calls } = chat(true, false);
    assert.equal((await route[method](post())).status, 401);
    assert.deepEqual(calls, ["bff"]);
  }
});
test("A1 legacy mode still uses requireAuth for GET and POST", async () => {
  for (const method of ["GET", "POST"]) {
    const { route, calls } = chat(false);
    assert.equal((await route[method](post())).status, 401);
    assert.deepEqual(calls, ["legacyAuth"]);
  }
});
test("A1 unauthorized baby is rejected before creating messages or starting an LLM", async () => {
  const { route, calls } = chat(true, true, true);
  assert.equal((await route.POST(post())).status, 403);
  assert.deepEqual(calls, ["bff", "baby"]);
});

function store(response: any = { ok: true, status: 200, data: session }, enabled = true) {
  const calls: any[] = [];
  let diskCalls = 0;
  const result = load("lib/growdesk/ai-sessions.ts", {
    "@/lib/config": { GROWDESK_CONFIG: { enabled } },
    "./bridge-protocol": { BridgeError, requireData },
    "node:fs": { existsSync: () => { diskCalls++; return false; }, mkdirSync: () => { diskCalls++; }, writeFileSync: () => { diskCalls++; }, renameSync: () => { diskCalls++; } },
    "node:path": path,
    "./client": { growdeskFetch: async (url: string, options: any) => { calls.push({ url, options }); return response; } },
  });
  return { store: result.bffAiSessionStore, calls, diskCalls: () => diskCalls };
}
const base = "/api/v1/web/ai/sessions";

// Load the real route and real remote store together: only external boundaries are mocked.
function sessionRoutes(upstream: any, enabled = true, authenticated = true) {
  const s = store(upstream, enabled);
  let legacyCalls = 0;
  const mocks = {
    "next/server": { NextResponse: Response },
    "@/lib/config": { GROWDESK_CONFIG: { enabled } },
    "@/lib/prisma": { prisma: new Proxy({}, { get() { throw new Error("Legacy Prisma must not run"); } }) },
    "@/lib/api-helpers": { requireAuth: async () => { legacyCalls++; return { errorResponse: Response.json({ error: "test_legacy_rejected" }, { status: 401 }) }; } },
    "@/lib/growdesk/session": { resolveBffSession: async () => authenticated ? { user: { id: "test_user" }, accessToken: "test_token" } : null },
    "@/lib/growdesk/ai-sessions": { bffAiSessionStore: s.store },
    "@/lib/growdesk/bridge-protocol": { BridgeError, bridgeErrorResponse },
    "@/lib/growdesk/csrf": { verifyBffCsrf },
    "@/lib/growdesk/bridge-identity": { loadWebBaby: async () => ({ id: "test_baby" }) },
    "@/lib/growdesk/client": { growdeskFetch: async () => { throw new Error("Use mocked baby boundary"); } },
    "@/lib/rate-limit": { getClientIp: () => "test_ip", checkRateLimit: () => ({ success: true }) },
    "@/lib/json": { safeJsonParse: JSON.parse },
    "@/lib/agent": { activeChatRunManager: { get: () => null, cancelRun: async () => {}, delete: () => {} } },
  };
  return {
    ...s,
    collection: load("app/api/ai/sessions/route.ts", mocks),
    item: load("app/api/ai/sessions/[id]/route.ts", mocks),
    legacyCalls: () => legacyCalls,
  };
}
const sessionHandlers = [
  ["collection", "GET"], ["collection", "POST"],
  ["item", "GET"], ["item", "PATCH"], ["item", "DELETE"],
] as const;
function invokeSessionRoute(routes: ReturnType<typeof sessionRoutes>, target: "collection" | "item", method: string): Promise<Response> {
  const url = `https://test.invalid/api/ai/sessions${target === "item" ? "/test_session" : ""}`;
  return routes[target][method](new Request(url, {
    method,
    headers: { origin: "https://test.invalid" },
    ...(method === "POST" || method === "PATCH" ? { body: JSON.stringify({ title: "test_title", babyId: "test_baby" }) } : {}),
  }), { params: Promise.resolve({ id: "test_session" }) });
}
for (const [target, method] of sessionHandlers) {
  for (const status of [401, 409, 413, 503]) {
    test(`A2 ${target} ${method} translates upstream ${status} into structured HTTP response`, async () => {
      const error = { code: `TEST_UPSTREAM_${status}`, message: `test_upstream_${status}`, details: { reason: "test_reason" } };
      const routes = sessionRoutes({ ok: false, status, error });
      const response = await invokeSessionRoute(routes, target, method).catch((e) => {
        assert.fail(`${target} ${method} rejected instead of returning HTTP ${status}: ${e.name} status=${e.status} message=${e.message}`);
      });
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: error.message, code: error.code, details: error.details });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(routes.calls.length, 1);
      assert.equal(routes.calls[0].options.accessToken, "test_token");
      assert.equal(routes.diskCalls(), 0);
      assert.equal(routes.legacyCalls(), 0);
    });
  }
  test(`A2 ${target} ${method} preserves successful response shape`, async () => {
    const data = target === "collection" && method === "GET" ? { total: 1, sessions: [session] }
      : method === "DELETE" ? { deleted: true } : session;
    const routes = sessionRoutes({ ok: true, status: 200, data });
    const response = await invokeSessionRoute(routes, target, method);
    assert.equal(response.status, 200);
    const body = await response.json();
    if (target === "collection" && method === "GET") assert.deepEqual(body, data);
    else if (method === "DELETE") assert.deepEqual(body, { success: true, id: "test_session" });
    else { assert.equal(body.session.id, "test_session"); assert.equal(body.session.title, "test_title"); }
    assert.equal(routes.calls.length, 1);
    assert.equal(routes.diskCalls(), 0);
  });
  test(`A2 ${target} ${method} preserves authentication and legacy mode boundaries`, async () => {
    for (const enabled of [true, false]) {
      const routes = sessionRoutes(undefined, enabled, false);
      assert.equal((await invokeSessionRoute(routes, target, method)).status, 401);
      assert.equal(routes.legacyCalls(), enabled ? 0 : 1);
      assert.equal(routes.calls.length, 0);
      assert.equal(routes.diskCalls(), 0);
    }
  });
  if (target === "item") {
    test(`A2 item ${method} preserves upstream not-found behavior`, async () => {
      const routes = sessionRoutes({ ok: false, status: 404, error: { code: "TEST_NOT_FOUND", message: "test_missing" } });
      const response = await invokeSessionRoute(routes, target, method);
      assert.equal(response.status, 404);
      assert.equal(typeof (await response.json()).error, "string");
      assert.equal(routes.diskCalls(), 0);
    });
  }
}

test("A2 create persists remotely with exact web contract fields and token", async () => {
  const s = store();
  const result = await s.store.createSession({ userId: "test_user", babyId: "test_baby", title: "test_title", contextType: "food" }, "test_token");
  assert.equal(result.id, session.id, "must return backend session identity, not a local UUID");
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [{ url: base, options: { method: "POST", accessToken: "test_token", body: { babyId: "test_baby", title: "test_title", contextType: "food" } } }]);
  assert.equal(s.diskCalls(), 0);
});
test("A2 list forwards all filters and returns backend totals unchanged", async () => {
  const data = { total: 12, sessions: [session] };
  const s = store({ ok: true, status: 200, data });
  assert.deepEqual(await s.store.listSessions("test_user", { babyId: "test_baby", contextType: "food", limit: 2, offset: 4, accessToken: "test_token" }), data);
  assert.equal(s.calls[0].url, `${base}?babyId=test_baby&contextType=food&limit=2&offset=4`);
  assert.equal(s.calls[0].options.accessToken, "test_token");
  assert.equal(s.diskCalls(), 0);
});
test("A2 get and rename use durable session endpoints", async () => {
  for (const [method, args, http] of [["getSession", ["test_session", "test_user", "test_token"], "GET"], ["updateSessionTitle", ["test_session", "test_user", "test_new", "test_token"], "PATCH"]] as const) {
    const s = store();
    assert.deepEqual(await s.store[method](...args), session);
    assert.equal(s.calls[0].url, `${base}/test_session`);
    assert.equal(s.calls[0].options.method ?? "GET", http);
    assert.equal(s.calls[0].options.accessToken, "test_token");
    if (http === "PATCH") assert.equal(s.calls[0].options.body.title, "test_new");
    assert.equal(s.diskCalls(), 0);
  }
});
test("A2 append forwards caller message ID, image and tools without a local prerequisite", async () => {
  const message = { id: "test_message", role: "assistant", content: "test_reply", image: "test_image", toolsJson: "[]" };
  const s = store({ ok: true, status: 201, data: { ...message, sessionId: "test_session" } });
  assert.ok(await s.store.addMessage("test_session", "test_user", message, "test_token"));
  assert.equal(s.calls[0].url, `${base}/test_session/messages`);
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].options.body)), message);
  assert.equal(s.calls[0].options.accessToken, "test_token");
  assert.equal(s.diskCalls(), 0);
});
test("A2 append generates required UUID when caller has no message ID", async () => {
  const s = store();
  await s.store.addMessage("test_session", "test_user", { role: "user", content: "test_prompt" }, "test_token");
  assert.match(s.calls[0]?.options.body.id ?? "", /^[a-f0-9-]{36}$/);
});
test("A2 delete honors the durable endpoint response", async () => {
  const s = store({ ok: true, status: 200, data: { deleted: true } });
  assert.equal(await s.store.deleteSession("test_session", "test_user", "test_token"), true);
  assert.equal(s.calls[0].url, `${base}/test_session`);
  assert.equal(s.calls[0].options.method, "DELETE");
  assert.equal(s.calls[0].options.accessToken, "test_token");
  assert.equal(s.diskCalls(), 0);
});
test("A2 failures never fall back to local state and missing tokens fail closed", async () => {
  const operations = [
    (s: any, token?: string) => s.createSession({ userId: "test_user" }, token),
    (s: any, token?: string) => s.listSessions("test_user", { accessToken: token }),
    (s: any, token?: string) => s.getSession("test_session", "test_user", { accessToken: token }),
    (s: any, token?: string) => s.updateSessionTitle("test_session", "test_user", "test_title", token),
    (s: any, token?: string) => s.deleteSession("test_session", "test_user", token),
    (s: any, token?: string) => s.addMessage("test_session", "test_user", { role: "user", content: "test_question" }, token),
  ];
  for (const operation of operations) {
    const s = store({ ok: false, status: 503, error: { code: "TEST_UNAVAILABLE", message: "test_unavailable" } });
    await assert.rejects(() => operation(s.store, "test_token"), (e: any) => e.status === 503);
    await assert.rejects(() => operation(s.store), (e: any) => e.status === 401);
    assert.equal(s.diskCalls(), 0);
  }
});
