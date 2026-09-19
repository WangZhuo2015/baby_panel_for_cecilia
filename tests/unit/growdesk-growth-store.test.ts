import test from "node:test";
import assert from "node:assert/strict";
import { createGrowthSlice } from "../../stores/slices/growth";

test("growth create and delete carry the selected baby and the version originally read", async (t) => {
  const state: any = { user: { id: "test_user" }, baby: { id: "test_baby" }, family: { id: "test_family" } };
  Object.assign(state, createGrowthSlice((update: any) => Object.assign(state, typeof update === "function" ? update(state) : update), () => state));
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(init?.method === "POST" ? { id: "test_growth", date: "2026-09-18", babyId: "test_baby", version: "7" } : { success: true });
  });
  await state.addGrowthMeasurement({ date: "2026-09-18", weightKg: 7.42 });
  assert.equal(JSON.parse(String(calls[0].init?.body)).babyId, "test_baby");
  await state.deleteGrowthMeasurement("test_growth");
  const query = new URL(calls[1].url, "https://test.invalid").searchParams;
  assert.equal(query.get("babyId"), "test_baby");
  assert.equal(query.get("baseVersion"), "7");
  assert.equal(state.growthMeasurements.length, 0);
});

for (const [method, field] of [["fetchMedicalReports", "medicalReports"], ["fetchFoodPlans", "foodPlans"]]) {
  test(`${method} ignores the previous baby's late response`, async (t) => {
    const state: any = { user: { id: "test_user" }, baby: { id: "test_baby_a" }, authLoading: false };
    Object.assign(state, createGrowthSlice((update: any) => Object.assign(state, typeof update === "function" ? update(state) : update), () => state));
    let release!: (value: Response) => void;
    t.mock.method(globalThis, "fetch", () => new Promise<Response>(resolve => { release = resolve; }));
    const pending = state[method](undefined, true);
    state.baby = { id: "test_baby_b" };
    state[field] = [{ id: "test_b_record" }];
    release(Response.json([{ id: "test_a_record" }]));
    await pending;
    assert.deepEqual(state[field], [{ id: "test_b_record" }]);
  });
}
