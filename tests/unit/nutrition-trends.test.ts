import assert from "node:assert/strict";
import test from "node:test";
import { calculateMultiDayNutritionTrend } from "../../lib/nutrition/engine";
import { nutritionTrendValue, summarizeTrend } from "../../lib/nutrition/trends";
import type { FeedingRecord } from "../../types";

test("full nutrition trend preserves all nutrient projections, empty days, and an explicit zero", () => {
  const feeding: FeedingRecord = { id: "test_feeding", timestamp: "2026-10-05T12:00:00+08:00", type: "bottle_breast", amountMl: 100, leftMinutes: null, rightMinutes: null, spitUp: false, notes: null };
  const summary = calculateMultiDayNutritionTrend({
    babyAgeMonths: 8, dailyDataList: [
      { date: "2026-10-04", feedings: [], supplements: [] },
      { date: "2026-10-05", feedings: [feeding], supplements: [] },
      { date: "2026-10-06", feedings: [{ ...feeding, amountMl: 0 }], supplements: [] },
    ], formulaProductsMap: {}, supplementProductsMap: {},
  });
  assert.ok(Object.keys(summary.dailyTrends[1].nutrients ?? {}).length > 20);
  assert.equal(nutritionTrendValue(summary.dailyTrends[0], "energy_kcal"), null);
  assert.equal(nutritionTrendValue(summary.dailyTrends[1], "energy_kcal"), 67);
  assert.equal(nutritionTrendValue(summary.dailyTrends[1], "vitamin_d"), 10);
  assert.equal(nutritionTrendValue(summary.dailyTrends[2], "milk"), 0);
  assert.equal(nutritionTrendValue(summary.dailyTrends[1], "nonexistent"), null);
  assert.deepEqual(summarizeTrend(summary.dailyTrends.map(day => nutritionTrendValue(day, "energy_kcal"))), { recordedDays: 2, average: 33.5, latest: 0 });
});

test("older responses keep supported core values and never manufacture absent metrics", () => {
  const day = { date: "2026-10-06", totalFeedingMl: 0, formulaMl: 0, breastMl: 0, vitaminD: 400, calcium: 250, iron: 10 };
  assert.equal(nutritionTrendValue(day, "vitamin_d"), 400);
  assert.equal(nutritionTrendValue(day, "zinc"), null);
  assert.equal(nutritionTrendValue(day, "milk"), 0);
});
