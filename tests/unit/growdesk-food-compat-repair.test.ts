import test from "node:test";
import assert from "node:assert/strict";
import { toGrowDeskFoodCreatePayload, toGrowDeskFoodUpdatePayload, fromGrowDeskFoodRecord, type GrowDeskFoodRecord } from "../../lib/growdesk/food-compat";

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
