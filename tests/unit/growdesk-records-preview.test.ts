import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchLegacyRecordList } from "../../lib/growdesk/record-list";
import { fetchRecordDetail, idempotencyKey, recordPath } from "../../lib/growdesk/record-route-helpers";
import { toGrowDeskSleepCreatePayload, toGrowDeskSleepUpdatePayload } from "../../lib/growdesk/sleep-compat";
import { toGrowDeskDiaperCreatePayload, toGrowDeskDiaperUpdatePayload } from "../../lib/growdesk/diaper-compat";
import { toGrowDeskFoodCreatePayload, toGrowDeskFoodUpdatePayload } from "../../lib/growdesk/food-compat";

const babyId = "test_baby_records";
const familyId = "test_family_records";
const baby = { id: babyId, familyId, name: "test_child", birthDate: "2026-01-01", gender: "other", avatarUrl: null, gestationalWeeks: null, gestationalDays: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const ok = <T>(data: T, nextCursor: string | null = null): BridgeResult<T> => ({ ok: true, status: 200, data, page: { nextCursor } });
const fail = (status: number): BridgeResult<never> => ({ ok: false, status, error: { code: `TEST_${status}`, message: "test upstream error" } });

test("record list helper consumes every canonical page for all timeline record kinds", async () => {
  const calls: string[] = [];
  const fetchApi: BridgeFetch = (async <T>(path: string) => {
    calls.push(path);
    if (path === `/api/v1/babies/${babyId}`) return ok(baby) as BridgeResult<T>;
    if (path === `/api/v1/families/${familyId}`) return ok({ timeZone: "Asia/Tokyo" }) as BridgeResult<T>;
    const page = path.includes("cursor=test_next") ? 2 : 1;
    if (path.includes("/records/feeding")) {
      return (page === 1
        ? ok([{ id: "test_feed_1", occurredAt: "2026-09-12T15:00:00Z" }], "test_next")
        : ok([{ id: "test_feed_2", occurredAt: "2026-09-13T00:00:00Z" }])) as BridgeResult<T>;
    }
    if (path.includes("/records/diaper")) {
      return (page === 1
        ? ok([{ id: "test_diaper_1", occurredAt: "2026-09-12T14:59:59Z" }], "test_next")
        : ok([{ id: "test_diaper_2", occurredAt: "2026-09-12T15:00:00Z" }])) as BridgeResult<T>;
    }
    if (path.includes("/records/food")) {
      return (page === 1
        ? ok([{ id: "test_food_old", recordDate: "2026-09-12" }], "test_next")
        : ok([{ id: "test_food_today", recordDate: "2026-09-13" }])) as BridgeResult<T>;
    }
    return (page === 1
      ? ok([{ id: "test_timeline_old", entityId: "test_timeline_old", occurredAt: "2026-09-12T14:59:59Z", babyId, entityType: "feeding", summary: "old", version: "1" }], "test_next")
      : ok([{ id: "test_timeline_today", entityId: "test_timeline_today", occurredAt: "2026-09-12T15:00:00Z", babyId, entityType: "diaper", summary: "today", version: "2" }])) as BridgeResult<T>;
  }) as BridgeFetch;

  const feeding = await fetchLegacyRecordList(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "feeding");
  const diaper = await fetchLegacyRecordList(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "diaper");
  const food = await fetchLegacyRecordList(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "food");
  const timeline = await fetchLegacyRecordList(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "timeline");

  assert.deepEqual(feeding.map((item) => item.id), ["test_feed_2"]);
  assert.deepEqual(diaper.map((item) => item.id), ["test_diaper_2"]);
  assert.deepEqual(food.map((item) => item.id), ["test_food_today"]);
  assert.deepEqual(timeline.map((item) => item.id), ["test_timeline_today"]);
  assert.ok(calls.filter((path) => path.includes("cursor=test_next")).length >= 4);
});

test("sleep date filter uses overlap boundaries and keeps active intervals", async () => {
  const fetchApi: BridgeFetch = (async <T>(path: string) => {
    if (path === `/api/v1/babies/${babyId}`) return ok(baby) as BridgeResult<T>;
    if (path === `/api/v1/families/${familyId}`) return ok({ timeZone: "Asia/Tokyo" }) as BridgeResult<T>;
    return ok([
      { id: "test_sleep_overlap", startedAt: "2026-09-12T14:00:00Z", endedAt: "2026-09-12T16:00:00Z" },
      { id: "test_sleep_boundary", startedAt: "2026-09-13T14:59:00Z", endedAt: "2026-09-13T15:00:00Z" },
      { id: "test_sleep_active", startedAt: "2026-09-13T14:59:00Z", endedAt: null },
    ]) as BridgeResult<T>;
  }) as BridgeFetch;
  const result = await fetchLegacyRecordList(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "sleep");
  assert.deepEqual(result.map((item) => item.id), ["test_sleep_overlap", "test_sleep_active"]);
});

test("record list helper refuses partial upstream pages and cursor loops", async () => {
  await assert.rejects(
    fetchLegacyRecordList((async () => ({ ok: true, status: 200, data: [] })) as BridgeFetch, "test_token", babyId, new URLSearchParams(), "feeding"),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_INVALID_PAGE",
  );
  await assert.rejects(
    fetchLegacyRecordList((async <T>(path: string) => ok<T>([], "test_same")) as BridgeFetch, "test_token", babyId, new URLSearchParams(), "feeding"),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_CURSOR_LOOP",
  );
});

test("record routes preserve scoped paths, observed versions, and idempotency keys", async () => {
  assert.equal(recordPath("sleep", babyId, "test_sleep_1"), `/api/v1/babies/${babyId}/records/sleep/test_sleep_1`);
  assert.throws(() => recordPath("sleep", babyId, "../other"), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_ID");
  assert.equal(idempotencyKey({ clientId: "test_command_1" }, new Request("https://test.invalid")), "test_command_1");
  assert.equal(idempotencyKey({}, new Request("https://test.invalid", { headers: { "idempotency-key": "test_header_1" } })), "test_header_1");

  const detail = await fetchRecordDetail(
    (async <T>() => ok<T>({ id: "test_sleep_1", babyId })) as BridgeFetch,
    "test_token", babyId, "test_sleep_1", "sleep",
  );
  assert.equal(detail.id, "test_sleep_1");
  await assert.rejects(
    fetchRecordDetail((async <T>() => ok<T>({ id: "test_sleep_1", babyId: "test_other_baby" })) as BridgeFetch, "test_token", babyId, "test_sleep_1", "sleep"),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_SCOPE_MISMATCH",
  );
});

test("record write adapters reject fabricated times and missing versions", () => {
  assert.throws(() => toGrowDeskSleepCreatePayload({ type: "nap", startTime: "not-a-time" }), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_TIMESTAMP");
  assert.throws(() => toGrowDeskSleepUpdatePayload({ notes: "test" }), (error: unknown) => error instanceof BridgeError && error.code === "BASE_VERSION_REQUIRED");
  assert.throws(() => toGrowDeskDiaperCreatePayload({ type: "pee" }), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_TIMESTAMP");
  assert.throws(() => toGrowDeskDiaperUpdatePayload({ version: "1", type: "invalid" }), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_ENUM");
  assert.throws(() => toGrowDeskFoodCreatePayload({ date: "2026-02-30", mealType: "lunch" }), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_DATE");
  assert.throws(() => toGrowDeskFoodUpdatePayload({ version: "1", time: "12:30" }), (error: unknown) => error instanceof BridgeError && error.code === "INVALID_DATE");
});
