import test from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../../app/api/nutrition/records/route";
import { GROWDESK_CONFIG } from "../../lib/config";
import { fetchCompleteList } from "../../lib/growdesk/paged-list";

function setup(t: any, handler: (url: URL, init?: RequestInit) => Response) {
  const prior = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (prior === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = prior; });
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    if (url.pathname === "/api/v1/babies/test_baby") return Response.json({ data: { id: "test_baby", familyId: "test_family", nickname: "test_baby", birthDate: "2026-01-01", gender: "female" } });
    return handler(url, init);
  });
}
function request(body?: Record<string, unknown>) {
  return new Request(`https://test.invalid/api/nutrition/records${body ? "" : "?babyId=test_baby&date=2026-09-17"}`, {
    method: body ? "POST" : "GET", headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}`, origin: "https://test.invalid", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const record = (id: string, occurredAt: string) => ({ id, babyId: "test_baby", familyId: "test_family", supplementName: "test_supplement", amount: "1 滴", occurredAt, notes: null, version: "1", createdAt: occurredAt, updatedAt: occurredAt });
test("supplement history filters a requested old date after fetching every page", async t => {
  let pages = 0;
  setup(t, url => {
    if (url.pathname.endsWith("/food-plan")) return Response.json({ data: { planData: {} } });
    assert.ok(url.pathname.endsWith("/records/supplement")); pages++;
    return url.searchParams.has("cursor")
      ? Response.json({ data: [record("test_old", "2026-09-17T01:00:00.000Z")], page: { nextCursor: null } })
      : Response.json({ data: Array.from({ length: 100 }, (_, i) => record(`test_recent_${i}`, "2026-09-19T01:00:00.000Z")), page: { nextCursor: "test_page_2" } });
  });
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).records.map((r: any) => r.id), ["test_old"]);
  assert.equal(pages, 2);
});
test("supplement guard fails closed on incomplete upstream data before writing", async t => {
  let writes = 0;
  setup(t, (_url, init) => {
    if (init?.method === "POST") writes++;
    return Response.json({ error: { code: "UNAVAILABLE", message: "test unavailable" } }, { status: 503 });
  });
  const response = await POST(request({ babyId: "test_baby", supplementName: "test_supplement", date: "2026-09-17", dose: 1 }));
  assert.equal(response.status, 503);
  assert.equal(writes, 0);
});
test("complete list retains archived-product filter on every continuation page", async () => {
  const paths: string[] = [];
  const result = await fetchCompleteList(async <T>(path: string) => {
    paths.push(path); const url = new URL(path, "http://test.invalid");
    assert.equal(url.searchParams.get("includeArchived"), "true");
    return { ok: true, status: 200, data: [paths.length] as T, page: { nextCursor: paths.length === 1 ? "test_next" : null } };
  }, "test_token", "/api/v1/families/test_family/nutrition/products?includeArchived=true");
  assert.deepEqual(result, [1, 2]);
  assert.equal(paths.length, 2);
});
