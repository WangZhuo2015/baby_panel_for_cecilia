import test from "node:test";
import assert from "node:assert/strict";
import { type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchLegacyRecordList } from "../../lib/growdesk/record-list";
import { fromGrowDeskTimelineResponse } from "../../lib/growdesk/timeline-compat";

const babyId = "test_baby_timeline_overnight";
const familyId = "test_family_timeline_overnight";
const date = "2026-09-19";
const dayStart = "2026-09-18T16:00:00.000Z"; // 2026-09-19 00:00 in Asia/Shanghai.
const sleepId = "test_sleep_overnight";
const sleep = {
  id: sleepId,
  babyId,
  startedAt: "2026-09-18T14:00:00.000Z",
  endedAt: "2026-09-18T22:00:00.000Z",
  type: "night",
  nightWakingCount: 2,
  notes: "test_sleep",
  version: "4",
};
const timelineRows = [
  {
    id: "test_timeline_old",
    babyId,
    entityType: "feeding" as const,
    entityId: "test_feeding_old",
    occurredAt: "2026-09-18T15:59:59.999Z",
    summary: "feeding: formula 1ml",
    version: "1",
  },
  {
    id: "test_timeline_overnight",
    babyId,
    entityType: "sleep" as const,
    entityId: sleepId,
    occurredAt: sleep.startedAt,
    summary: "sleep: night",
    version: sleep.version,
  },
  {
    id: "test_timeline_today",
    babyId,
    entityType: "diaper" as const,
    entityId: "test_diaper_today",
    occurredAt: "2026-09-18T17:00:00.000Z",
    summary: "diaper: pee",
    version: "2",
  },
  {
    id: "test_timeline_growth",
    babyId,
    entityType: "growth" as const,
    entityId: "test_growth_today",
    occurredAt: "2026-09-18T18:00:00.000Z",
    summary: "生长测量",
    version: "3",
  },
  {
    id: "test_timeline_medical",
    babyId,
    entityType: "medical" as const,
    entityId: "test_medical_today",
    occurredAt: "2026-09-18T19:00:00.000Z",
    summary: "医疗记录",
    version: "4",
  },
  {
    id: "test_timeline_vaccine",
    babyId,
    entityType: "vaccine" as const,
    entityId: "test_vaccine_today",
    occurredAt: "2026-09-18T20:00:00.000Z",
    summary: "疫苗接种",
    version: "5",
  },
];

const page = <T>(data: T[], nextCursor: string | null = null): BridgeResult<T[]> => ({
  ok: true,
  status: 200,
  data,
  page: { nextCursor },
});

test("timeline date filtering retains an overlapping sleep projection from the prior day", async () => {
  const calls: string[] = [];
  const fetchApi: BridgeFetch = (async <T>(path: string) => {
    calls.push(path);
    if (path === `/api/v1/babies/${babyId}`) {
      return { ok: true, status: 200, data: { id: babyId, familyId } } as BridgeResult<T>;
    }
    if (path === `/api/v1/families/${familyId}`) {
      return { ok: true, status: 200, data: { id: familyId, timeZone: "Asia/Shanghai" } } as BridgeResult<T>;
    }
    if (path.includes(`/babies/${babyId}/records/sleep`)) return page([sleep]) as BridgeResult<T>;
    if (path.includes(`/babies/${babyId}/timeline`)) return page(timelineRows) as BridgeResult<T>;
    throw new Error(`Unexpected test upstream path: ${path}`);
  }) as BridgeFetch;

  const result = await fetchLegacyRecordList<typeof timelineRows[number]>(
    fetchApi,
    "test_token",
    babyId,
    new URLSearchParams({ date }),
    "timeline",
  );

  assert.deepEqual(result.map(item => item.id), [
    "test_timeline_overnight",
    "test_timeline_today",
    "test_timeline_growth",
    "test_timeline_medical",
    "test_timeline_vaccine",
  ]);
  assert.ok(calls.some(path => path.includes(`/babies/${babyId}/records/sleep`)), "timeline filtering must inspect sleep intervals");
});

test("timeline compatibility clamps an overnight sleep to midnight without changing its interval detail", () => {
  const [item] = fromGrowDeskTimelineResponse([
    {
      id: "test_timeline_overnight",
      babyId,
      entityType: "sleep",
      entityId: sleepId,
      occurredAt: sleep.startedAt,
      summary: "sleep: night",
      version: sleep.version,
    },
  ], {
    sleeps: new Map([[sleepId, sleep]]),
    dayStartMs: Date.parse(dayStart),
  });

  assert.equal(item?.time, "00:00");
  assert.equal(item?.sortMs, Date.parse(dayStart));
  assert.equal(item?.title, "跨夜睡眠 (接昨日)");
  assert.equal(item?.detail, "8小时（22:00–06:00） · 夜醒 2次 · test_sleep");
  assert.equal(item?.rawRecord?.startTime, sleep.startedAt);
  assert.equal(item?.rawRecord?.endTime, sleep.endedAt);
});

test("unfiltered timeline history keeps sleep projections instead of applying a date-only sleep set", async () => {
  const calls: string[] = [];
  const fetchApi: BridgeFetch = (async <T>(path: string) => {
    calls.push(path);
    if (path === `/api/v1/babies/${babyId}`) {
      return { ok: true, status: 200, data: { id: babyId, familyId } } as BridgeResult<T>;
    }
    if (path === `/api/v1/families/${familyId}`) {
      return { ok: true, status: 200, data: { id: familyId, timeZone: "Asia/Shanghai" } } as BridgeResult<T>;
    }
    if (path.includes(`/babies/${babyId}/timeline`)) return page([timelineRows[1]!]) as BridgeResult<T>;
    throw new Error(`Unexpected test upstream path: ${path}`);
  }) as BridgeFetch;

  const result = await fetchLegacyRecordList<typeof timelineRows[number]>(
    fetchApi,
    "test_token",
    babyId,
    new URLSearchParams(),
    "timeline",
  );

  assert.deepEqual(result.map(item => item.id), ["test_timeline_overnight"]);
  assert.equal(calls.some(path => path.includes("/records/sleep")), false);
});

test("timeline preserves legacy category ordering at equal times and bottle amount wording", () => {
  const occurredAt = "2026-09-19T01:00:00.000Z";
  const entries = (["supplement", "diaper", "feeding"] as const).map(entityType => ({
    id: `test_timeline_${entityType}`, entityId: `test_${entityType}`, babyId,
    entityType, occurredAt, summary: `${entityType}: bottle`, version: "1",
  }));
  const result = fromGrowDeskTimelineResponse(entries, {
    feedings: new Map([["test_feeding", { id: "test_feeding", type: "bottle", amountMl: "30", occurredAt, notes: "test_note" }]]),
  });
  assert.deepEqual(result.map(item => item.type), ["feeding", "diaper", "supplement"]);
  assert.equal(result[0]?.detail, "30ml · test_note");
});
