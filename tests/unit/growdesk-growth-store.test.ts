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

test("growth edit sends the original baby and baseVersion and replaces the record", async (t) => {
  const state: any = {
    user: { id: "test_user" },
    family: { id: "test_family" },
    baby: { id: "test_baby", familyId: "test_family" },
    selectedBabyId: "test_baby",
  };
  Object.assign(state, createGrowthSlice((update: any) => Object.assign(state, typeof update === "function" ? update(state) : update), () => state));
  state.growthMeasurements = [{
    id: "test_growth",
    babyId: "test_baby",
    date: "2026-09-18",
    ageInMonths: 7,
    ageLabel: "7月",
    weightKg: 7.42,
    version: "7",
    imageUrl: "/api/attachments/test_attachment",
  }];
  // Simulate a background refresh after the editor captured version 7. The
  // explicit snapshot passed below must still win over the refreshed version.
  state.growthMeasurements = [{ ...state.growthMeasurements[0], version: "9" }];
  let body: any;
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return Response.json({
      ...state.growthMeasurements[0],
      ...body,
      version: "8",
      baseVersion: "8",
      imageUrl: null,
    });
  });

  await state.updateGrowthMeasurement("test_growth", {
    date: "2026-09-19",
    weightKg: 7.5,
    imageUrl: null,
    babyId: "test_baby",
    baseVersion: "7",
  });

  assert.deepEqual(body, {
    date: "2026-09-19",
    weightKg: 7.5,
    imageUrl: null,
    id: "test_growth",
    babyId: "test_baby",
    baseVersion: "7",
  });
  assert.equal(state.growthMeasurements[0].date, "2026-09-19");
  assert.equal(state.growthMeasurements[0].version, "8");
  assert.equal(state.growthMeasurements[0].imageUrl, null);
});

test("growth edit ignores a late response after the selected baby changes", async (t) => {
  const state: any = {
    user: { id: "test_user" },
    family: { id: "test_family_a" },
    baby: { id: "test_baby_a", familyId: "test_family_a" },
    selectedBabyId: "test_baby_a",
  };
  Object.assign(state, createGrowthSlice((update: any) => Object.assign(state, typeof update === "function" ? update(state) : update), () => state));
  state.growthMeasurements = [{
    id: "test_growth_a",
    babyId: "test_baby_a",
    date: "2026-09-18",
    ageInMonths: 7,
    ageLabel: "7月",
    weightKg: 7.42,
    version: "7",
  }];
  let release!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { release = resolve; }));

  const pending = state.updateGrowthMeasurement("test_growth_a", { weightKg: 7.5, babyId: "test_baby_a", baseVersion: "7" });
  state.family = { id: "test_family_b" };
  state.baby = { id: "test_baby_b", familyId: "test_family_b" };
  state.selectedBabyId = "test_baby_b";
  state.growthMeasurements = [{ id: "test_growth_b", babyId: "test_baby_b", date: "2026-09-19", ageInMonths: 2, ageLabel: "2月", weightKg: 5 }];

  release(Response.json({ id: "test_growth_a", babyId: "test_baby_a", date: "2026-09-18", ageInMonths: 7, ageLabel: "7月", weightKg: 7.5, version: "8" }));
  await pending;

  assert.deepEqual(state.growthMeasurements, [{ id: "test_growth_b", babyId: "test_baby_b", date: "2026-09-19", ageInMonths: 2, ageLabel: "2月", weightKg: 5 }]);
});

test("growth edit propagates a version conflict without changing local state", async (t) => {
  const state: any = {
    user: { id: "test_user" },
    family: { id: "test_family" },
    baby: { id: "test_baby", familyId: "test_family" },
    selectedBabyId: "test_baby",
  };
  Object.assign(state, createGrowthSlice((update: any) => Object.assign(state, typeof update === "function" ? update(state) : update), () => state));
  state.growthMeasurements = [{ id: "test_growth", babyId: "test_baby", date: "2026-09-18", ageInMonths: 7, ageLabel: "7月", weightKg: 7.42, version: "7" }];
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "记录已被更新，请刷新后重试" }), { status: 409, headers: { "content-type": "application/json" } }));

  await assert.rejects(
    state.updateGrowthMeasurement("test_growth", { weightKg: 7.5, babyId: "test_baby", baseVersion: "7" }),
    /记录已被更新，请刷新后重试/
  );
  assert.equal(state.growthMeasurements[0].weightKg, 7.42);

  await assert.rejects(
    state.updateGrowthMeasurement("test_growth", { weightKg: 7.5, babyId: "test_baby_other", baseVersion: "7" }),
    /生长记录不属于当前宝宝/
  );
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
