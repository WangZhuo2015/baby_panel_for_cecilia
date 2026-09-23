import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash } from "node:crypto";
import { createNativePushEndpoints, nativePushSubscription } from "../../lib/growdesk/push-bridge";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";
import type { BridgeFetch } from "../../lib/growdesk/bridge-protocol";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const subscription = {
  endpoint: "https://push.example.invalid/test_endpoint",
  expirationTime: null,
  keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") },
};
const request = (body: unknown, method = "POST") => new Request("https://test.invalid/api/push/subscribe", {
  method, headers: { origin: "https://test.invalid", "content-type": "application/json" }, body: JSON.stringify(body),
});
const session = async () => ({ accessToken: "test_verified_access", user: { id: "test_user", username: "test_user", displayName: "test_user" } });

test("native WebPush stores the complete subscription and unregisters the same installation", async () => {
  const calls: { path: string; options: Parameters<BridgeFetch>[1] }[] = [];
  const fetchApi: BridgeFetch = async <T>(path: string, options: Parameters<BridgeFetch>[1]) => {
    calls.push({ path, options });
    return { ok: true, status: 200, data: { success: true } as T };
  };
  const routes = createNativePushEndpoints({ fetchApi, resolveSession: session, verifyCsrf: () => null });
  const installation = createHash("sha256").update(subscription.endpoint).digest("hex").slice(0, 32);
  const registered = await routes.POST(request({ ...subscription, userId: "attacker", token: "ignore" }));
  assert.equal(registered.status, 200);
  assert.deepEqual(await registered.json(), { success: true, id: installation });
  const body = calls[0].options?.body as Record<string, unknown>;
  assert.deepEqual(JSON.parse(String(body.token)), subscription);
  assert.equal(calls[0].options?.accessToken, "test_verified_access");
  assert.equal(Object.hasOwn(body, "userId"), false);
  const removed = await routes.DELETE(request({ endpoint: subscription.endpoint }, "DELETE"));
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { success: true });
  assert.equal(calls[1].path, calls[0].path);
  assert.equal(calls[1].options?.method, "DELETE");
  assert.equal(calls[1].options?.body, undefined);
});

test("native push propagates failed registration and removal instead of returning success", async () => {
  const fetchApi: BridgeFetch = async () => ({ ok: false, status: 503, error: { code: "TEST_OUTAGE", message: "test unavailable" } });
  const routes = createNativePushEndpoints({ fetchApi, resolveSession: session, verifyCsrf: () => null });
  for (const method of ["POST", "DELETE"] as const) {
    const response = await routes[method](request(subscription, method));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "TEST_OUTAGE");
  }
});

test("native push rejects missing keys, bad curve points, bad URLs and malformed bodies before upstream writes", async () => {
  let calls = 0;
  const routes = createNativePushEndpoints({
    fetchApi: async () => { calls++; assert.fail("must not contact upstream"); },
    resolveSession: session, verifyCsrf: () => null,
  });
  for (const body of [
    {}, [], null, { endpoint: subscription.endpoint },
    { ...subscription, endpoint: "http://push.example.invalid/x" },
    { ...subscription, endpoint: "https://user:password@push.example.invalid/x" },
    { ...subscription, keys: { ...subscription.keys, auth: "bad" } },
    { ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65, 4).toString("base64url") } },
    { ...subscription, expirationTime: -1 },
  ]) {
    assert.equal((await routes.POST(request(body))).status, 400);
  }
  assert.equal((await routes.DELETE(request({}, "DELETE"))).status, 400);
  assert.equal((await routes.POST(request({ extra: "x".repeat(9000) }))).status, 413);
  assert.equal(calls, 0);
});

test("native push checks CSRF before session exchange and rejects unauthenticated requests", async () => {
  const routes = createNativePushEndpoints({
    fetchApi: async () => assert.fail("no upstream request"),
    resolveSession: async () => assert.fail("CSRF must run first"),
    verifyCsrf: () => Response.json({ error: "test denied" }, { status: 403 }),
  });
  assert.equal((await routes.POST(request(subscription))).status, 403);
  const anonymous = createNativePushEndpoints({
    fetchApi: async () => assert.fail("no upstream request"),
    resolveSession: async () => null, verifyCsrf: () => null,
  });
  assert.equal((await anonymous.DELETE(request(subscription, "DELETE"))).status, 401);
});

test("native push normalizes valid base64url padding without dropping keys", () => {
  assert.deepEqual(nativePushSubscription({ ...subscription, keys: {
    p256dh: subscription.keys.p256dh + "=", auth: subscription.keys.auth + "==",
  } }), subscription);
});


test("native push routes expose both subscription directions and authenticated key discovery", () => {
  assert.equal(isBridgedMethod("/api/push/subscribe", "POST", "go"), true);
  assert.equal(isBridgedMethod("/api/push/subscribe", "DELETE", "go"), true);
  assert.equal(isBridgedMethod("/api/push/subscribe", "PATCH", "go"), false);
  assert.equal(isBridgedMethod("/api/push/vapid-key", "GET", "go"), true);
  assert.equal(isBridgedMethod("/api/push/vapid-key", "POST", "go"), false);
});
