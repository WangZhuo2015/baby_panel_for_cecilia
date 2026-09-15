import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, babyPayload, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { dayBoundsInTimeZone, fetchLegacyRecordList, type DatedRecord } from "../../lib/growdesk/record-list";
import { createIdentityEndpoints } from "../../lib/growdesk/bridge-endpoints";
import { fetchRecordDetail, readJsonObject, requireWriteData } from "../../lib/growdesk/record-route-helpers";

const babyId = "test_baby_boundaries";
const familyId = "test_family_boundaries";
type RecordFixture = DatedRecord & { id: string };
const matches = (code: string, status: number) => (error: unknown) => error instanceof BridgeError && error.code === code && error.status === status;
function fixture(page: (path: string) => BridgeResult<unknown>, timeZone = "Asia/Tokyo"): BridgeFetch {
  return async <T>(path: string): Promise<BridgeResult<T>> => {
    const result: BridgeResult<unknown> = path === `/api/v1/babies/${babyId}`
      ? { ok: true, status: 200, data: { id: babyId, familyId } }
      : path === `/api/v1/families/${familyId}`
        ? { ok: true, status: 200, data: { id: familyId, timeZone } }
        : page(path);
    // This cast is confined to the fake generic transport, not production input validation.
    return result as BridgeResult<T>;
  };
}
const page = (data: unknown, nextCursor: string | null = null): BridgeResult<unknown> => ({ ok: true, status: 200, data, page: { nextCursor } });

for (const [zone, date, start, end] of [
  ["Asia/Tokyo", "2026-09-13", "2026-09-12T15:00:00.000Z", "2026-09-13T15:00:00.000Z"],
  ["Asia/Shanghai", "2026-09-13", "2026-09-12T16:00:00.000Z", "2026-09-13T16:00:00.000Z"],
  ["America/New_York", "2026-03-08", "2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
  ["America/New_York", "2026-11-01", "2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
  ["Asia/Kathmandu", "2026-09-13", "2026-09-12T18:15:00.000Z", "2026-09-13T18:15:00.000Z"],
  // Sao Paulo advanced directly from 23:59:59 to 01:00 at this day boundary.
  ["America/Sao_Paulo", "2018-11-04", "2018-11-04T03:00:00.000Z", "2018-11-05T02:00:00.000Z"],
  ["Pacific/Apia", "2011-12-29", "2011-12-29T10:00:00.000Z", "2011-12-30T10:00:00.000Z"],
]) {
  test(`family day is independent of host TZ: ${zone} ${date}`, () => {
    const bounds = dayBoundsInTimeZone(date!, zone!);
    assert.equal(bounds.start.toISOString(), start);
    assert.equal(bounds.end.toISOString(), end);
  });
}

test("nonexistent calendar days and invalid IANA zones fail explicitly", () => {
  assert.throws(() => dayBoundsInTimeZone("2011-12-30", "Pacific/Apia"), matches("NONEXISTENT_LOCAL_DATE", 400));
  assert.throws(() => dayBoundsInTimeZone("2026-02-30", "Asia/Tokyo"), matches("INVALID_DATE", 400));
  assert.throws(() => dayBoundsInTimeZone("2026-09-13", "test_invalid_zone"), matches("UPSTREAM_INVALID_TIMEZONE", 502));
});

test("point events use [start, end), including exact start and excluding exact end", async () => {
  const rows = [
    { id: "test_before", occurredAt: "2026-09-12T14:59:59.999Z" },
    { id: "test_start", occurredAt: "2026-09-12T15:00:00.000Z" },
    { id: "test_last", occurredAt: "2026-09-13T14:59:59.999Z" },
    { id: "test_end", occurredAt: "2026-09-13T15:00:00.000Z" },
  ];
  for (const kind of ["feeding", "diaper", "timeline"] as const) {
    const result = await fetchLegacyRecordList<RecordFixture>(fixture(() => page(rows)), "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), kind);
    assert.deepEqual(result.map(row => row.id), ["test_start", "test_last"]);
  }
});

test("sleep includes overlapping intervals but not intervals merely touching the day", async () => {
  const rows = [
    { id: "test_ends_at_start", startedAt: "2026-09-12T14:00:00Z", endedAt: "2026-09-12T15:00:00Z" },
    { id: "test_straddles", startedAt: "2026-09-12T14:59:00Z", endedAt: "2026-09-12T15:01:00Z" },
    { id: "test_ends_at_end", startedAt: "2026-09-13T14:59:00Z", endedAt: "2026-09-13T15:00:00Z" },
    { id: "test_starts_at_end", startedAt: "2026-09-13T15:00:00Z", endedAt: "2026-09-13T16:00:00Z" },
    { id: "test_active", startedAt: "2026-09-12T14:00:00Z", endedAt: null },
    { id: "test_future_active", startedAt: "2026-09-13T15:00:00Z", endedAt: null },
  ];
  const result = await fetchLegacyRecordList<RecordFixture>(fixture(() => page(rows)), "test_token", babyId, new URLSearchParams({ date: "2026-09-13" }), "sleep");
  assert.deepEqual(result.map(row => row.id), ["test_straddles", "test_ends_at_end", "test_active"]);
});

test("date filtering consumes later pages before applying an explicit result limit", async () => {
  const paths: string[] = [];
  const fetchApi = fixture(path => {
    paths.push(path);
    return path.includes("cursor=")
      ? page([{ id: "test_match", occurredAt: "2026-09-12T15:00:00Z" }])
      : page([{ id: "test_newer", occurredAt: "2026-09-13T15:00:00Z" }], "test_cursor+/=");
  });
  const result = await fetchLegacyRecordList<RecordFixture>(fetchApi, "test_token", babyId, new URLSearchParams({ date: "2026-09-13", limit: "1" }), "feeding");
  assert.deepEqual(result.map(row => row.id), ["test_match"]);
  assert.equal(new URL(paths[1]!, "https://test.invalid").searchParams.get("cursor"), "test_cursor+/=");
});

test("unfiltered legacy history spans more than the canonical page size", async () => {
  let calls = 0;
  const fetchApi = fixture(() => ++calls === 1
    ? page(Array.from({ length: 200 }, (_, index) => ({ id: `test_feed_${index}`, occurredAt: "2026-09-13T00:00:00Z" })), "test_next")
    : page([{ id: "test_feed_200", occurredAt: "2026-09-12T00:00:00Z" }]));
  const result = await fetchLegacyRecordList<RecordFixture>(fetchApi, "test_token", babyId, new URLSearchParams(), "feeding");
  assert.equal(result.length, 201);
  assert.equal(calls, 2);
});

test("a full scan cap fails rather than returning a partial historical day", async () => {
  let calls = 0;
  await assert.rejects(fetchLegacyRecordList(fixture(() => page([], `test_cursor_${++calls}`)), "test_token", babyId, new URLSearchParams(), "feeding"), matches("HISTORY_SCAN_LIMIT", 503));
  assert.equal(calls, 100);
});

test("late upstream errors remain errors, even after useful records were collected", async () => {
  let calls = 0;
  await assert.rejects(fetchLegacyRecordList(fixture(() => ++calls === 1
    ? page([{ occurredAt: "2026-09-13T00:00:00Z" }], "test_next")
    : { ok: false, status: 403, error: { code: "TEST_REVOKED", message: "test_revoked" } }), "test_token", babyId, new URLSearchParams(), "feeding"), matches("TEST_REVOKED", 403));
});

for (const [kind, data, code] of [
  ["feeding", [null], "UPSTREAM_INVALID_RECORD"],
  ["feeding", [{ occurredAt: "2026-09-13T12:00" }], "UPSTREAM_INVALID_TIMESTAMP"],
  ["feeding", [{ occurredAt: "2026-02-30T12:00:00Z" }], "UPSTREAM_INVALID_TIMESTAMP"],
  ["food", [{ recordDate: null }], "UPSTREAM_INVALID_DATE"],
  ["food", [{ recordDate: "2026-02-30" }], "UPSTREAM_INVALID_DATE"],
  ["sleep", [{ startedAt: "2026-09-13T02:00:00Z", endedAt: "2026-09-13T01:00:00Z" }], "UPSTREAM_INVALID_INTERVAL"],
] as const) {
  test(`malformed upstream ${kind} fails as 502: ${code} ${JSON.stringify(data)}`, async () => {
    await assert.rejects(fetchLegacyRecordList(fixture(() => page(data)), "test_token", babyId, new URLSearchParams(), kind), matches(code, 502));
  });
}

test("bad limits and legacy cursors fail before upstream access", async () => {
  const noFetch: BridgeFetch = async () => { throw new Error("Unexpected upstream access"); };
  for (const limit of ["0", "-1", "1.5", "1e2", " 1 ", "20001", ""]) {
    await assert.rejects(fetchLegacyRecordList(noFetch, "test_token", babyId, new URLSearchParams({ limit }), "feeding"), matches("INVALID_LIMIT", 400));
  }
  await assert.rejects(fetchLegacyRecordList(noFetch, "test_token", babyId, new URLSearchParams({ cursor: "test_cursor" }), "feeding"), matches("LEGACY_CURSOR_UNSUPPORTED", 400));
});

test("malformed write JSON is never turned into an empty update", async () => {
  for (const body of ["{", "", "null", "[]", "42", '"text"']) {
    await assert.rejects(readJsonObject(new Request("https://test.invalid", { method: "POST", body })), matches("INVALID_JSON_BODY", 400));
  }
  assert.deepEqual(await readJsonObject(new Request("https://test.invalid", { method: "POST", body: '{"baseVersion":"2"}' })), { baseVersion: "2" });
});

test("null record details and null write acknowledgements are not successful data", async () => {
  await assert.rejects(fetchRecordDetail(fixture(() => page(null)), "test_token", babyId, "test_record", "sleep"), matches("UPSTREAM_SCOPE_MISMATCH", 502));
  assert.throws(() => requireWriteData({ ok: true, status: 200, data: null }, "test invalid write"), matches("UPSTREAM_INVALID_RESPONSE", 502));
});

test("baby profile preserves gestational days, null clearing and contract bounds", () => {
  assert.deepEqual(babyPayload({ gestationalAge: 45, gestationalDays: 6, avatarUrl: null }, true), { gestationalWeeks: 45, gestationalDays: 6, avatarUrl: null });
  assert.deepEqual(babyPayload({ gestationalDays: 0 }, true), { gestationalDays: 0 });
  assert.deepEqual(babyPayload({ gestationalAge: null, gestationalDays: null }, true), { gestationalWeeks: null, gestationalDays: null });
  assert.deepEqual(babyPayload({}, true), {});
  for (const gestationalDays of [-1, 7, 0.5, "2", NaN, false]) {
    assert.throws(() => babyPayload({ gestationalDays }, true), matches("INVALID_GESTATIONAL_DAYS", 400));
  }
  for (const avatarUrl of [false, 0, {}, "https://test.invalid/avatar.jpg"]) {
    assert.throws(() => babyPayload({ avatarUrl }, true), matches("INVALID_AVATAR", 422));
  }
});

for (const method of ["POST", "PUT"] as const) {
  test(`baby ${method} carries gestational precision through the actual BFF endpoint`, async () => {
    let written: unknown;
    let writePath = "";
    const fetchApi: BridgeFetch = async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => {
      if (options?.method === "POST" || options?.method === "PATCH") {
        written = options.body;
        writePath = path;
        return { ok: true, status: 200, data: { id: babyId, familyId, name: "test_baby", birthDate: "2026-01-01", gender: "other", avatarUrl: null, gestationalWeeks: 40, gestationalDays: 0 } as T };
      }
      if (path === `/api/v1/babies/${babyId}`) {
        return { ok: true, status: 200, data: { id: babyId, familyId, name: "test_baby", birthDate: "2026-01-01", gender: "other", avatarUrl: "/api/attachments/00000000-0000-0000-0000-000000000001", gestationalWeeks: 40, gestationalDays: 2 } as T };
      }
      return { ok: true, status: 200, data: [{ id: "test_other_family", name: "test_other_family" }, { id: familyId, name: familyId }] as T };
    };
    const endpoints = createIdentityEndpoints({ fetchApi, verifyCsrf: () => null, resolveSession: async () => ({ accessToken: "test_token", user: { id: "test_user", username: "test_user", displayName: "test_user" } }) });
    const response = await endpoints.baby(new Request("https://test.invalid/api/baby", {
      method, body: JSON.stringify({ babyId, familyId, nickname: "test_baby", birthDate: "2026-01-01", gender: "unknown", gestationalAge: 40, gestationalDays: 0, avatarUrl: null }),
    }));
    assert.equal(response.status, method === "POST" ? 201 : 200);
    assert.equal(writePath, method === "POST" ? `/api/v1/families/${familyId}/babies` : `/api/v1/babies/${babyId}`);
    assert.deepEqual(written, { name: "test_baby", birthDate: "2026-01-01", gender: "other", gestationalWeeks: 40, gestationalDays: 0, avatarUrl: null });
    assert.equal((await response.json()).gestationalDays, 0);
  });
}
