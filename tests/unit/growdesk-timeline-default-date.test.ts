import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../app/api/records/timeline/route";
import { GROWDESK_CONFIG } from "../../lib/config";

test("omitted public timeline date reads today's window instead of all history", async t => {
  const prior = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (prior === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = prior; });
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); calls.push(url);
    if (url.pathname === "/api/v1/auth/bff/session") return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    if (url.pathname === "/api/v1/babies/test_baby") return Response.json({ data: { id: "test_baby", familyId: "test_family" } });
    if (url.pathname === "/api/v1/families/test_family") return Response.json({ data: { id: "test_family", timeZone: "Asia/Shanghai" } });
    if (url.pathname.endsWith("/records/sleep")) return Response.json({ data: [], page: { nextCursor: null } });
    if (url.pathname.endsWith("/timeline")) return Response.json({ data: [{ id: "test_old_event", babyId: "test_baby", entityType: "feeding", entityId: "test_old_record", occurredAt: "2020-01-01T00:00:00.000Z", summary: "old feeding", version: "1" }], page: { nextCursor: null } });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const response = await GET(new Request("https://test.invalid/api/records/timeline?babyId=test_baby", { headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}` } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  const timeline = calls.find(url => url.pathname.endsWith("/timeline"));
  assert.ok(timeline);
  assert.ok(calls.some(url => url.pathname.endsWith("/records/sleep")), "today's interval filter must include overlapping sleep");
});
