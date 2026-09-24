import assert from "node:assert/strict";
import test from "node:test";
import {
  projectLegacyDiaperRecord,
  projectLegacyFeedingRecord,
  projectLegacyGrowthChart,
  projectLegacyGrowthRecord,
  projectLegacyMedicalRecord,
  projectLegacySleepRecord,
  projectLegacySupplementRecord,
  projectLegacyTimelineItem,
  wantsExtendedRepresentation,
} from "../../lib/growdesk/legacy-projections";

test("legacy projection is opt-in for the extended representation header", () => {
  assert.equal(wantsExtendedRepresentation(new Request("https://test.invalid")), false);
  assert.equal(wantsExtendedRepresentation(new Request("https://test.invalid", {
    headers: { "x-growdesk-representation": " extended " },
  })), true);
  assert.equal(wantsExtendedRepresentation(new Request("https://test.invalid", {
    headers: { "x-growdesk-representation": "legacy" },
  })), false);
});

test("record projections remove only fields absent from the old Web DTOs", () => {
  const feeding = {
    id: "test_feeding",
    timestamp: "2026-09-19T08:00:00.000Z",
    formulaProduct: { id: "test_formula", name: "test formula" },
    version: "7",
    baseVersion: "7",
    updatedAt: "2026-09-19T08:01:00.000Z",
  };
  assert.deepEqual(projectLegacyFeedingRecord(feeding), {
    id: feeding.id,
    timestamp: feeding.timestamp,
    formulaProduct: feeding.formulaProduct,
  });
  assert.equal(feeding.version, "7", "projection must not mutate the extended response");

  assert.deepEqual(projectLegacySleepRecord({
    id: "test_sleep",
    startTime: "2026-09-19T08:00:00.000Z",
    endTime: "2026-09-19T08:30:00.000Z",
    type: "nap",
    sleepType: "nap",
    startedAt: "2026-09-19T08:00:00.000Z",
    endedAt: "2026-09-19T08:30:00.000Z",
    version: "3",
    baseVersion: "3",
    updatedAt: "2026-09-19T08:31:00.000Z",
  }), {
    id: "test_sleep",
    startTime: "2026-09-19T08:00:00.000Z",
    endTime: "2026-09-19T08:30:00.000Z",
    type: "nap",
  });

  assert.deepEqual(projectLegacyDiaperRecord({
    id: "test_diaper",
    timestamp: "2026-09-19T09:00:00.000Z",
    type: "wet",
    version: "2",
    baseVersion: "2",
    updatedAt: "2026-09-19T09:01:00.000Z",
  }), {
    id: "test_diaper",
    timestamp: "2026-09-19T09:00:00.000Z",
    type: "wet",
  });

  assert.deepEqual(projectLegacyGrowthRecord({
    id: "test_growth",
    date: "2026-09-19",
    weightKg: 6.8,
    heightCm: 64,
    headCircumferenceCm: 41,
    weight: 6.8,
    height: 64,
    headCircumference: 41,
    notes: "test note",
    version: "4",
    baseVersion: "4",
    updatedAt: "2026-09-19T09:02:00.000Z",
  }), {
    id: "test_growth",
    date: "2026-09-19",
    weightKg: 6.8,
    heightCm: 64,
    headCircumferenceCm: 41,
  });

  assert.deepEqual(projectLegacyMedicalRecord({
    id: "test_medical",
    category: "growth",
    updatedAt: "2026-09-19T09:03:00.000Z",
    version: "5",
    baseVersion: "5",
  }), {
    id: "test_medical",
    category: "growth",
    updatedAt: "2026-09-19T09:03:00.000Z",
  });

  assert.deepEqual(projectLegacySupplementRecord({
    id: "test_supplement_record",
    product: {
      id: "test_supplement",
      name: "test supplement",
      createdAt: "2026-09-19T09:00:00.000Z",
      updatedAt: "2026-09-19T09:01:00.000Z",
    },
  }), {
    id: "test_supplement_record",
    product: { id: "test_supplement", name: "test supplement" },
  });
});

test("growth chart and timeline projections preserve old aliases and raw edit fields", () => {
  const chart = projectLegacyGrowthChart({
    measurements: [{
      id: "test_chart_growth",
      weightKg: 6.8,
      weight: 6.8,
      heightCm: 64,
      height: 64,
      version: "6",
      baseVersion: "6",
      updatedAt: "2026-09-19T09:00:00.000Z",
    }],
    whoPercentiles: { weight: [] },
    rawWhoPercentiles: { weight: [] },
    monthLabels: ["0"],
    gender: "female",
  });
  assert.deepEqual(chart, {
    measurements: [{ id: "test_chart_growth", weightKg: 6.8, heightCm: 64 }],
    whoPercentiles: { weight: [] },
    monthLabels: ["0"],
    gender: "female",
  });

  const timeline = projectLegacyTimelineItem({
    id: "test_timeline_supplement",
    babyId: "test_baby",
    type: "supplement",
    title: "补剂打卡",
    detail: "canonical detail",
    version: "8",
    baseVersion: "8",
    sortMs: 1,
    formulaProductId: null,
    formulaProductName: null,
    rawRecord: {
      id: "test_supplement_record",
      productId: "test_supplement",
      productName: "test supplement",
      dose: null,
      unitName: "1.5 滴",
      notes: "test note",
      version: "8",
      baseVersion: "8",
    },
  });
  assert.deepEqual(timeline, {
    id: "test_timeline_supplement",
    type: "supplement",
    title: "补剂打卡",
    detail: "test supplement 1.5滴 · test note",
    rawRecord: {
      id: "test_supplement_record",
      productId: "test_supplement",
      productName: "test supplement",
      dose: null,
      unitName: "1.5 滴",
      notes: "test note",
    },
  });
});
