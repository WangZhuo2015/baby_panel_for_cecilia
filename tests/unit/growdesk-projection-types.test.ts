import assert from "node:assert/strict";
import test from "node:test";
import {
  projectLegacyFeedingRecord, projectLegacySleepRecord, projectLegacyGrowthRecord,
  projectLegacyMedicalRecord, projectLegacyTimelineItem, projectLegacyGrowthChart,
  wantsExtendedRepresentation,
} from "../../lib/growdesk/legacy-projections";

test("legacy projections omit metadata without mutating the extended record", () => {
  const source = Object.freeze({ id: "test_record", version: "9007199254740993", baseVersion: "9007199254740993", updatedAt: "test_stamp", notes: null });
  const legacy = projectLegacyFeedingRecord(source);
  assert.deepEqual(legacy, { id: "test_record", notes: null });
  assert.equal(source.version, "9007199254740993");
  // @ts-expect-error A legacy projection does not expose concurrency metadata.
  assert.equal(legacy.version, undefined);
  // @ts-expect-error A legacy projection does not expose updatedAt.
  assert.equal(legacy.updatedAt, undefined);
  const medical = projectLegacyMedicalRecord(source);
  assert.equal(medical.updatedAt, "test_stamp");
  // @ts-expect-error Medical legacy output omits CAS metadata too.
  assert.equal(medical.baseVersion, undefined);
});

test("timeline removes nested version fields on copies", () => {
  const raw = Object.freeze({ id: "test_sleep", version: "4", baseVersion: "4", sleepType: "nap", startedAt: "test_start", endedAt: null, notes: null });
  const input = Object.freeze({ id: "test_timeline", type: "sleep", babyId: "test_baby", version: "4", sortMs: 1, rawRecord: raw });
  const projected = projectLegacyTimelineItem(input);
  assert.deepEqual(projected.rawRecord, { id: "test_sleep", notes: null });
  assert.equal(raw.version, "4");
  // @ts-expect-error Top-level canonical version is omitted in the legacy view.
  assert.equal(projected.version, undefined);
  assert.equal(projectLegacySleepRecord(raw).id, "test_sleep");
});

test("growth/chart keep measurements and omit canonical aliases", () => {
  const measurement = { id: "test_growth", weightKg: 7.2, weight: "7.2", version: "2", notes: null };
  assert.deepEqual(projectLegacyGrowthRecord(measurement), { id: "test_growth", weightKg: 7.2 });
  const chart = projectLegacyGrowthChart({ measurements: [measurement], rawWhoPercentiles: [], weight: [1] });
  assert.deepEqual(chart.measurements, [{ id: "test_growth", weightKg: 7.2 }]);
  // @ts-expect-error Raw WHO data is not part of the legacy chart contract.
  assert.equal(chart.rawWhoPercentiles, undefined);
});

test("extended representation requires explicit opt-in", () => {
  assert.equal(wantsExtendedRepresentation(new Request("https://test.invalid")), false);
  assert.equal(wantsExtendedRepresentation(new Request("https://test.invalid", { headers: { "x-growdesk-representation": " Extended " } })), true);
});
