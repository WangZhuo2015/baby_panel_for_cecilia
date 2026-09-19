import test from "node:test";
import assert from "node:assert/strict";
import { GROWDESK_CONFIG } from "../../lib/config";
import { GET as getItems, POST as postItem } from "../../app/api/food/items/route";
import { createGrowthSlice } from "../../stores/slices/growth";
import { invalidateCache } from "../../stores/slices/helpers";

const cookie = `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`;

function request(path: string, body?: unknown): Request {
  return new Request(`https://test.invalid${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie, origin: "https://test.invalid", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setup(t: any, handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
    invalidateCache();
  });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/v1/auth/bff/session")) {
      return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    }
    return handler(url, init);
  });
}

test("food BFF forwards the selected family scope for list and create", async t => {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  setup(t, (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return init?.method === "POST"
      ? Response.json({ data: { id: "test_food_b", name: "test_food_b" } }, { status: 201 })
      : Response.json({ data: [{ id: "test_food_b", name: "test_food_b" }] });
  });

  const list = await getItems(request("/api/food/items?familyId=test_family_b"));
  assert.equal(list.status, 200);
  assert.equal(calls[0]?.url, `${GROWDESK_CONFIG.apiUrl}/api/v1/food/items?familyId=test_family_b`);

  const create = await postItem(request("/api/food/items", {
    familyId: "test_family_b",
    name: "test_food_b",
    category: "fruit",
  }));
  assert.equal(create.status, 201);
  assert.equal(calls[1]?.body?.familyId, "test_family_b");
});

test("food store keys by family and ignores a late response after switching families", async t => {
  invalidateCache();
  const state: Record<string, any> = {
    user: { id: "test_user_food_scope" },
    family: { id: "test_family_a" },
    authLoading: false,
    foodItems: [],
  };
  const set = (patch: any) => Object.assign(state, typeof patch === "function" ? patch(state) : patch);
  const get = () => state;
  Object.assign(state, createGrowthSlice(set, get));

  const pending = new Map<string, (response: Response) => void>();
  const requested: string[] = [];
  t.mock.method(globalThis, "fetch", (url: string) => {
    requested.push(url);
    return new Promise<Response>(resolve => pending.set(url, resolve));
  });

  const familyAUrl = "/api/food/items?familyId=test_family_a";
  const familyBUrl = "/api/food/items?familyId=test_family_b";
  const loadA = state.fetchFoodItems(undefined, true);
  assert.ok(requested.includes(familyAUrl));

  state.family = { id: "test_family_b" };
  const loadB = state.fetchFoodItems(undefined, true);
  assert.ok(requested.includes(familyBUrl));

  pending.get(familyBUrl)!(Response.json([{ id: "test_food_b", foodId: "test_food_b" }]));
  await loadB;
  assert.equal(state.foodItems[0]?.id, "test_food_b");

  pending.get(familyAUrl)!(Response.json([{ id: "test_food_a", foodId: "test_food_a" }]));
  await loadA;
  assert.equal(state.foodItems[0]?.id, "test_food_b");
});
