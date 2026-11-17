import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createECDH } from "node:crypto";
import webPush from "web-push";
import { GROWDESK_CONFIG } from "../../lib/config";
import { POST } from "../../app/api/push/test/route";

// Route behavior only: transport responses and the push gateway are controlled.
// This does not claim database/session authorization or physical-device delivery.
const key = createECDH("prime256v1"); key.generateKeys();
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/test_push_route",
  expirationTime: null,
  keys: { p256dh: key.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") },
};
const user = { id: "test_push_user", username: "test_push_user", displayName: "test_push_user" };
function request(body: unknown = { subscription }, origin = "https://test.invalid") {
  return new Request("https://test.invalid/api/push/test", {
    method: "POST", headers: {
      origin, "content-type": "application/json",
      cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`,
    }, body: JSON.stringify(body),
  });
}
function setup(t: TestContext, registrationStatus = 200) {
  const env = ["GROWDESK_ENABLED", "GROWDESK_BACKEND", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
  const saved = env.map(name => process.env[name]);
  t.after(() => env.forEach((name, i) => {
    if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i];
  }));
  process.env.GROWDESK_ENABLED = "true";
  process.env.GROWDESK_BACKEND = "go";
  const vapid = webPush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
  const writes: Record<string, unknown>[] = [];
  let sendCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_access", user } });
    assert.match(path, /^\/api\/v1\/devices\/[a-f0-9]{32}\/push$/);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test_access");
    writes.push(JSON.parse(String(init?.body)));
    if (registrationStatus !== 200) return Response.json({ error: { code: "TEST_PUSH_OUTAGE", message: "test registration unavailable" } }, { status: registrationStatus });
    return Response.json({ data: { success: true } });
  });
  t.mock.method(webPush, "sendNotification", async () => {
    sendCalls++;
    return { statusCode: 201, body: "", headers: {} };
  });
  return { writes, sendCalls: () => sendCalls };
}

test("test push keeps the full subscription so later background delivery can encrypt", async t => {
  const state = setup(t);
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(String(state.writes[0]?.token)), subscription);
  assert.equal(state.sendCalls(), 1);
  const result = await response.json();
  assert.equal(result.sent, 1);
  assert.equal(result.simulated, undefined);
});

test("missing push configuration fails visibly instead of reporting a simulated send", async t => {
  const state = setup(t);
  delete process.env.VAPID_PRIVATE_KEY;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "PUSH_NOT_CONFIGURED");
  assert.equal(state.sendCalls(), 0);
  assert.equal(state.writes.length, 0);
});

test("registration outages stop a test send and preserve the upstream failure", async t => {
  const state = setup(t, 503);
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TEST_PUSH_OUTAGE");
  assert.equal(state.sendCalls(), 0);
});

test("gateway authorization failure is an error, never simulated success", async t => {
  setup(t);
  t.mock.method(webPush, "sendNotification", async () => { throw Object.assign(new Error("test gateway denied"), { statusCode: 403 }); });
  const response = await POST(request());
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.success, undefined);
  assert.equal(result.simulated, undefined);
  assert.match(result.error, /403/);
});

test("missing current-device subscription fails before saving or sending", async t => {
  const state = setup(t);
  const response = await POST(request({ subscription: null }));
  assert.equal(response.status, 400);
  assert.equal(state.sendCalls(), 0);
  assert.equal(state.writes.length, 0);
});

test("expired subscriptions and gateway timeouts give actionable errors", async t => {
  setup(t);
  let failure: Error & { statusCode?: number; code?: string } = Object.assign(new Error("test gone"), { statusCode: 410 });
  t.mock.method(webPush, "sendNotification", async () => { throw failure; });
  const expired = await POST(request());
  assert.equal(expired.status, 400);
  assert.equal((await expired.json()).code, "PUSH_SUBSCRIPTION_GONE");
  failure = Object.assign(new Error("test timed out"), { code: "ETIMEDOUT" });
  const timeout = await POST(request());
  assert.equal(timeout.status, 504);
  assert.equal((await timeout.json()).code, "PUSH_GATEWAY_TIMEOUT");
});

test("foreign origins are rejected before session or subscription requests", async t => {
  const state = setup(t);
  t.mock.method(globalThis, "fetch", async () => assert.fail("must not exchange session for a foreign origin"));
  assert.equal((await POST(request({ subscription }, "https://test_foreign.invalid"))).status, 403);
  assert.equal(state.sendCalls(), 0);
});

test("untrusted push URLs and invalid keys never reach storage or a gateway", async t => {
  const state = setup(t);
  for (const invalid of [
    { ...subscription, endpoint: "https://127.0.0.1/test_internal" },
    { ...subscription, endpoint: "https://fcm.googleapis.com:8443/test_endpoint" },
    { ...subscription, endpoint: "https://fcm.googleapis.com.test.invalid/test_endpoint" },
    { ...subscription, endpoint: "https://notify.windows.com.test.invalid/test_endpoint" },
    { ...subscription, endpoint: "https://test.notify.windows.com:8443/test_endpoint" },
    { ...subscription, keys: { ...subscription.keys, auth: "bad" } },
  ]) {
    assert.equal((await POST(request({ subscription: invalid }))).status, 400);
  }
  assert.equal(state.writes.length, 0);
  assert.equal(state.sendCalls(), 0);
});

test("Edge WNS endpoints remain supported for manual test notifications", async t => {
  const state = setup(t);
  const edgeSubscription = { ...subscription, endpoint: "https://test.notify.windows.com/w/?token=test_push_route" };
  const response = await POST(request({ subscription: edgeSubscription }));
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(String(state.writes[0].token)), edgeSubscription);
  assert.equal(state.sendCalls(), 1);
});

test("the URL validated by the route is also the URL registered and sent", async t => {
  const state = setup(t);
  let sentEndpoint = "";
  t.mock.method(webPush, "sendNotification", async (value: webPush.PushSubscription) => {
    sentEndpoint = value.endpoint;
    const requestDetails = webPush.generateRequestDetails(value, "test_payload", {
      vapidDetails: { publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY!, subject: "mailto:test@example.invalid" },
    });
    assert.equal(new URL(requestDetails.endpoint).hostname, "fcm.googleapis.com");
    return { statusCode: 201, body: "", headers: {} };
  });
  const response = await POST(request({ subscription: { ...subscription, endpoint: "https:/fcm.googleapis.com/fcm/send/test_push_route" } }));
  assert.equal(response.status, 200);
  assert.equal(sentEndpoint, subscription.endpoint);
  assert.equal(JSON.parse(String(state.writes[0].token)).endpoint, sentEndpoint);
});
