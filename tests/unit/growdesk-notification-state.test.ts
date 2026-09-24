import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { projectNotificationReadState } from "../../lib/growdesk/notification-state";
import { fetchGrowDeskNotificationItems } from "../../lib/growdesk/notification-parity";
import { GROWDESK_CONFIG } from "../../lib/config";
import { GET } from "../../app/api/notifications/route";
import { POST } from "../../app/api/notifications/[id]/route";

const id = "550e8400-e29b-41d4-a716-446655440000";
const remote = { id, userId: "test_reader", eventKey: "daily.test", title: "test_notice", body: "test_body", createdAt: "2026-09-24T00:00:00.000Z", readAt: null };

test("legacy notification projection is unchanged while extended projection retains exact read state", () => {
  const item = { id, title: "test_notice" };
  assert.equal(projectNotificationReadState(item, { id, readAt: undefined }, false), item);
  assert.deepEqual(projectNotificationReadState(item, { id, readAt: null }, true), { ...item, serverNotificationId: id, readAt: null });
  assert.equal(projectNotificationReadState(item, { id, readAt: "2026-09-24T09:00:00+09:00" }, true).readAt, "2026-09-24T00:00:00.000Z");
  for (const invalid of [undefined, false, 0, "invalid", "2026-02-30T00:00:00Z"]) {
    assert.throws(() => projectNotificationReadState(item, { id, readAt: invalid }, true), { code: "UPSTREAM_INVALID_NOTIFICATION_STATE" });
  }
  assert.throws(() => projectNotificationReadState(item, { id: "test_other", readAt: null }, true));
});

test("the actual notification aggregator forwards authoritative state only on opt-in", async () => {
  const fetchApi = async <T>() => ({ ok: true, status: 200, data: [remote] as T, page: { nextCursor: null } });
  const legacy = await fetchGrowDeskNotificationItems(fetchApi, "test_token", "test_reader");
  const extended = await fetchGrowDeskNotificationItems(fetchApi, "test_token", "test_reader", undefined, Date.now(), true);
  assert.equal("readAt" in legacy[0]!, false);
  assert.equal("serverNotificationId" in legacy[0]!, false);
  assert.equal(extended[0]?.serverNotificationId, id);
  assert.equal(extended[0]?.readAt, null);
  const invalid = async <T>() => ({ ok: true, status: 200, data: [{ ...remote, readAt: undefined }] as T, page: { nextCursor: null } });
  await assert.rejects(fetchGrowDeskNotificationItems(invalid, "test_token", "test_reader", undefined, Date.now(), true), { code: "UPSTREAM_INVALID_NOTIFICATION_STATE" });
});

function setup(t: TestContext, handler: (url: URL, init?: RequestInit) => Response) {
  const enabled = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (enabled === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = enabled; });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user: { id: "test_reader", username: "test_reader", displayName: "test_reader" } } });
    return handler(url, init);
  });
}
function request(method: "GET" | "POST", expected = "test_reader", suffix = "") {
  return new Request(`https://test.invalid/api/notifications${suffix}`, { method, headers: {
    cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}`, origin: "https://test.invalid",
    "x-growdesk-expected-user": expected, "x-growdesk-representation": "extended",
  } });
}

test("GET and POST reject an old tab's expected user before business reads or writes", async t => {
  let businessCalls = 0;
  setup(t, () => { businessCalls++; throw new Error("Must not contact business endpoints"); });
  const list = await GET(request("GET", "test_old_user"));
  const read = await POST(request("POST", "test_old_user", `/${id}`), { params: Promise.resolve({ id }) });
  assert.equal(list.status, 409);
  assert.equal(read.status, 409);
  assert.equal((await list.json()).code, "IDENTITY_CHANGED");
  assert.equal(businessCalls, 0);
});

test("extended GET exposes readAt without changing the notification list envelope", async t => {
  setup(t, url => {
    if (url.pathname === "/api/v1/families") return Response.json({ data: [] });
    assert.equal(url.pathname, "/api/v1/notifications");
    return Response.json({ data: [remote], page: { nextCursor: null } });
  });
  const response = await GET(request("GET"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.ok(Array.isArray(data));
  assert.equal(data[0].serverNotificationId, id);
  assert.equal(data[0].readAt, null);
});

test("notification family mismatch fails before loading another scope's notifications", async t => {
  setup(t, url => {
    assert.equal(url.pathname, "/api/v1/babies/test_baby");
    return Response.json({ data: { id: "test_baby", familyId: "test_actual_family", name: "test_baby", gender: "girl", birthDate: "2026-01-01" } });
  });
  const response = await GET(request("GET", "test_reader", "?babyId=test_baby&familyId=test_other_family"));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "BABY_SCOPE_MISMATCH");
});

test("failed read acknowledgement retains the upstream outage status", async t => {
  setup(t, url => {
    assert.equal(url.pathname, `/api/v1/notifications/${id}/read`);
    return Response.json({ error: { code: "TEST_OUTAGE", message: "test_failure" } }, { status: 503 });
  });
  const response = await POST(request("POST", "test_reader", `/${id}`), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "TEST_OUTAGE");
});
