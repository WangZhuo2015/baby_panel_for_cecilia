import assert from "node:assert/strict";
import test from "node:test";
import {
  getWhoStandard,
  estimatePercentile,
} from "../../lib/who-growth-standards";

test("Growth: WHO Standards Data Structure", () => {
  const girls = getWhoStandard("female");
  assert.equal(girls.months.length, 37); // 0-36 months
  assert.equal(girls.weight.P50.length, 37);
  assert.equal(girls.height.P50.length, 37);
  assert.equal(girls.headCircumference.P50.length, 37);

  const boys = getWhoStandard("male");
  assert.equal(boys.months.length, 37);
  assert.ok(boys.weight.P50[0] > girls.weight.P50[0]); // Boys median at birth slightly higher
});

test("Growth: Percentile estimation calculations", () => {
  // 6 months girl, median weight is ~7.3 kg
  const pMedian = estimatePercentile("female", "weight", 6, 7.3);
  assert.ok(pMedian >= 45 && pMedian <= 55, `Expected median ~50, got ${pMedian}`);

  // High weight (e.g. 9.8 kg is P97)
  const pHigh = estimatePercentile("female", "weight", 6, 9.8);
  assert.equal(pHigh, 97);

  // Low weight (e.g. 5.7 kg is P3)
  const pLow = estimatePercentile("female", "weight", 6, 5.7);
  assert.equal(pLow, 3);

  // Height at 12 months girl, median is ~74.0 cm
  const pHeight = estimatePercentile("female", "height", 12, 74.0);
  assert.ok(pHeight >= 45 && pHeight <= 55, `Expected height median ~50, got ${pHeight}`);
});
