import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchTimelineDetailMaps, type TimelineDetailReference } from "../../lib/growdesk/timeline-details";
import { fromGrowDeskTimelineResponse } from "../../lib/growdesk/timeline-compat";

const BABY = "test_baby_timeline";
const TOKEN = "test_access_token";
const VERSION = "9007199254740993";
type Options = Parameters<BridgeFetch>[1];

function api(handler: (path: string, options: Options) => BridgeResult<unknown> | Promise<BridgeResult<unknown>>): BridgeFetch {
  return async <T>(path: string, options?: Options): Promise<BridgeResult<T>> =>
    await handler(path, options) as BridgeResult<T>;
}
function reference(entityId = "test_record_old", kind: TimelineDetailReference["entityType"] = "feeding"): TimelineDetailReference {
  return { babyId: BABY, entityType: kind, entityId, version: VERSION };
}
function record(id = "test_record_old") {
  return { id, babyId: BABY, version: VERSION, feedingType: "bottle", occurredAt: "2026-09-01T08:00:00.000Z", amountMl: "120.5" };
}
function page(data: unknown[], nextCursor: string | null = null): BridgeResult<unknown> {
  return { ok: true, status: 200, data, page: { nextCursor } };
}
function code(expectedCode: string, status: number) {
  return (error: unknown) => error instanceof BridgeError && error.code === expectedCode && error.status === status;
}

// This suite tests the Web adapter against an explicit simulated HTTP boundary.
// It does not claim to execute Next.js, PostgreSQL, or production migration.
test("historical timeline details beyond the first 200 records are found without truncation", async () => {
  const calls: string[] = [];
  const fetchApi = api((path, options) => {
    calls.push(path);
    assert.equal(options?.accessToken, TOKEN);
    const url = new URL(path, "http://localhost");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.pathname, `/api/v1/babies/${BABY}/records/feeding`);
    const cursor = url.searchParams.get("cursor");
    if (cursor === null) return page(Array.from({ length: 100 }, (_, i) => record(`test_recent_a_${i}`)), "next-a");
    if (cursor === "next-a") return page(Array.from({ length: 100 }, (_, i) => record(`test_recent_b_${i}`)), "next-b");
    assert.equal(cursor, "next-b");
    return page([record()]);
  });
  const result = await fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, [reference()]);
  assert.equal(calls.length, 3);
  assert.equal(result.feedings.size, 1);
  assert.equal(result.feedings.get("test_record_old")?.version, VERSION);
  assert.equal(result.feedings.get("test_record_old")?.type, "bottle_breast");
  assert.equal(result.feedings.get("test_record_old")?.feedingType, "bottle");
});

test("canonical bottle details produce the legacy bottle-breast edit payload and label", async () => {
  const ref = reference();
  const maps = await fetchTimelineDetailMaps(api(() => page([record()])), TOKEN, BABY, [ref]);
  const [item] = fromGrowDeskTimelineResponse([{
    ...ref, id: "test_timeline_entry", occurredAt: "2026-09-01T08:00:00.000Z", summary: "Feeding: bottle 120.5ml",
  }], maps);
  assert.equal(item?.title, "瓶喂母乳");
  assert.equal(item?.rawRecord.type, "bottle_breast");
  assert.equal(item?.rawRecord.amountMl, 120.5);
  assert.equal(item?.baseVersion, VERSION);
  assert.equal(item?.rawRecord.baseVersion, VERSION);
});

test("detail scans stop as soon as all requested IDs are found", async () => {
  let calls = 0;
  const result = await fetchTimelineDetailMaps(api(() => {
    calls += 1;
    return page([record(), record("test_unrequested")], "unneeded-next-page");
  }), TOKEN, BABY, [reference(), reference()]);
  assert.equal(calls, 1);
  assert.equal(result.feedings.size, 1);
});

test("care detail resolution skips persisted medical/vaccine projections and preserves all six care kinds", async () => {
  const kinds = ["feeding", "sleep", "diaper", "food", "supplement", "growth"] as const;
  const calls: string[] = [];
  const maps = await fetchTimelineDetailMaps(api(path => {
    const kind = new URL(path, "https://test.invalid").pathname.split("/").at(-1)!;
    calls.push(kind);
    return page([record(`test_${kind}`)]);
  }), TOKEN, BABY, [
    ...kinds.map(kind => reference(`test_${kind}`, kind)),
    ...["vaccine", "medical"].map(kind => ({ ...reference(`test_${kind}`), entityType: kind } as TimelineDetailReference)),
  ]);
  assert.deepEqual(calls.sort(), ["diaper", "feeding", "food", "sleep", "supplement"]);
  for (const map of Object.values(maps)) assert.equal(map.size, 1);
  await assert.rejects(fetchTimelineDetailMaps(api(() => page([])), TOKEN, BABY,
    [{ ...reference(), entityType: "unknown" } as unknown as TimelineDetailReference]), code("UPSTREAM_INVALID_RECORD", 502));
});

test("empty timelines and growth-only timelines do not make unrelated detail calls", async () => {
  const fetchApi = api(() => { throw new Error("Unexpected upstream call"); });
  const empty = await fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, []);
  const growth = await fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, [reference("test_growth", "growth")]);
  assert.equal(empty.feedings.size, 0);
  assert.equal(growth.feedings.size, 0);
  assert.equal(growth.sleeps.size, 0);
});

for (const status of [401, 403, 429, 500, 503]) {
  test(`upstream ${status} propagates instead of becoming a successful empty detail map`, async () => {
    const fetchApi = api(() => ({ ok: false, status, error: { code: "TEST_UPSTREAM_ERROR", message: "test failure" } }));
    await assert.rejects(fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, [reference()]), code("TEST_UPSTREAM_ERROR", status));
  });
}

test("transport rejections are not swallowed", async () => {
  const error = new Error("test transport unavailable");
  await assert.rejects(fetchTimelineDetailMaps(api(() => { throw error; }), TOKEN, BABY, [reference()]),
    value => value === error);
});

test("a record deleted between timeline and detail reads produces a conflict, not a fake editable record", async () => {
  await assert.rejects(fetchTimelineDetailMaps(api(() => page([])), TOKEN, BABY, [reference()]),
    code("TIMELINE_DETAILS_MISSING", 409));
});

test("a concurrent edit cannot pair a new detail payload with the old timeline version", async () => {
  await assert.rejects(fetchTimelineDetailMaps(api(() => page([{ ...record(), version: "9007199254740994" }])),
    TOKEN, BABY, [reference()]), code("TIMELINE_CHANGED", 409));
});

test("detail records from another baby fail closed", async () => {
  await assert.rejects(fetchTimelineDetailMaps(api(() => page([{ ...record(), babyId: "test_other_baby" }])),
    TOKEN, BABY, [reference()]), code("UPSTREAM_INVALID_RECORD", 502));
});

test("cross-baby timeline references and conflicting duplicate versions are rejected before HTTP", async () => {
  const fetchApi = api(() => { throw new Error("Unexpected upstream call"); });
  await assert.rejects(fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, [{ ...reference(), babyId: "test_other_baby" }]),
    code("UPSTREAM_INVALID_RECORD", 502));
  await assert.rejects(fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, [reference(), { ...reference(), version: "2" }]),
    code("UPSTREAM_INVALID_RECORD", 502));
});

test("malformed pages and missing cursor metadata are errors", async () => {
  for (const result of [
    { ok: true, status: 200, data: [record()] },
    { ok: true, status: 200, data: {}, page: { nextCursor: null } },
    page(Array.from({ length: 101 }, (_, i) => record(`test_record_${i}`))),
    page([record()], ""),
  ]) {
    await assert.rejects(fetchTimelineDetailMaps(api(() => result), TOKEN, BABY, [reference()]),
      code("UPSTREAM_INVALID_PAGE", 502));
  }
});

test("repeated cursors and empty nonterminal pages cannot loop indefinitely", async () => {
  let calls = 0;
  await assert.rejects(fetchTimelineDetailMaps(api(() => {
    calls += 1;
    return page([record(`test_unrequested_${calls}`)], "repeated");
  }), TOKEN, BABY, [reference()]), code("UPSTREAM_CURSOR_LOOP", 502));
  assert.equal(calls, 2);
  await assert.rejects(fetchTimelineDetailMaps(api(() => page([], "next")), TOKEN, BABY, [reference()]),
    code("UPSTREAM_CURSOR_LOOP", 502));
});

test("malformed records and unsafe numeric versions are rejected", async () => {
  for (const item of [null, [], { ...record(), id: "" }, { ...record(), version: Number(VERSION) }]) {
    await assert.rejects(fetchTimelineDetailMaps(api(() => page([item])), TOKEN, BABY, [reference()]),
      code("UPSTREAM_INVALID_RECORD", 502));
  }
});

test("the scan limit returns an explicit error instead of partial editing data", async () => {
  let calls = 0;
  await assert.rejects(fetchTimelineDetailMaps(api(() => {
    calls += 1;
    return page(Array.from({ length: 100 }, (_, i) => record(`test_unrequested_${calls}_${i}`)), `cursor-${calls}`);
  }), TOKEN, BABY, [reference()]), code("HISTORY_SCAN_LIMIT", 503));
  assert.equal(calls, 200);
});

test("each requested domain is isolated, with at most five simultaneous upstream calls", async () => {
  let active = 0;
  let maximum = 0;
  const kinds = ["feeding", "sleep", "diaper", "food", "supplement"] as const;
  const fetchApi = api(async path => {
    active += 1;
    maximum = Math.max(maximum, active);
    const kind = new URL(path, "http://localhost").pathname.split("/").at(-1);
    await new Promise<void>(resolve => setTimeout(resolve, 1));
    active -= 1;
    return page([record(`test_${kind}`)]);
  });
  const result = await fetchTimelineDetailMaps(fetchApi, TOKEN, BABY, kinds.map(kind => reference(`test_${kind}`, kind)));
  assert.ok(maximum <= 5);
  for (const map of Object.values(result)) assert.equal(map.size, 1);
  assert.equal(result.feedings.get("test_feeding")?.type, "bottle_breast");
  assert.equal(result.sleeps.get("test_sleep")?.type, undefined);
});
