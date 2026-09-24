import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, DELETE } from "../../app/api/nutrition/schedules/route";
import { GROWDESK_CONFIG } from "../../lib/config";
const babyId = "test_schedule_baby";
const familyId = "test_schedule_family";
const at = "2026-09-01T00:00:00.000Z";
function setup(t: TestContext, override: Record<string, unknown> = {}, deleteResult: unknown = { id: "test_schedule", deleted: true }) {
  const previous = process.env.GROWDESK_ENABLED; process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const product = { id: "test_product", familyId, name: "test_supp", brand: null, dosageForm: "drops", unitName: "滴", defaultDose: "1", nutrientsJson: {}, notes: null, isActive: true, isArchived: false, createdAt: at, updatedAt: at };
  const schedule = { id: "test_schedule", babyId, familyId, productId: product.id, product, targetDose: "2.5", frequency: "daily", isActive: true, isCompletedToday: false, ...override };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    if (url.pathname === `/api/v1/babies/${babyId}`) return Response.json({ data: { id: babyId, familyId, name: babyId, birthDate: "2026-01-01", gender: "girl" } });
    assert.ok(url.pathname.startsWith(`/api/v1/babies/${babyId}/nutrition/supplement-schedules`));
    const method = init?.method ?? "GET";
    if (method !== "GET") writes.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : {} });
    return Response.json({ data: method === "GET" ? [schedule] : method === "DELETE" ? deleteResult : schedule });
  });
  return writes;
}
function request(method = "GET", body?: Record<string, unknown>, query = `?babyId=${babyId}`) {
  return new Request("https://test.invalid/api/nutrition/schedules" + query, { method, headers: { origin: "https://test.invalid", "content-type": "application/json", cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("schedule reads, writes and removal retain explicit baby scope and dose", async t => {
  const writes = setup(t);
  const loaded = await GET(request()); assert.equal(loaded.status, 200);
  assert.equal((await loaded.json()).schedules[0].targetDose, 2.5);
  const result = await POST(request("POST", { babyId, familyId, productId: "test_product", targetDose: 2.5 })); assert.equal(result.status, 200);
  assert.equal(writes[0].body.targetDose, "2.5");
  assert.equal((await DELETE(request("DELETE", undefined, `?babyId=${babyId}&id=test_schedule`))).status, 200);
  assert.equal(writes[1].path, `/api/v1/babies/${babyId}/nutrition/supplement-schedules/test_schedule`);
});
for (const override of [{ babyId: "test_foreign_baby" }, { familyId: "test_foreign_family" }, { productId: "test_wrong_product" }, { targetDose: "0" }]) {
  test(`invalid schedule response ${JSON.stringify(override)} is rejected`, async t => {
    setup(t, override); assert.equal((await GET(request())).status, 502);
  });
}
for (const value of [0, -1, null, false, "NaN", "Infinity"]) {
  test(`explicit invalid dose ${String(value)} never becomes the default dose`, async t => {
    const writes = setup(t);
    const result = await POST(request("POST", { babyId, productId: "test_product", targetDose: value }));
    assert.equal(result.status, 400); assert.deepEqual(writes, []);
  });
}
test("malformed date and false delete acknowledgement are not successful", async t => {
  const writes = setup(t, {}, { success: false });
  assert.equal((await GET(request("GET", undefined, `?babyId=${babyId}&date=not-a-date`))).status, 400);
  assert.equal((await DELETE(request("DELETE", undefined, `?babyId=${babyId}&id=test_schedule`))).status, 502);
  assert.equal(writes.length, 1);
});
