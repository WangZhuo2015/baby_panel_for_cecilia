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
  assert.equal(JSON.parse(String(calls[1]!.init?.body)).babyId, "test_baby_selected");
  invalidateCache();
});
