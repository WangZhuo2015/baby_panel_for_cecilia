import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchTimelineDetailMaps, type TimelineDetailReference } from "../../lib/growdesk/timeline-details";

const token = "test_access", babyId = "test_baby";
const entry = (id: string, entityType: TimelineDetailReference["entityType"] = "feeding"): TimelineDetailReference =>
  ({ babyId, entityId: id, entityType, version: "9007199254740993" });
const detail = (id: string) => ({ id, babyId, version: "9007199254740993", feedingType: "bottle", amountMl: "120.00" });
function fetcher(fn: (path: string, options: Parameters<BridgeFetch>[1]) => Promise<BridgeResult<unknown>> | BridgeResult<unknown>): BridgeFetch {
  return async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => await fn(path, options) as BridgeResult<T>;
}
test("native historical lookup reads exact IDs once without a paginated history scan", async () => {
  const calls: string[] = [];
  const api = fetcher((path, options) => {
    calls.push(path);
    assert.equal(options?.accessToken, token);
    assert.ok(options?.signal);
    assert.equal(path, `/api/v1/babies/${babyId}/records/feeding/test_old_record`);
    return { ok: true, status: 200, data: detail("test_old_record") };
  });
  const maps = await fetchTimelineDetailMaps(api, token, babyId, [entry("test_old_record"), entry("test_old_record")], { lookup: "by-id" });
  assert.equal(calls.length, 1);
  assert.equal(maps.feedings.get("test_old_record")?.version, "9007199254740993");
  assert.equal(maps.feedings.get("test_old_record")?.amountMl, "120.00");
  assert.equal(maps.feedings.get("test_old_record")?.type, "bottle_breast");
});
test("native details limit concurrent HTTP requests across all five domains", async () => {
  let active = 0, peak = 0, count = 0;
  const kinds = ["feeding", "sleep", "diaper", "food", "supplement"] as const;
  const entries = Array.from({ length: 45 }, (_, i) => entry(`test_${i}`, kinds[i % kinds.length]));
  const api = fetcher(async path => {
    active++; peak = Math.max(peak, active); count++;
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return { ok: true, status: 200, data: detail(path.split("/").at(-1)!) };
  });
  const maps = await fetchTimelineDetailMaps(api, token, babyId, entries, { lookup: "by-id" });
  assert.equal(count, 45); assert.ok(peak <= 5); assert.ok(peak > 1);
  assert.equal(Object.values(maps).reduce((n, m) => n + m.size, 0), 45);
});
test("native errors, deletion, wrong scope and concurrent versions never return partial editable results", async () => {
  for (const [response, code, status] of [
    [{ ok: false, status: 404, error: { code: "RECORD_NOT_FOUND", message: "gone" } }, "TIMELINE_DETAILS_MISSING", 409],
    [{ ok: false, status: 403, error: { code: "BABY_ACCESS_DENIED", message: "denied" } }, "BABY_ACCESS_DENIED", 403],
    [{ ok: false, status: 503, error: { code: "TEST_OUTAGE", message: "down" } }, "TEST_OUTAGE", 503],
    [{ ok: true, status: 200, data: { ...detail("test_a"), version: "2" } }, "TIMELINE_CHANGED", 409],
    [{ ok: true, status: 200, data: { ...detail("test_a"), babyId: "other" } }, "UPSTREAM_INVALID_RECORD", 502],
    [{ ok: true, status: 200, data: detail("other") }, "UPSTREAM_INVALID_RECORD", 502],
    [{ ok: true, status: 200, data: [detail("test_a")] }, "UPSTREAM_INVALID_RECORD", 502],
  ] as const) {
    await assert.rejects(fetchTimelineDetailMaps(fetcher(() => response), token, babyId, [entry("test_a")], { lookup: "by-id" }),
      err => err instanceof BridgeError && err.code === code && err.status === status);
  }
});
test("native failure cancels active siblings and starts no new reads", async () => {
  let count = 0, aborted = 0;
  const api = fetcher(async (_path, options) => {
    count++;
    if (count === 1) {
      await new Promise(resolve => setTimeout(resolve, 2));
      return { ok: false, status: 429, error: { code: "RATE_LIMIT", message: "retry" } };
    }
    await new Promise<void>(resolve => {
      if (options?.signal?.aborted) { aborted++; resolve(); return; }
      options?.signal?.addEventListener("abort", () => { aborted++; resolve(); }, { once: true });
    });
    return { ok: false, status: 499, error: { code: "ABORTED", message: "aborted" } };
  });
  await assert.rejects(fetchTimelineDetailMaps(api, token, babyId, Array.from({ length: 20 }, (_, i) => entry(`test_${i}`)), { lookup: "by-id" }),
    err => err instanceof BridgeError && err.code === "RATE_LIMIT");
  assert.equal(count, 5); assert.equal(aborted, 4);
});
test("native input scope, size and cancellation are checked before any requests", async () => {
  let count = 0;
  const api = fetcher(() => { count++; throw new Error("must not call"); });
  await assert.rejects(fetchTimelineDetailMaps(api, token, babyId, [{ ...entry("test_a"), babyId: "other" }], { lookup: "by-id" }));
  await assert.rejects(fetchTimelineDetailMaps(api, token, babyId, [entry("test_a"), { ...entry("test_a"), version: "2" }], { lookup: "by-id" }));
  await assert.rejects(fetchTimelineDetailMaps(api, token, babyId, Array.from({ length: 2001 }, (_, i) => entry(`test_${i}`)), { lookup: "by-id" }),
    err => err instanceof BridgeError && err.code === "TIMELINE_DETAIL_LIMIT");
  await assert.rejects(fetchTimelineDetailMaps(api, token, babyId, [entry("test_a")], { lookup: "by-id", signal: AbortSignal.abort() }));
  const empty = await fetchTimelineDetailMaps(api, token, babyId, [entry("test_growth", "growth")], { lookup: "by-id" });
  assert.equal(empty.feedings.size, 0);
  assert.equal(count, 0);
});
