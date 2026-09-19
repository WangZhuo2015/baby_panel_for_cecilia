import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSlice } from "../../stores/slices/auth";
import { createRecordsSlice } from "../../stores/slices/records";
import { invalidateCache } from "../../stores/slices/helpers";

const babyA = "test_baby_food_a";
const babyB = "test_baby_food_b";
const foodId = "test_food_log";

function store() {
  const state: Record<string, any> = {};
  const set = (update: any) => Object.assign(state, typeof update === "function" ? update(state) : update);
  const get = () => state;
  Object.assign(state, createAuthSlice(set, get), createRecordsSlice(set, get), {
    user: { id: "test_user_food", username: "test_user_food" },
    family: { id: "test_family_food", name: "test_family_food" },
    babies: [{ id: babyA, familyId: "test_family_food" }, { id: babyB, familyId: "test_family_food" }],
    baby: { id: babyA, familyId: "test_family_food" },
    selectedBabyId: babyA,
    authLoading: false,
  });
  state.fetchDailySummary = async () => {};
  state.fetchTimeline = async () => {};
  return state;
}

const foodInput = {
  date: "2026-09-19",
  time: "12:00",
  foods: ["test_carrot"],
  portion: "most",
  acceptance: 3,
  babyState: "happy",
  hasAbnormal: false,
} as const;

test("food create uses the selected baby even when the form carries an empty babyId", async t => {
  invalidateCache();
  const state = store();
  let posted: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/food/logs");
    posted = JSON.parse(String(init?.body));
    return Response.json({ id: foodId, ...foodInput });
  });

  await state.addFoodLogRecord({ ...foodInput, babyId: undefined } as any);

  assert.equal(posted?.babyId, babyA);
  assert.equal(state.foodLogRecords[0]?.id, foodId);
  invalidateCache();
});

test("food update carries the captured baby scope and ignores a late response after switching babies", async t => {
  invalidateCache();
  const state = store();
  state.foodLogRecords = [{ id: foodId, babyId: babyA, version: "7" }];
  let body: Record<string, unknown> | undefined;
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/food/logs");
    body = JSON.parse(String(init?.body));
    return new Promise<Response>(done => { resolve = done; });
  });

  const pending = state.updateTimelineRecord("food", foodId, { acceptance: 0 });
  assert.equal(body?.babyId, babyA);
  assert.equal(body?.baseVersion, "7");
  state.baby = { id: babyB };
  state.selectedBabyId = babyB;
  state.foodLogRecords = [{ id: "test_food_baby_b" }];
  resolve(Response.json({ id: foodId, babyId: babyA, acceptance: 0 }));
  await pending;

  assert.deepEqual(state.foodLogRecords, [{ id: "test_food_baby_b" }]);
  invalidateCache();
});

test("food delete carries the captured baby scope and ignores a late response after switching babies", async t => {
  invalidateCache();
  const state = store();
  state.foodLogRecords = [{ id: foodId, babyId: babyA, version: "8" }];
  let body: Record<string, unknown> | undefined;
  let resolve!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", (url: string, init?: RequestInit) => {
    assert.equal(url, "/api/food/logs");
    body = JSON.parse(String(init?.body));
    return new Promise<Response>(done => { resolve = done; });
  });

  const pending = state.deleteTimelineRecord("food", foodId);
  assert.equal(body?.babyId, babyA);
  assert.equal(body?.baseVersion, "8");
  state.baby = { id: babyB };
  state.selectedBabyId = babyB;
  state.foodLogRecords = [{ id: "test_food_baby_b" }];
  resolve(Response.json({ success: true, id: foodId }));
  await pending;

  assert.deepEqual(state.foodLogRecords, [{ id: "test_food_baby_b" }]);
  invalidateCache();
});
