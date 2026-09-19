import test from "node:test";
import assert from "node:assert/strict";
import { GROWDESK_CONFIG } from "../../lib/config";
import { GET as getItems, POST as postItem } from "../../app/api/food/items/route";
import { createGrowthSlice } from "../../stores/slices/growth";

const request = (body?: unknown) => new Request("https://test.invalid/api/food/items", {
  method: "POST",
  headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`, origin: "https://test.invalid", "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function setup(t: any, handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/v1/auth/bff/session")) return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    return handler(url, init);
  });
}

test("F3 legacy create-as-tried forwards tried to backend and returns familyStatus", async t => {
  const writes: any[] = [];
  setup(t, (_url, init) => {
    const body = JSON.parse(String(init?.body));
    writes.push(body);
    return Response.json({ data: { id: "test_custom_food", name: "test_rice", familyStatus: { tried: true, reaction: null } } }, { status: 201 });
  });
  const res = await postItem(request({ name: "test_rice", category: "other", status: "tried" }));
  assert.equal(res.status, 201);
  assert.equal(writes[0].tried, true, "tried must be forwarded when legacy status is tried");
  const json = await res.json();
  assert.equal(json.familyStatus.tried, true);
});

test("F3 create-as-tried survives the actual picker store reload", async t => {
  const rows: any[] = [];
  const state: any = {};
  const slice = createGrowthSlice((patch: any) => Object.assign(state, patch), () => state);
  Object.assign(state, slice);
  setup(t, (url, init) => {
    if (url.startsWith("/api/food/items")) {
      return getItems(new Request(`https://test.invalid${url}`, {
        headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}` },
      }));
    }
    assert.ok(url.endsWith("/api/v1/food/items"), `unexpected upstream: ${url}`);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      // Persist only what the BFF actually sends, not a canned tried response.
      const row = { id: `test_custom_food_${rows.length}`, name: body.name,
        familyStatus: body.tried === undefined ? undefined : { tried: body.tried, reaction: null } };
      rows.push(row);
      return Response.json({ data: row }, { status: 201 });
    }
    return Response.json({ data: rows });
  });
  const response = await postItem(request({ name: "test_rice", category: "other", status: "tried" }));
  assert.equal(response.status, 201);
  const created = await response.json();
  await slice.fetchFoodItems("tried", true);
  assert.equal(state.foodItems.length, 1, "created custom food must remain in the tried picker after reload");
  assert.equal(state.foodItems[0].foodId, created.id);
  assert.equal(state.foodItems[0].status, "tried");
});

test("F3 create without legacy status omits tried entirely", async t => {
  const writes: any[] = [];
  setup(t, (_url, init) => {
    const body = JSON.parse(String(init?.body));
    writes.push(body);
    return Response.json({ data: { id: "test_custom_food", name: "test_pear" } }, { status: 201 });
  });
  const res = await postItem(request({ name: "test_pear", category: "other" }));
  assert.equal(res.status, 201);
  assert.equal("tried" in writes[0], false, "tried must not be sent without legacy status");
});
