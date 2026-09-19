import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { transformSync } from "esbuild";
import * as protocol from "../../lib/growdesk/bridge-protocol";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
// Execute source with closed boundaries. Never import app config, Prisma or providers.
function load(relative: string, mocks: Record<string, unknown>) {
  const filename = path.resolve(import.meta.dirname, "../..", relative);
  const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} as any };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id in mocks) return mocks[id];
      if (id === "node:crypto") return require(id);
      throw new Error(`Unmocked import: ${id}`);
    },
    process: { env: {} }, Request, Response, URL, console,
  }, { filename });
  return module.exports;
}
const item = "/api/ai/sessions/00000000-0000-4000-8000-000000000001";
for (const [pathname, method] of [
  ["/api/ai/chat", "GET"], ["/api/ai/chat/cancel", "POST"],
  [item, "GET"], [item, "PATCH"], [item, "DELETE"],
]) {
  test(`routing permits implemented ${method} ${pathname}`, () => {
    assert.equal(isBridgedMethod(pathname!, method!), true);
    assert.equal(isBridgedMethod(pathname!, method!.toLowerCase()), true);
  });
}
test("routing still rejects unimplemented verbs, invalid IDs and adjacent AI paths", () => {
  for (const [pathname, methods] of [
    ["/api/ai/chat", ["PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]],
    ["/api/ai/chat/cancel", ["GET", "PUT", "PATCH", "DELETE"]],
    [item, ["POST", "PUT", "HEAD", "OPTIONS"]],
    ["/api/ai/sessions/not-a-uuid", ["GET", "PATCH", "DELETE"]],
    ["/api/ai/sessions/------------------------------------", ["GET"]],
    [`${item}/messages`, ["GET", "POST"]],
    ["/api/ai/chat/cancel/extra", ["POST"]],
    ["/api/ai/backends", ["GET"]],
  ] as const) {
    for (const method of methods) assert.equal(isBridgedMethod(pathname, method), false, `${method} ${pathname}`);
  }
  assert.equal(isBridgedMethod("/api/ai/chat", "POST"), true);
  assert.equal(isBridgedMethod("/api/ai/sessions", "GET"), true);
  assert.equal(isBridgedMethod("/api/ai/sessions", "POST"), true);
});

const testSecret = "a".repeat(64);
const testCookie = `test_bff=${testSecret}`;
function fixture(options: { enabled?: boolean; upstreamStatus?: number; legacyStatus?: number } = {}) {
  const enabled = options.enabled ?? true;
  const calls = { exchange: 0, legacy: 0, cancel: [] as Array<[string, string]> };
  const config = { GROWDESK_CONFIG: { enabled, cookieName: "test_bff" }, config: { isTest: false, isProduction: false } };
  const session = load("lib/growdesk/session.ts", {
    "next/headers": { cookies: () => { throw new Error("Explicit requests must not use ambient cookies"); } },
    "@/lib/config": config,
    "./client": { growdeskFetch: async (url: string, init: any) => {
      calls.exchange++;
      assert.equal(url, "/api/v1/auth/bff/session");
      assert.equal(init.method, "POST");
      assert.equal(init.body.sessionSecretHash, require("node:crypto").createHash("sha256").update(testSecret).digest("hex"));
      const status = options.upstreamStatus ?? 200;
      return status === 200
        ? { ok: true, status, data: { accessToken: "test_token", user: { id: "test_user", username: "test_user" } } }
        : { ok: false, status, error: { code: "TEST_SESSION_ERROR", message: "test_session_error" } };
    } },
    "./bridge-identity": {}, "./bridge-protocol": protocol,
  });
  const csrf = load("lib/growdesk/csrf.ts", { "next/server": { NextResponse }, "@/lib/config": config });
  const route = load("app/api/ai/chat/cancel/route.ts", {
    "next/server": { NextResponse }, "@/lib/config": config,
    "@/lib/api-helpers": { requireAuth: async () => {
      calls.legacy++;
      const status = options.legacyStatus ?? 401;
      return status === 200 ? { user: { id: "test_legacy_user" }, errorResponse: null }
        : { user: null, errorResponse: Response.json({ error: "test_legacy_rejected" }, { status }) };
    } },
    "@/lib/growdesk/session": session, "@/lib/growdesk/csrf": csrf,
    "@/lib/growdesk/bridge-protocol": protocol,
    "@/lib/agent": { activeChatRunManager: { cancelRun: async (sessionId: string, userId: string) => {
      calls.cancel.push([sessionId, userId]);
      return sessionId === "test_session" && ["test_user", "test_legacy_user"].includes(userId);
    } } },
  });
  const routing = load("proxy.ts", {
    "next/server": { NextRequest, NextResponse }, "@/lib/config": config,
    "@/lib/growdesk/bridge-policy": { isBridgedMethod },
  });
  return { route, proxy: routing.proxy, calls };
}
// A state-changing request needs an Origin header from the fixture to exercise the strict CSRF path.
function request(options: { origin?: string | null; cookie?: string | null; body?: unknown } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://test.invalid");
  if (options.cookie !== null) headers.set("cookie", options.cookie ?? testCookie);
  return new Request("https://test.invalid/api/ai/chat/cancel", {
    method: "POST", headers,
    body: JSON.stringify(options.body ?? { sessionId: "test_session", userId: "test_other_user" }),
  });
}

test("BFF-only cancellation uses verified identity and preserves response", async () => {
  const f = fixture();
  const response = await f.route.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, cancelled: true });
  assert.deepEqual(f.calls, { exchange: 1, legacy: 0, cancel: [["test_session", "test_user"]] });
});
for (const cookie of [null, "test_bff=test_invalid"]) {
  test(`BFF mode rejects absent/malformed session without legacy fallback: ${cookie}`, async () => {
    const f = fixture({ legacyStatus: 200 });
    assert.equal((await f.route.POST(request({ cookie }))).status, 401);
    assert.deepEqual(f.calls, { exchange: 0, legacy: 0, cancel: [] });
  });
}
for (const status of [401, 404]) {
  test(`BFF upstream session ${status} rejects auth without legacy fallback`, async () => {
    const f = fixture({ upstreamStatus: status, legacyStatus: 200 });
    assert.equal((await f.route.POST(request())).status, 401);
    assert.deepEqual(f.calls, { exchange: 1, legacy: 0, cancel: [] });
  });
}
test("BFF auth outage preserves upstream status, never cancels or uses legacy auth", async () => {
  const f = fixture({ upstreamStatus: 503 });
  assert.equal((await f.route.POST(request())).status, 503);
  assert.deepEqual(f.calls, { exchange: 1, legacy: 0, cancel: [] });
});
for (const origin of [null, "https://test_other.invalid", "not-an-origin"]) {
  test(`BFF cancellation rejects invalid CSRF origin before side effects: ${origin}`, async () => {
    const f = fixture();
    assert.equal((await f.route.POST(request({ origin }))).status, 403);
    assert.deepEqual(f.calls, { exchange: 0, legacy: 0, cancel: [] });
  });
}
test("BFF same-origin Referer is accepted when Origin is absent", async () => {
  const f = fixture();
  const req = request({ origin: null });
  req.headers.set("referer", "https://test.invalid/test_page");
  assert.equal((await f.route.POST(req)).status, 200);
  assert.equal(f.calls.legacy, 0);
});
test("BFF cancellation validates session ID before invoking the run manager", async () => {
  for (const body of [{}, { sessionId: 42 }, { sessionId: "" }]) {
    const f = fixture();
    assert.equal((await f.route.POST(request({ body }))).status, 400);
    assert.equal(f.calls.cancel.length, 0);
    assert.equal(f.calls.legacy, 0);
  }
});
test("BFF cancellation retains false result for an unavailable run", async () => {
  const f = fixture();
  const response = await f.route.POST(request({ body: { sessionId: "test_missing_session" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, cancelled: false });
  assert.deepEqual(f.calls.cancel, [["test_missing_session", "test_user"]]);
});
for (const status of [200, 401, 403]) {
  test(`legacy mode retains requireAuth result ${status} without BFF exchange`, async () => {
    const f = fixture({ enabled: false, legacyStatus: status });
    const response = await f.route.POST(request({ cookie: null, origin: null }));
    assert.equal(response.status, status);
    assert.deepEqual(f.calls, { exchange: 0, legacy: 1, cancel: status === 200 ? [["test_session", "test_legacy_user"]] : [] });
  });
}

test("isolated HTTP integration: actual proxy policy, cancel route, BFF exchange and CSRF", async (t) => {
  const f = fixture();
  // Ephemeral exclusive loopback listener; no Next dev server, database or provider.
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const requestUrl = `http://127.0.0.1:${(server.address() as any).port}${incoming.url}`;
      const req = new NextRequest(requestUrl, {
        method: incoming.method, headers,
        ...(["GET", "HEAD"].includes(incoming.method!) ? {} : { body: Buffer.concat(chunks) }),
      });
      const fence = f.proxy(req);
      const response = fence.headers.get("x-middleware-next") === "1"
        ? (req.nextUrl.pathname === "/api/ai/chat/cancel" && req.method === "POST"
          ? await f.route.POST(new Request(requestUrl, { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }))
          : new Response(null, { status: 404 }))
        : fence;
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), "x-seen-origin": req.headers.get("origin") ?? "none" });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      outgoing.writeHead(500);
      outgoing.end(String(error));
    }
  });
  server.listen({ host: "127.0.0.1", port: 0, exclusive: true });
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const seen: Record<string, string | undefined> = {};
  const post = (cookie: string | null, origin: string | null) => fetch(`${base}/api/ai/chat/cancel`, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    body: JSON.stringify({ sessionId: "test_session" }),
  }).then(async (res) => {
    seen.origin = res.headers.get("x-seen-origin") ?? undefined;
    return res;
  });
  const ok = await post(testCookie, base);
  const okText = await ok.text();
  assert.equal(ok.status, 200, `real HTTP request must pass proxy and BFF-only cancel; got ${ok.status} body=${okText} server-saw-origin=${seen.origin}`);
  assert.deepEqual(JSON.parse(okText), { success: true, cancelled: true });
  assert.equal((await post(null, base)).status, 401);
  assert.equal((await post(testCookie, null)).status, 403);
  assert.equal((await post(testCookie, "https://test_other.invalid")).status, 403);
  assert.equal((await fetch(`${base}/api/ai/chat/cancel`)).status, 501);
  assert.equal((await fetch(`${base}/api/ai/not-migrated`)).status, 501);
  assert.deepEqual(f.calls, { exchange: 1, legacy: 0, cancel: [["test_session", "test_user"]] });
});
