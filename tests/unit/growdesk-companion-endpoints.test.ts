import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCompanionEndpoints } from "../../lib/growdesk/companion-endpoints";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { isBridgedMethod } from "../../lib/growdesk/bridge-policy";

const origin = "https://test-web.invalid";
const id = "550e8400-e29b-41d4-a716-446655440000";
const session = { accessToken: "test_access", user: { id: "test_user", username: "test_user", displayName: "Test" } };
const subscription = {
  endpoint: "https://push.example.test/send/test_endpoint",
  keys: {
    p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url"),
    auth: Buffer.alloc(16, 5).toString("base64url"),
  },
};
function request(path: string, method = "GET", body?: unknown, from = origin): Request {
  return new Request(origin + path, {
    method, headers: { origin: from, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function setup(response: BridgeResult<unknown> = { ok: true, status: 200, data: { success: true } }) {
  const calls: Array<{ path: string; options: Parameters<BridgeFetch>[1] }> = [];
  let resolves = 0;
  const api: BridgeFetch = async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => {
    calls.push({ path, options });
    return response as BridgeResult<T>;
  };
  const handlers = createCompanionEndpoints({
    fetchApi: api,
    resolveSession: async () => { resolves++; return session; },
    verifyCsrf: req => req.headers.get("origin") === origin ? null : Response.json({ code: "CSRF" }, { status: 403 }),
    publicPushKey: () => "test_public_key",
  });
  return { handlers, calls, resolves: () => resolves };
}

test("push registration persists both encryption keys, stable installation ID and legacy response", async () => {
  const s = setup();
  const req = request("/api/push/subscribe", "POST", { ...subscription, userId: "attacker", extra: true });
  const response = await s.handlers.subscribe(req);
  assert.equal(response.status, 200);
  const expected = createHash("sha256").update(subscription.endpoint).digest("hex").slice(0, 32);
  assert.deepEqual(await response.json(), { success: true, id: expected });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].path, `/api/v1/devices/${expected}/push`);
  assert.equal(s.calls[0].options?.accessToken, session.accessToken);
  assert.equal(s.calls[0].options?.signal, req.signal);
  const body = s.calls[0].options?.body as { token: string; platform: string };
  assert.equal(body.platform, "web");
  assert.deepEqual(JSON.parse(body.token), subscription);
});

test("push unregistration uses exactly the same ID and is not silently successful on upstream failure", async () => {
  for (const status of [401, 403, 404, 409, 429, 503]) {
    const s = setup({ ok: false, status, error: { code: "TEST_FAILURE", message: "Unavailable" } });
    const result = await s.handlers.unsubscribe(request("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint }));
    assert.equal(result.status, status);
    assert.equal((await result.json()).code, "TEST_FAILURE");
    assert.equal(s.calls[0].options?.method, "DELETE");
  }
  const s = setup();
  assert.equal((await s.handlers.unsubscribe(request("/api/push/subscribe", "DELETE", { endpoint: subscription.endpoint }))).status, 200);
});

test("malformed subscriptions and missing endpoint never call the backend", async () => {
  for (const input of [
    {}, [], null,
    { ...subscription, endpoint: "http://push.example.test/x" },
    { ...subscription, endpoint: "https://user:password@push.example.test/x" },
    { ...subscription, endpoint: subscription.endpoint + "#fragment" },
    { ...subscription, keys: undefined },
    { ...subscription, keys: { ...subscription.keys, auth: "short" } },
    { ...subscription, keys: { ...subscription.keys, p256dh: Buffer.alloc(65).toString("base64url") } },
  ]) {
    const s = setup();
    assert.equal((await s.handlers.subscribe(request("/api/push/subscribe", "POST", input))).status, 400);
    assert.equal(s.calls.length, 0);
  }
  const s = setup();
  assert.equal((await s.handlers.unsubscribe(request("/api/push/subscribe", "DELETE", {}))).status, 400);
  assert.equal(s.calls.length, 0);
});

test("all companion writes enforce CSRF before resolving session", async () => {
  const s = setup();
  const methods = [
    () => s.handlers.subscribe(request("/api/push/subscribe", "POST", subscription, "https://evil.test")),
    () => s.handlers.unsubscribe(request("/api/push/subscribe", "DELETE", subscription, "https://evil.test")),
    () => s.handlers.readNotification(request(`/api/notifications/${id}`, "POST", undefined, "https://evil.test"), id),
    () => s.handlers.acknowledgeVoiceLog(request(`/api/agent/voice/logs/${id}`, "PATCH", {}, "https://evil.test"), id),
  ];
  for (const invoke of methods) assert.equal((await invoke()).status, 403);
  assert.equal(s.resolves(), 0);
  assert.equal(s.calls.length, 0);
});

test("VAPID public key is exposed only after current BFF session resolution", async () => {
  const s = setup();
  const response = await s.handlers.pushPublicKey(request("/api/push/vapid-key"));
  assert.deepEqual(await response.json(), { publicKey: "test_public_key" });
  assert.equal(s.calls.length, 0);
  assert.equal(s.resolves(), 1);
  for (const absent of [true, false]) {
    const h = createCompanionEndpoints({
      fetchApi: async () => { throw new Error("must not call"); },
      resolveSession: async () => absent ? null : session,
      verifyCsrf: () => null, publicPushKey: () => "",
    });
    assert.equal((await h.pushPublicKey(request("/api/push/vapid-key"))).status, absent ? 401 : 503);
  }
});

test("session outages remain outages instead of becoming unauthorized or success", async () => {
  const h = createCompanionEndpoints({
    fetchApi: async () => { throw new Error("must not call"); },
    resolveSession: async () => { throw new BridgeError(503, "TEST_OUTAGE", "Unavailable"); },
    verifyCsrf: () => null, publicPushKey: () => "",
  });
  const r = await h.readNotification(request(`/api/notifications/${id}`, "POST"), id);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "TEST_OUTAGE");
});

test("notification read keeps the old success response only after canonical confirmation", async () => {
  for (const data of [{}, null, { success: false }, true]) {
    const s = setup({ ok: true, status: 200, data });
    assert.equal((await s.handlers.readNotification(request(`/api/notifications/${id}`, "PATCH"), id)).status, 502);
  }
  const s = setup();
  const r = await s.handlers.readNotification(request(`/api/notifications/${id}`, "PATCH"), id);
  assert.equal(r.status, 200);
  assert.equal(s.calls[0].path, `/api/v1/notifications/${id}/read`);
  assert.equal(s.calls[0].options?.method, "POST");
});

test("voice acknowledgement preserves false and rejects missing or ambiguous values", async () => {
  for (const raw of [false, true, "false", "true"]) {
    const s = setup();
    assert.equal((await s.handlers.acknowledgeVoiceLog(request("/api/agent/voice/logs/" + id, "PATCH", { acknowledged: raw }), id)).status, 200);
    assert.deepEqual(s.calls[0].options?.body, { acknowledged: raw === true || raw === "true" });
  }
  for (const raw of [null, undefined, 0, "no"]) {
    const s = setup();
    assert.equal((await s.handlers.acknowledgeVoiceLog(request("/api/agent/voice/logs/" + id, "PATCH", { acknowledged: raw }), id)).status, 400);
    assert.equal(s.calls.length, 0);
  }
});

test("voice detail rejects foreign user, mismatched record or baby returned by the backend", async () => {
  const log = {
    id, userId: session.user.id, babyId: "test_baby", familyId: "test_family",
    prompt: "test", reply: "test", isAsync: true, isFastPath: false,
    acknowledged: false, createdAt: "2026-09-23T00:00:00.000Z",
    baby: { id: "test_baby", nickname: "test", gender: "girl" },
  };
  const s = setup({ ok: true, status: 200, data: log });
  assert.equal((await s.handlers.getVoiceLog(request("/api/agent/voice/logs/" + id), id)).status, 200);
  for (const delta of [{ userId: "other" }, { id: "other" }, { baby: { ...log.baby, id: "other" } }]) {
    const t = setup({ ok: true, status: 200, data: { ...log, ...delta } });
    assert.equal((await t.handlers.getVoiceLog(request("/api/agent/voice/logs/" + id), id)).status, 502);
  }
});

test("migration fence exposes the implemented companion methods without wildcard write access", () => {
  for (const backend of ["go", "typescript"] as const) {
    for (const [path, method] of [
      ["/api/push/vapid-key", "GET"], ["/api/push/subscribe", "DELETE"],
      [`/api/agent/voice/logs/${id}`, "GET"], [`/api/agent/voice/logs/${id}`, "PATCH"],
      [`/api/notifications/${id}`, "POST"], [`/api/notifications/${id}`, "PATCH"],
    ]) assert.equal(isBridgedMethod(path, method, backend), true, path);
    assert.equal(isBridgedMethod(`/api/agent/voice/logs/${id}`, "DELETE", backend), false);
    assert.equal(isBridgedMethod(`/api/notifications/${id}/other`, "POST", backend), false);
  }
});
