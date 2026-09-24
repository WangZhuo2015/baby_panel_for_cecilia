import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { GROWDESK_CONFIG } from "../../lib/config";
import { POST as markNotification, PATCH as patchNotification } from "../../app/api/notifications/[id]/route";
import { GET as getVoice, PATCH as acknowledgeVoice } from "../../app/api/agent/voice/logs/[id]/route";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

const id = "550e8400-e29b-41d4-a716-446655440000";
const user = { id: "test_user", username: "test_user", displayName: "test_user" };
const context = { params: Promise.resolve({ id }) };
const voice = { id, userId: user.id, familyId: "test_family", babyId: "test_baby", prompt: "test prompt", reply: "test reply", isAsync: true, isFastPath: false, acknowledged: false, createdAt: "2026-01-01T00:00:00.000Z", baby: null };
function request(method: string, body?: unknown, origin = "https://test.invalid") {
  return new Request(`https://test.invalid/api/agent/voice/logs/${id}`, {
    method, headers: { origin, "content-type": "application/json", cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function setup(t: TestContext) {
  const old = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "1";
  t.after(() => { if (old === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = old; });
}

test("private history routes are reachable without opening unsupported methods", () => {
  for (const backend of ["go", "typescript"] as const) {
    for (const method of ["POST", "PATCH"]) assert.equal(isBridgedMethod(`/api/notifications/${id}`, method, backend), true);
    for (const method of ["GET", "DELETE"]) assert.equal(isBridgedMethod(`/api/notifications/${id}`, method, backend), false);
    for (const method of ["GET", "PATCH"]) assert.equal(isBridgedMethod(`/api/agent/voice/logs/${id}`, method, backend), true);
    assert.equal(isBridgedMethod(`/api/agent/voice/logs/${id}`, "POST", backend), false);
  }
});

test("notification POST/PATCH and voice acknowledgement retain old response shapes with verified credentials", async t => {
  setup(t);
  const writes: { path: string; method?: string; body: unknown }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_access", user } });
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test_access");
    if (path === `/api/v1/voice/logs/${id}` && init?.method === "GET") return Response.json({ data: voice });
    writes.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ data: { success: true } });
  });
  for (const [handler, method] of [[markNotification, "POST"], [patchNotification, "PATCH"]] as const) {
    const response = await handler(request(method), context);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }
  assert.deepEqual(writes.slice(0, 2).map(x => [x.path, x.method]), Array(2).fill([`/api/v1/notifications/${id}/read`, "POST"]));
  const read = await getVoice(request("GET"), context);
  assert.equal(read.status, 200);
  assert.equal((await read.json()).log.reply, "test reply");
  for (const acknowledged of [true, false, "true", "false"]) {
    assert.equal((await acknowledgeVoice(request("PATCH", { acknowledged, userId: "test_attacker" }), context)).status, 200);
    assert.deepEqual(writes.at(-1)?.body, { acknowledged: acknowledged === true || acknowledged === "true" });
  }
});

test("private writes reject foreign origins before session exchange or upstream access", async t => {
  setup(t);
  t.mock.method(globalThis, "fetch", async () => assert.fail("CSRF must run first"));
  for (const handler of [markNotification, patchNotification, acknowledgeVoice]) {
    assert.equal((await handler(request("PATCH", { acknowledged: true }, "https://test-attacker.invalid"), context)).status, 403);
  }
});

test("private history preserves denial and upstream errors including BFF session exchange failure", async t => {
  setup(t);
  let status = 503;
  let sessionFailure = true;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (!sessionFailure && new URL(String(input)).pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_access", user } });
    return Response.json({ error: { code: "TEST_DENIED", message: "test unavailable" } }, { status });
  });
  assert.equal((await markNotification(request("POST"), context)).status, 503);
  sessionFailure = false;
  for (status of [403, 404, 503]) {
    for (const [handler, method] of [[markNotification, "POST"], [getVoice, "GET"], [acknowledgeVoice, "PATCH"]] as const) {
      const result = await handler(request(method, method === "PATCH" ? { acknowledged: true } : undefined), context);
      assert.equal(result.status, status);
      assert.equal((await result.json()).code, "TEST_DENIED");
    }
  }
});

test("invalid acknowledgement and mismatched private response are rejected", async t => {
  setup(t);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_access", user } });
    assert.equal(init?.method, "GET", "malformed writes must not reach the backend");
    return Response.json({ data: { ...voice, userId: "test_other_user" } });
  });
  for (const body of [null, [], {}, { acknowledged: 1 }, { acknowledged: "false-ish" }]) {
    assert.equal((await acknowledgeVoice(request("PATCH", body), context)).status, 400);
  }
  const response = await getVoice(request("GET"), context);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "UPSTREAM_SCOPE_MISMATCH");
});


test("private acknowledgement requires explicit upstream success", async t => {
  setup(t);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    if (new URL(String(input)).pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_access", user } });
    return Response.json({ data: { success: false } });
  });
  assert.equal((await markNotification(request("POST"), context)).status, 502);
  assert.equal((await acknowledgeVoice(request("PATCH", { acknowledged: true }), context)).status, 502);
});
