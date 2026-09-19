import test from "node:test";
import assert from "node:assert/strict";
import { createGrowthSlice } from "../../stores/slices/growth";
import { invalidateCache } from "../../stores/slices/helpers";

test("T2 a late measurement response must not replace the selected baby's chart points", async t => {
  invalidateCache();
  t.after(() => invalidateCache());
  let finishOld!: (value: Response) => void;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input, "https://test.invalid");
    if (url.searchParams.get("babyId") === "test_baby_old") {
      return new Promise<Response>(resolve => { finishOld = resolve; });
    }
    assert.equal(url.searchParams.get("babyId"), "test_baby_selected");
    return Response.json([{ id: "test_selected_measurement", babyId: "test_baby_selected", ageInMonths: 6, weightKg: 7 }]);
  });
  let state: any = { user: { id: "test_user" }, authLoading: false,
    baby: { id: "test_baby_old" }, selectedBabyId: "test_baby_old" };
  const set = (patch: any) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; };
  Object.assign(state, createGrowthSlice(set, () => state));
  const oldRead = state.fetchGrowthMeasurements();
  // Match selectBaby's synchronous scoped-data reset and identity change.
  set({ baby: { id: "test_baby_selected" }, selectedBabyId: "test_baby_selected", growthMeasurements: [] });
  await state.fetchGrowthMeasurements();
  assert.equal(state.growthMeasurements[0].babyId, "test_baby_selected");
  finishOld(Response.json([{ id: "test_old_measurement", babyId: "test_baby_old", ageInMonths: 1, weightKg: 4 }]));
  await oldRead;
  assert.equal(state.growthMeasurements[0].babyId, "test_baby_selected",
    "the chart consumes growthMeasurements, so a stale previous-baby response must be discarded");
});
