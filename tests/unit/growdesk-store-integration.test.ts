import test from "node:test";
import assert from "node:assert/strict";
import { createAuthSlice } from "../../stores/slices/auth";
import { createRecordsSlice } from "../../stores/slices/records";
import { invalidateCache } from "../../stores/slices/helpers";

function store() {
  const state: Record<string, any> = {};
  const set = (update: any) => Object.assign(state, typeof update === "function" ? update(state) : update);
  const get = () => state;
  Object.assign(state, createAuthSlice(set, get), createRecordsSlice(set, get), {
    user: { id: "test_user", username: "test_user" }, baby: { id: "test_baby_selected" }, authLoading: false,
  });
  return state;
}

test("failed logout keeps the session visible for a retry", async (t) => {
  const state = store();
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "upstream unavailable" }, { status: 503 }));
  await assert.rejects(state.logout(), /upstream unavailable/);
  assert.equal(state.user.id, "test_user");
  assert.equal(state.baby.id, "test_baby_selected");
});

test("identity refresh clears a baby that is no longer authorized", async (t) => {
  invalidateCache();
  const state = store();
  t.mock.method(globalThis, "fetch", async () => Response.json({ user: state.user, family: null, baby: null }));
  await state.fetchUser();
  assert.equal(state.baby, null);
  invalidateCache();
});

test("baby read and update use the selected baby explicitly", async (t) => {
  invalidateCache();
  const state = store();
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json({ id: "test_baby_selected" });
  });
  await state.fetchBaby(true);
  await state.saveBaby({ nickname: "test_new_name" });
  assert.equal(new URL(calls[0]!.url, "http://localhost").searchParams.get("babyId"), "test_baby_selected");
  assert.equal(new Headers(calls[0]!.init?.headers).get("x-growdesk-representation"), "extended");
  assert.equal(JSON.parse(String(calls[1]!.init?.body)).babyId, "test_baby_selected");
  invalidateCache();
});

test("identity reads explicitly request the extended GrowDesk representation", async (t) => {
  invalidateCache();
  const state = store();
  const baby = { id: "test_baby_selected", familyId: "test_family", nickname: "test_child", birthDate: "2026-01-01", gender: "female" };
  const calls: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/auth/me") return Response.json({ user: state.user, family: { id: "test_family", name: "test_family", babies: [baby] }, baby, families: [{ id: "test_family", name: "test_family", babies: [baby] }], babies: [baby] });
    if (url.startsWith("/api/family/members")) return Response.json({ family: { id: "test_family", name: "test_family" }, members: [] });
    if (url.startsWith("/api/baby")) return Response.json(baby);
    throw new Error(`Unexpected request ${url}`);
  });

  await state.fetchUser();
  await state.fetchFamilyMembers();
  await state.fetchBaby(true);
  assert.deepEqual(calls.map(call => [call.url, new Headers(call.init?.headers).get("x-growdesk-representation")]), [
    ["/api/auth/me", "extended"],
    ["/api/family/members?familyId=test_family", "extended"],
    ["/api/baby?babyId=test_baby_selected", "extended"],
  ]);
  invalidateCache();
});

test("cold record loads await the authorized baby before issuing scoped requests", async (t) => {
  invalidateCache();
  const state = store(); state.baby = null;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("/api/baby")) return Response.json({ id: "test_baby_loaded" });
    assert.equal(new URL(url, "http://localhost").searchParams.get("babyId"), "test_baby_loaded");
    return Response.json([]);
  });
  await Promise.all([state.fetchFeedingRecords(), state.fetchSleepRecords(), state.fetchDiaperRecords(), state.fetchFoodLogRecords(), state.fetchDailySummary(), state.fetchTimeline()]);
  assert.equal(calls.filter(call => call.url.startsWith("/api/baby")).length, 1);
  assert.equal(calls.length, 7);
  for (const call of calls.filter(call => !call.url.startsWith("/api/baby"))) {
    assert.equal(new Headers(call.init?.headers).get("x-growdesk-representation"), "extended");
  }
  invalidateCache();
});

test("record writes, including food POST and PUT, request the extended GrowDesk response", async (t) => {
  invalidateCache();
  const state = store();
  state.family = { id: "test_family" };
  state.baby = { id: "test_baby_selected", familyId: "test_family" };
  state.selectedBabyId = "test_baby_selected";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === "POST" || init?.method === "PUT") return Response.json({ id: "test_record" });
    return Response.json([]);
  });

  await state.addFeedingRecord({ type: "formula", timestamp: "2026-09-19T08:00:00.000Z" });
  await state.addSleepRecord({ startTime: "2026-09-19T09:00:00.000Z", endTime: "2026-09-19T09:30:00.000Z", type: "nap" });
  await state.addDiaperRecord({ type: "wet", timestamp: "2026-09-19T10:00:00.000Z" });
  await state.addFoodLogRecord({ date: "2026-09-19", time: "11:00", foods: [] });
  await state.updateTimelineRecord("food", "test_record", { acceptance: "liked" });

  const writes = calls.filter(call => call.init?.method === "POST" || call.init?.method === "PUT");
  assert.deepEqual(writes.map(call => [call.init?.method, call.url]), [
    ["POST", "/api/records/feeding"],
    ["POST", "/api/records/sleep"],
    ["POST", "/api/records/diaper"],
    ["POST", "/api/food/logs"],
    ["PUT", "/api/food/logs"],
  ]);
  for (const call of writes) {
    assert.equal(new Headers(call.init?.headers).get("x-growdesk-representation"), "extended");
    assert.equal(new Headers(call.init?.headers).get("content-type"), "application/json");
  }
  invalidateCache();
});

test("a late record response cannot overwrite a newly selected baby", async (t) => {
  invalidateCache();
  const state = store();
  let resolve!: (value: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>(done => { resolve = done; }));
  const pending = state.fetchFeedingRecords();
  state.baby = { id: "test_other_baby" };
  state.feedingRecords = [{ id: "test_other_record" }];
  resolve(Response.json([{ id: "test_old_record" }]));
  await pending;
  assert.deepEqual(state.feedingRecords, [{ id: "test_other_record" }]);
  invalidateCache();
});

test("saving a new baby invalidates the cached empty identity", async (t) => {
  invalidateCache();
  const state = store(); state.baby = null;
  let saved = false;
  const baby = { id: "test_new_baby", nickname: "test_new_name", birthDate: "2026-01-01", familyId: "test_family" };
  t.mock.method(globalThis, "fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { saved = true; return Response.json(baby); }
    return Response.json({ user: state.user, family: { id: "test_family", name: "test_family" }, baby: saved ? baby : null });
  });
  await state.fetchUser();
  await state.saveBaby({ nickname: baby.nickname, birthDate: baby.birthDate, gender: "female" });
  await state.fetchUser();
  assert.equal(state.babies[0]?.id, baby.id);
  assert.equal(state.baby?.id, baby.id);
  invalidateCache();
});
