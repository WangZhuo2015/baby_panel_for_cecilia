import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchNativeTimelineDetailMaps } from "../../lib/growdesk/native-timeline-details";
import type { TimelineDetailReference } from "../../lib/growdesk/timeline-details";

const baby = "test_baby_timeline";
const family = "test_family_timeline";
const token = "test_access_timeline";
const kinds = ["feeding", "sleep", "diaper", "food", "supplement"] as const;
function reference(kind: TimelineDetailReference["entityType"] = "feeding", id = "test_record"): TimelineDetailReference {
  return { babyId: baby, entityType: kind, entityId: id, version: "7" };
}
function record(id: string): Record<string, unknown> {
  return { id, babyId: baby, familyId: family, version: "7", feedingType: "bottle", amountMl: "0.00", spitUp: false, notes: null };
}
function api(implementation: (path: string) => Promise<BridgeResult<unknown>>): BridgeFetch {
  return async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => {
    assert.equal(options?.accessToken, token);
    assert.equal(options?.method, undefined, "detail loading must be read-only");
    return await implementation(path) as BridgeResult<T>;
  };
}
function rejectCode(code: string, status?: number) {
  return (error: unknown): boolean => error instanceof BridgeError && error.code === code && (status === undefined || error.status === status);
}

test("native timeline reads only distinct referenced IDs and preserves edit values", async () => {
  const calls: string[] = [];
  const rows = kinds.map(kind => reference(kind, `test_${kind}`));
  const fetcher = api(async path => {
    calls.push(path);
    assert.equal(path.includes("?"), false, "no cursor/history scan");
    return { ok: true, status: 200, data: record(path.split("/").at(-1)!) };
  });
  const result = await fetchNativeTimelineDetailMaps(fetcher, token, baby, family, [...rows, rows[0]!]);
  assert.equal(calls.length, 5);
  assert.deepEqual(new Set(calls), new Set(kinds.map(kind => `/api/v1/babies/${baby}/records/${kind}/test_${kind}`)));
  const feeding = result.feedings.get("test_feeding")!;
  assert.equal(feeding.type, "bottle_breast");
  assert.equal(feeding.feedingType, "bottle");
  assert.equal(feeding.amountMl, "0.00");
  assert.equal(feeding.spitUp, false);
  assert.equal(feeding.notes, null);
  assert.equal(feeding.version, "7");
  assert.equal(result.supplements.size, 1);
});

test("native detail pool bounds combined cross-kind concurrency to five", async () => {
  let active = 0, peak = 0, calls = 0;
  const fetcher = api(async path => {
    active += 1; peak = Math.max(peak, active); calls += 1;
    await setImmediate();
    active -= 1;
    return { ok: true, status: 200, data: record(path.split("/").at(-1)!) };
  });
  const entries = Array.from({ length: 31 }, (_, i) => reference(kinds[i % kinds.length]!, `test_record_${i}`));
  await fetchNativeTimelineDetailMaps(fetcher, token, baby, family, entries);
  assert.equal(calls, entries.length);
  assert.equal(peak, 5);
  assert.equal(active, 0);
});

test("all native timeline references are checked before any upstream read", async () => {
  let calls = 0;
  const fetcher = api(async () => { calls += 1; return { ok: true, status: 200, data: {} }; });
  const invalid: TimelineDetailReference[] = [
    { ...reference(), babyId: "test_other_baby" },
    { ...reference(), entityId: "../test_other" },
    { ...reference(), version: "0" },
    { ...reference(), entityType: "unknown" as TimelineDetailReference["entityType"] },
  ];
  for (const bad of invalid) {
    await assert.rejects(fetchNativeTimelineDetailMaps(fetcher, token, baby, family, [reference(), bad]), rejectCode("UPSTREAM_INVALID_RECORD"));
  }
  await assert.rejects(fetchNativeTimelineDetailMaps(fetcher, token, baby, family, [reference(), { ...reference(), version: "8" }]), rejectCode("UPSTREAM_INVALID_RECORD"));
  assert.equal(calls, 0);
});

test("native timeline rejects mismatched IDs, baby or family and malformed details", async () => {
  for (const data of [
    null, [], "invalid", {},
    { ...record("test_record"), id: "test_other_record" },
    { ...record("test_record"), babyId: "test_other_baby" },
    { ...record("test_record"), familyId: "test_other_family" },
    { ...record("test_record"), version: "-1" },
  ]) {
    await assert.rejects(fetchNativeTimelineDetailMaps(api(async () => ({ ok: true, status: 200, data })), token, baby, family, [reference()]), rejectCode("UPSTREAM_INVALID_RECORD", 502));
  }
});

test("native timeline treats deletion and version drift as refreshable conflicts", async () => {
  await assert.rejects(fetchNativeTimelineDetailMaps(api(async () => ({ ok: false, status: 404 })), token, baby, family, [reference()]), rejectCode("TIMELINE_DETAILS_MISSING", 409));
  await assert.rejects(fetchNativeTimelineDetailMaps(api(async () => ({ ok: true, status: 200, data: { ...record("test_record"), version: "8" } })), token, baby, family, [reference()]), rejectCode("TIMELINE_CHANGED", 409));
});

test("native timeline preserves authentication, authorization, rate and service failures", async () => {
  for (const status of [401, 403, 429, 500, 503, 504]) {
    await assert.rejects(fetchNativeTimelineDetailMaps(api(async () => ({ ok: false, status, error: { code: "TEST_UPSTREAM", message: "test" } })), token, baby, family, [reference()]), rejectCode("TEST_UPSTREAM", status));
  }
});

test("a failed native detail read stops new work and joins already-started reads", async () => {
  let calls = 0, active = 0;
  const fetcher = api(async path => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 403, error: { code: "TEST_REVOKED", message: "test" } };
    active += 1;
    await setImmediate();
    active -= 1;
    return { ok: true, status: 200, data: record(path.split("/").at(-1)!) };
  });
  const entries = Array.from({ length: 30 }, (_, i) => reference("feeding", `test_${i}`));
  await assert.rejects(fetchNativeTimelineDetailMaps(fetcher, token, baby, family, entries), rejectCode("TEST_REVOKED", 403));
  assert.equal(calls, 5);
  assert.equal(active, 0);
});

test("empty and non-care timelines do not fetch care details", async () => {
  const fetcher = api(async () => { throw new Error("unexpected upstream read"); });
  const result = await fetchNativeTimelineDetailMaps(fetcher, token, baby, family, [reference("medical"), reference("vaccine"), reference("growth")]);
  assert.equal(Object.values(result).every(map => map.size === 0), true);
  await fetchNativeTimelineDetailMaps(fetcher, token, baby, family, []);
});
