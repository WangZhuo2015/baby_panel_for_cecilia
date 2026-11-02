import test from "node:test";
import assert from "node:assert/strict";
import { toGrowDeskFoodCreatePayload, toGrowDeskFoodUpdatePayload, fromGrowDeskFoodRecord, type GrowDeskFoodRecord } from "../../lib/growdesk/food-compat";
import { foodLogLimitMessage, clampFoodGrams } from "../../lib/food-log-limits";

const form = { date: "2026-09-17", time: "20:00", foods: ["test_rice"], portion: "most", acceptance: 3, babyState: "happy", hasAbnormal: true, abnormalNotes: "test_rash" };
const record = (payload: Record<string, unknown>): GrowDeskFoodRecord => ({ id: "test_food", babyId: "test_baby", familyId: "test_family", recordDate: form.date, mealType: "snack", occurredAt: null, foodItemIds: [], portionDescription: null, reaction: null, notes: null, version: "1", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", ...payload } as GrowDeskFoodRecord);

test("F1 exact FoodLogForm onSubmit shape derives a deterministic meal type", () => {
  for (const [time, expected] of [["00:00", "breakfast"], ["10:59", "breakfast"], ["11:00", "lunch"], ["14:59", "lunch"], ["15:00", "dinner"], ["19:59", "dinner"], ["20:00", "snack"]]) {
    assert.equal(toGrowDeskFoodCreatePayload({ ...form, time }).mealType, expected);
  }
  assert.equal(toGrowDeskFoodCreatePayload({ ...form, mealType: "lunch" }).mealType, "lunch");
  assert.equal(toGrowDeskFoodCreatePayload({ date: form.date }).mealType, "snack");
});

test("F2 legacy food observations round-trip create and update without overwriting human notes", () => {
  for (const payload of [toGrowDeskFoodCreatePayload({ ...form, mealType: "snack", notes: "test_note" }), toGrowDeskFoodUpdatePayload({ ...form, version: "1", notes: "test_note" })]) {
    const restored = fromGrowDeskFoodRecord(record(payload)) as any;
    for (const key of ["acceptance", "babyState", "hasAbnormal", "abnormalNotes"] as const) assert.equal(restored[key], form[key], key);
    assert.equal(restored.notes, "test_note");
  }
});

test("F2 partial edits retain omitted observations and notes from the existing record", () => {
  const existing = record(toGrowDeskFoodCreatePayload({ ...form, mealType: "snack", notes: "test_note" }));
  const payload = toGrowDeskFoodUpdatePayload({ version: "1", acceptance: 0, hasAbnormal: false }, existing);
  const restored = fromGrowDeskFoodRecord(record({ ...existing, ...payload })) as any;
  assert.equal(restored.acceptance, 0);
  assert.equal(restored.hasAbnormal, false);
  assert.equal(restored.babyState, "happy");
  assert.equal(restored.abnormalNotes, "test_rash");
  assert.equal(restored.notes, "test_note");
});

test("multiple food components and their individual weights survive create and partial edits", () => {
  const components = [
    { role: "protein", name: "鳕鱼", foodId: "test_cod", grams: 25 },
    { role: "protein", name: "虾", foodId: "test_shrimp", grams: 15 },
    { role: "vegetable", name: "test_custom_vegetable", grams: 32 },
  ];
  const input = { ...form, foods: components.map(item => item.name), components, totalGrams: 72, notes: "test_note" };
  const created = record(toGrowDeskFoodCreatePayload(input));
  const restored = fromGrowDeskFoodRecord(created);
  assert.deepEqual(restored.foods, input.foods);
  assert.deepEqual(restored.components, components);
  assert.equal(restored.totalGrams, 72);
  const updated = record({ ...created, ...toGrowDeskFoodUpdatePayload({ version: "1", acceptance: 4 }, created) });
  const edited = fromGrowDeskFoodRecord(updated);
  assert.deepEqual(edited.components, components);
  assert.equal(edited.totalGrams, 72);
  assert.equal(edited.notes, "test_note");
  const reduced = components.slice(1);
  const changed = record({ ...updated, ...toGrowDeskFoodUpdatePayload({
    version: "2", foods: reduced.map(item => item.name), components: reduced, totalGrams: 47,
  }, updated) });
  const changedRecord = fromGrowDeskFoodRecord(changed);
  assert.deepEqual(changedRecord.foods, reduced.map(item => item.name));
  assert.deepEqual(changedRecord.components, reduced);
  assert.equal(changedRecord.totalGrams, 47);
});

test("explicit legacy names remain alongside weighted items, with component-only fallback", () => {
  const components = [{ role: "protein", name: "鳕鱼", grams: 25 }];
  const foods = ["鳕鱼", "test_unknown_legacy_food"];
  assert.deepEqual(toGrowDeskFoodCreatePayload({ ...form, foods, components }).foodItemIds, foods);
  assert.deepEqual(toGrowDeskFoodUpdatePayload({ version: "1", foods, components }).foodItemIds, foods);
  assert.deepEqual(toGrowDeskFoodCreatePayload({ date: form.date, components }).foodItemIds, ["鳕鱼"]);
  assert.deepEqual(toGrowDeskFoodUpdatePayload({ version: "1", components }).foodItemIds, ["鳕鱼"]);
});

test("food form checks the exact adapter envelope and item limits before sending", () => {
  const normal = { ...form, components: [{ role: "protein", name: "鳕鱼", grams: 25 }], totalGrams: 25 };
  assert.equal(foodLogLimitMessage(normal), null);
  const oversized = { ...normal, abnormalNotes: "test_".repeat(250) };
  assert.ok(foodLogLimitMessage(oversized));
  assert.throws(() => toGrowDeskFoodCreatePayload(oversized), /1000/);
  const tooMany = { ...normal, foods: Array.from({ length: 21 }, (_, index) => `test_food_${index}`) };
  assert.ok(foodLogLimitMessage(tooMany));
  assert.throws(() => toGrowDeskFoodCreatePayload(tooMany), /20/);
  for (const [input, expected] of [[-1, 0], [350, 300], [25.5, 25.5], [Infinity, 0], [NaN, 0]]) {
    assert.equal(clampFoodGrams(input), expected);
  }
});

test("default food projection matches the old PWA while extended keeps concurrency fields", () => {
  const canonical = record(toGrowDeskFoodCreatePayload({ ...form, mealType: "snack", notes: "test_note" }));
  const legacy = fromGrowDeskFoodRecord(canonical, false) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(legacy).sort(), [
    "abnormalNotes", "acceptance", "babyId", "babyState", "clientId", "createdAt", "date",
    "foods", "hasAbnormal", "id", "portion", "recordedById", "source", "sourceAgent", "time",
  ].sort());
  assert.equal(legacy.clientId, null);
  assert.equal(legacy.recordedById, null);
  assert.equal(legacy.source, "ui_manual");

  const extended = fromGrowDeskFoodRecord(canonical, true) as unknown as Record<string, unknown>;
  assert.equal(extended.version, "1");
  assert.equal(extended.baseVersion, "1");
  assert.deepEqual(extended.foodNames, ["test_rice"]);
});

for (const [time, instant] of [["20:00", "2026-09-17T12:00:00.000Z"], ["00:15", "2026-09-16T16:15:00.000Z"]]) {
  test(`F4 Shanghai ${time} maps to the correct instant and back on create/update`, () => {
    for (const payload of [toGrowDeskFoodCreatePayload({ ...form, time, mealType: "snack" }), toGrowDeskFoodUpdatePayload({ date: form.date, time, version: "1" })]) {
      assert.equal(payload.occurredAt, instant);
      const restored = fromGrowDeskFoodRecord(record(payload));
      assert.equal(restored.date, form.date);
      assert.equal(restored.time, time);
    }
  });
}
