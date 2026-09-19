import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, wireVersion, feedingKind, isoTimestamp, calendarDate, babyPayload, legacyBaby, pathId, type BridgeFetch, type BridgeResult, type ApiBaby } from "../../lib/growdesk/bridge-protocol";
import { loadWebIdentity, loadWebBaby, creationFamilyId } from "../../lib/growdesk/bridge-identity";
import { createIdentityEndpoints } from "../../lib/growdesk/bridge-endpoints";
import { fetchLegacyFeedingList } from "../../lib/growdesk/feeding-list";
import { guardLegacyClient } from "../../lib/growdesk/guard-legacy-client";
import { recordWriteContext } from "../../lib/growdesk/record-write-context";
import { toGrowDeskFeedingCreatePayload, toGrowDeskFeedingUpdatePayload, fromGrowDeskFeedingRecord } from "../../lib/growdesk/feeding-compat";

const apiBaby: ApiBaby = { id: "test_baby_a", familyId: "test_family_a", name: "test_child", birthDate: "2026-01-02", gender: "girl", avatarUrl: null, gestationalWeeks: 38, gestationalDays: 2, createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
const family = { id: "test_family_a", name: "test_home", timeZone: "Asia/Tokyo", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" };
const user = { id: "test_user_a", username: "test_caregiver", displayName: "test_caregiver" };
function fake(handler: (path: string, options: Parameters<BridgeFetch>[1]) => BridgeResult<unknown> | Promise<BridgeResult<unknown>>): BridgeFetch {
  return (async <T>(path: string, options: Parameters<BridgeFetch>[1]) => await handler(path, options) as BridgeResult<T>) as BridgeFetch;
}
function ok(data: unknown, cursor?: string | null): BridgeResult<unknown> {
  return { ok: true, status: 200, data, ...(cursor !== undefined ? { page: { nextCursor: cursor } } : {}) };
}
function fail(status: number): BridgeResult<unknown> { return { ok: false, status, error: { code: `TEST_${status}`, message: "test upstream error" } }; }
const baseFetch = fake(path => path === "/api/v1/families" ? ok([family]) : path.endsWith("/babies") ? ok([apiBaby]) : path.includes("/babies/") ? ok(apiBaby) : ok(family));
const isStatus = (n: number) => (error: unknown) => error instanceof BridgeError && error.status === n;

for (const value of [undefined, null, ""]) test(`version is required: ${String(value)}`, () => assert.throws(() => wireVersion(value), isStatus(428)));
for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "-1", "1e2", "1.0", "01"]) {
  test(`invalid version rejected: ${String(value)}`, () => assert.throws(() => wireVersion(value), isStatus(400)));
}
test("large string versions survive without Number conversion", () => assert.equal(wireVersion("9007199254740993"), "9007199254740993"));
test("bottle breast milk maps both ways and mixed remains distinct", () => {
  assert.equal(feedingKind("bottle_breast"), "bottle"); assert.equal(feedingKind("mixed"), "mixed");
  const record = fromGrowDeskFeedingRecord({ id: "test_feed", babyId: apiBaby.id, familyId: family.id, feedingType: "bottle", occurredAt: "2026-09-13T00:00:00Z", amountMl: "120", leftMinutes: null, rightMinutes: null, spitUp: false, formulaProductId: null, notes: null, source: "ui_manual", sourceAgent: null, version: "9007199254740993", createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z" });
  assert.equal(record.type, "bottle_breast"); assert.equal(record.version, "9007199254740993");
});
test("invalid timestamp is not replaced with the current time", () => assert.throws(() => toGrowDeskFeedingCreatePayload({ type: "formula", timestamp: "invalid" }), isStatus(400)));
test("timezone-naive timestamps are rejected rather than interpreted by the host", () => assert.throws(() => isoTimestamp("2026-09-13T12:00"), isStatus(400)));
test("explicit timezone is normalized", () => assert.equal(isoTimestamp("2026-09-13T12:00:00+09:00"), "2026-09-13T03:00:00.000Z"));
test("invalid calendar days rejected", () => assert.throws(() => calendarDate("2026-02-30"), isStatus(400)));
test("milk decimal precision is preserved", () => assert.equal(toGrowDeskFeedingCreatePayload({ type: "mixed", timestamp: "2026-09-13T00:00:00Z", amountMl: 12.55, leftMinutes: 7 }).amountMl, "12.55"));
test("invalid amount and duration rejected", () => {
  for (const patch of [{ amountMl: -1 }, { amountMl: Infinity }, { leftMinutes: 1.5 }]) assert.throws(() => toGrowDeskFeedingCreatePayload({ type: "formula", timestamp: "2026-09-13T00:00:00Z", ...patch }), isStatus(400));
});
test("update sends the client version as a string without inventing version 1", () => {
  assert.equal(toGrowDeskFeedingUpdatePayload({ baseVersion: 3, notes: "test" }).baseVersion, "3");
  assert.throws(() => toGrowDeskFeedingUpdatePayload({ notes: "test" }), isStatus(428));
});
test("baby wire names, gender and gestation preserve the old UI shape", () => {
  const mapped = legacyBaby(apiBaby); assert.equal(mapped.nickname, "test_child"); assert.equal(mapped.gender, "female"); assert.equal(mapped.gestationalAge, 38); assert.equal(mapped.gestationalDays, 2);
  assert.deepEqual(babyPayload({ nickname: "test_child", birthDate: "2026-01-02", gender: "female", gestationalAge: 38 }), { name: "test_child", birthDate: "2026-01-02", gender: "girl", gestationalWeeks: 38 });
});
test("invalid baby gender is not defaulted to girl", () => assert.throws(() => babyPayload({ nickname: "test", birthDate: "2026-01-02", gender: "invalid" }), isStatus(400)));
test("legacy upload URLs cannot be silently stored as migrated attachments", () => assert.throws(() => babyPayload({ avatarUrl: "/uploads/avatars/test.png" }, true), isStatus(422)));
test("path injection is rejected", () => assert.throws(() => pathId("test_baby/../../auth"), isStatus(400)));

test("identity selects a family with an authorized baby rather than an empty first family", async () => {
  const result = await loadWebIdentity(fake(path => path === "/api/v1/families" ? ok([{ ...family, id: "test_empty" }, family]) : path.includes("test_empty") ? ok([]) : ok([apiBaby])), "test_token");
  assert.equal(result.family?.id, family.id); assert.equal(result.baby?.nickname, apiBaby.name);
});
test("identity propagates upstream failure, not an empty family", async () => {
  await assert.rejects(loadWebIdentity(fake(() => fail(503)), "test_token"), isStatus(503));
});
test("explicit unauthorized baby stays forbidden", async () => {
  await assert.rejects(loadWebBaby(fake(() => fail(403)), "test_token", "test_other_baby"), isStatus(403));
});
test("ambiguous family is not used for creation", async () => {
  await assert.rejects(creationFamilyId(fake(() => ok([family, { ...family, id: "test_family_b" }])), "test_token"), isStatus(409));
});
test("creation rejects family outside returned membership", async () => {
  await assert.rejects(creationFamilyId(baseFetch, "test_token", "test_family_b"), isStatus(403));
});
test("me restores login through BFF session without legacy cookies", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: baseFetch, resolveSession: async () => ({ accessToken: "test_new_token", user }), verifyCsrf: () => null });
  const response = await endpoints.me(new Request("https://test.invalid/api/auth/me"));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json(); assert.equal(data.user.username, "test_caregiver"); assert.equal(data.baby.nickname, "test_child"); assert.equal(data.accessToken, undefined);
});
test("me outage is 502, not a false logout", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: baseFetch, resolveSession: async () => { throw new BridgeError(502, "UPSTREAM_UNAVAILABLE", "test outage"); }, verifyCsrf: () => null });
  const response = await endpoints.me(new Request("https://test.invalid/api/auth/me")); assert.equal(response.status, 502);
});
test("me expired session preserves legacy anonymous shape", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: baseFetch, resolveSession: async () => null, verifyCsrf: () => null });
  assert.equal((await (await endpoints.me(new Request("https://test.invalid/api/auth/me"))).json()).user, null);
});
test("baby POST forwards only canonical fields and the validated family", async () => {
  let payload: unknown;
  const endpoints = createIdentityEndpoints({ fetchApi: fake((path, options) => { if (options?.method === "POST") { assert.equal(path, `/api/v1/families/${family.id}/babies`); payload = options.body; return ok(apiBaby); } return ok([family]); }), resolveSession: async () => ({ accessToken: "test_token", user }), verifyCsrf: () => null });
  const response = await endpoints.baby(new Request("https://test.invalid/api/baby", { method: "POST", body: JSON.stringify({ nickname: "test_child", gender: "female", birthDate: "2026-01-02" }) }));
  assert.equal(response.status, 201); assert.deepEqual(payload, { name: "test_child", gender: "girl", birthDate: "2026-01-02" });
});
test("baby mutation refuses CSRF before resolving a session or doing an upstream write", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: fake(() => { throw new Error("Unexpected upstream call"); }), resolveSession: async () => { throw new Error("Unexpected session call"); }, verifyCsrf: () => Response.json({ error: "test csrf" }, { status: 403 }) });
  assert.equal((await endpoints.baby(new Request("https://test.invalid/api/baby", { method: "PUT", body: "{}" }))).status, 403);
});
test("baby GET with no session is 401", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: baseFetch, resolveSession: async () => null, verifyCsrf: () => null });
  assert.equal((await endpoints.baby(new Request("https://test.invalid/api/baby"))).status, 401);
});
test("malformed baby JSON never produces a default write", async () => {
  const endpoints = createIdentityEndpoints({ fetchApi: baseFetch, resolveSession: async () => ({ accessToken: "test_token", user }), verifyCsrf: () => null });
  assert.equal((await endpoints.baby(new Request("https://test.invalid/api/baby", { method: "POST", body: "[1]" }))).status, 400);
});
test("feeding date filtering respects family timezone and consumes all pages", async () => {
  let pages = 0;
  const fetchApi = fake(path => {
    if (path === `/api/v1/babies/${apiBaby.id}`) return ok(apiBaby);
    if (path === `/api/v1/families/${family.id}`) return ok(family);
    pages++;
    return pages === 1 ? ok([{ id: "test_new", occurredAt: "2026-09-12T15:30:00Z" }], "test_next") : ok([{ id: "test_old", occurredAt: "2026-09-12T14:30:00Z" }], null);
  });
  const data = await fetchLegacyFeedingList<{ id: string; occurredAt: string }>(fetchApi, "test_token", apiBaby.id, new URLSearchParams({ date: "2026-09-13" }));
  assert.equal(pages, 2); assert.deepEqual(data.map(r => r.id), ["test_new"]);
});
test("feeding list can return more than 200 records", async () => {
  let calls = 0;
  const result = await fetchLegacyFeedingList(fake(() => ++calls === 1 ? ok(Array.from({ length: 200 }, (_, i) => ({ id: `test_${i}`, occurredAt: "2026-09-13T00:00:00Z" })), "test_next") : ok([{ id: "test_200", occurredAt: "2026-09-12T00:00:00Z" }], null)), "test_token", apiBaby.id, new URLSearchParams());
  assert.equal(result.length, 201);
});
test("missing pagination metadata fails instead of returning partial data", async () => {
  await assert.rejects(fetchLegacyFeedingList(fake(() => ok([])), "test_token", apiBaby.id, new URLSearchParams()), isStatus(502));
});
test("cursor loop fails instead of repeating records forever", async () => {
  await assert.rejects(fetchLegacyFeedingList(fake(() => ok([], "test_same")), "test_token", apiBaby.id, new URLSearchParams()), isStatus(502));
});
test("explicit legacy limit is honored", async () => {
  const data = await fetchLegacyFeedingList(fake(() => ok([{ occurredAt: "2026-09-13T00:00:00Z" }, { occurredAt: "2026-09-13T01:00:00Z" }], null)), "test_token", apiBaby.id, new URLSearchParams({ limit: "1" }));
  assert.equal(data.length, 1);
});
test("invalid date fails before issuing requests", async () => {
  await assert.rejects(fetchLegacyFeedingList(fake(() => { throw new Error("Unexpected call"); }), "test_token", apiBaby.id, new URLSearchParams({ date: "2026-02-30" })), isStatus(400));
});
test("legacy database is never initialized in GrowDesk mode", () => {
  let calls = 0; const client = guardLegacyClient(() => true, () => { calls++; return { user: {} }; });
  assert.equal(calls, 0); assert.throws(() => client.user, /GROWDESK_LEGACY_DB_DISABLED/); assert.equal(calls, 0);
});
test("legacy mode still initializes once and preserves method binding", () => {
  let calls = 0; const client = guardLegacyClient(() => false, () => { calls++; return { value: 7, read() { return this.value; } }; });
  assert.equal(client.read(), 7); assert.equal(client.read(), 7); assert.equal(calls, 1);
});
test("browser mutation carries selected baby and observed version", () => {
  assert.deepEqual(recordWriteContext({ baby: { id: apiBaby.id }, feedingRecords: [{ id: "test_feed", version: "3" }] }, "feeding", "test_feed"), { babyId: apiBaby.id, baseVersion: "3" });
});
test("browser mutation does not invent a version when data is missing", () => {
  assert.deepEqual(recordWriteContext({ baby: { id: apiBaby.id } }, "feeding", "test_missing"), { babyId: apiBaby.id });
});
test("browser can use a matching timeline version without mixing record types", () => {
  assert.deepEqual(recordWriteContext({ baby: { id: apiBaby.id }, timeline: [{ id: "test_id", type: "feeding", version: "4" }, { id: "test_id", type: "sleep", version: "9" }] }, "feeding", "test_id"), { babyId: apiBaby.id, baseVersion: "4" });
});

test("unsupported reads cannot reach old authentication and falsely log out a BFF user", async () => {
  const { isBridgedMethod } = await import("../../lib/growdesk/bridge-policy");
  for (const path of ["/api/ai/daily-summary", "/api/cron/daily-summary", "/api/unknown"]) {
    assert.equal(isBridgedMethod(path, "GET"), false);
  }
  assert.equal(isBridgedMethod("/api/auth/me", "GET"), true);
  assert.equal(isBridgedMethod("/api/records/daily-summary", "GET"), true);
  assert.equal(isBridgedMethod("/api/family/members", "GET"), true);
});
test("migration policy checks the HTTP method, not just a filename marker", async () => {
  const { isBridgedMethod } = await import("../../lib/growdesk/bridge-policy");
  assert.equal(isBridgedMethod("/api/medical/reports", "POST"), true);
  assert.equal(isBridgedMethod("/api/medical/reports", "DELETE"), false);
  assert.equal(isBridgedMethod("/api/medical/reports/test_report", "DELETE"), false);
  assert.equal(isBridgedMethod("/api/auth/register", "POST"), true);
  assert.equal(isBridgedMethod("/mcp", "POST"), false);
});
test("24:00 is rejected instead of silently changing the recorded date", () => assert.throws(() => isoTimestamp("2026-09-13T24:00:00Z"), isStatus(400)));

test("baby update without an explicit ID never selects the first baby", async () => {
  const endpoints = createIdentityEndpoints({
    resolveSession: async () => ({ accessToken: "test_token", user }),
    verifyCsrf: () => null,
    fetchApi: fake(() => { throw new Error("No upstream call expected"); }),
  });
  const response = await endpoints.baby(new Request("https://test.invalid/api/baby", {
    method: "PUT", body: JSON.stringify({ nickname: "test_new_name" }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_ID");
});
