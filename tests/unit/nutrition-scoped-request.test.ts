import test from "node:test";
import assert from "node:assert/strict";
import { createScopedNutritionRequest, NutritionScopeChanged, NutritionRequestError, type NutritionClientScope } from "../../lib/nutrition/scoped-request";

const owner: NutritionClientScope = { userId: "test_user", familyId: "test_family_b", babyId: "test_baby_b" };

test("catalog, schedule and record calls carry one captured scope for all methods", async () => {
  const seen: { path: string; init: RequestInit }[] = [];
  const client = createScopedNutritionRequest(owner, () => owner, async (path, init) => {
    seen.push({ path: String(path), init: init! });
    return Response.json({ success: true });
  });
  for (const method of ["GET", "DELETE", "POST", "PUT"]) {
    const response = await client.request("/api/nutrition/products?includeInactive=true", {
      method, ...(["POST", "PUT"].includes(method) ? { body: JSON.stringify({ isActive: false, notes: "", value: 0 }) } : {}),
    });
    assert.equal(response.status, 200);
    const last = seen.at(-1)!;
    const url = new URL(last.path, "https://test.invalid");
    assert.equal(url.searchParams.get("babyId"), owner.babyId);
    assert.equal(url.searchParams.get("familyId"), owner.familyId);
    assert.equal(url.searchParams.get("includeInactive"), "true");
    assert.equal(new Headers(last.init.headers).get("x-growdesk-expected-user"), owner.userId);
    if (last.init.body) assert.deepEqual(JSON.parse(String(last.init.body)), { isActive: false, notes: "", value: 0, babyId: owner.babyId, familyId: owner.familyId });
  }
  const form = new FormData(); form.set("image", new Blob(["test_image"]));
  await client.request("/api/ai/parse-nutrition", { method: "POST", body: form });
  assert.equal((seen.at(-1)!.init.body as FormData).get("babyId"), owner.babyId);
  assert.equal(form.has("babyId"), false, "must not mutate the caller's form");
});

test("missing, conflicting and foreign-origin selections never reach fetch", async () => {
  let calls = 0;
  const fetchApi: typeof fetch = async () => { calls++; return Response.json({}); };
  const client = createScopedNutritionRequest(owner, () => owner, fetchApi);
  await assert.rejects(createScopedNutritionRequest(null, () => owner, fetchApi).request("/api/nutrition/products"), NutritionScopeChanged);
  await assert.rejects(client.request("/api/nutrition/products?babyId=test_other"), NutritionScopeChanged);
  await assert.rejects(client.request("/api/nutrition/products", { method: "POST", body: JSON.stringify({ familyId: "test_other" }) }), NutritionScopeChanged);
  await assert.rejects(client.request("https://example.invalid/api/nutrition/products"), /Unsupported/);
  await assert.rejects(client.request("//example.invalid/api/nutrition/products"), /Unsupported/);
  assert.equal(calls, 0);
});

test("account/baby changes suppress stale responses and prevent follow-up writes", async () => {
  let current = { ...owner };
  let release!: (response: Response) => void;
  let calls = 0;
  const client = createScopedNutritionRequest(owner, () => current, async () => { calls++; return new Promise(resolve => { release = resolve; }); });
  const result = client.request("/api/nutrition/products");
  current = { ...owner, userId: "test_other_user" };
  release(Response.json({ formulas: [{ id: "test_private" }] }));
  await assert.rejects(result, NutritionScopeChanged);
  await assert.rejects(client.request("/api/nutrition/schedules", { method: "POST", body: "{}" }), NutritionScopeChanged);
  assert.equal(calls, 1);
});

test("scope is checked again before consuming a previously successful response", async () => {
  let current = { ...owner };
  const client = createScopedNutritionRequest(owner, () => current, async () => Response.json({ id: "test_product" }));
  const response = await client.request("/api/nutrition/products");
  current = { ...owner, babyId: "test_other_baby" };
  await assert.rejects(response.json(), NutritionScopeChanged);
});

test("StrictMode cleanup/reactivation does not revive old requests or disable new ones", async () => {
  const pending: ((response: Response) => void)[] = [];
  const client = createScopedNutritionRequest(owner, () => owner, async () => new Promise(resolve => { pending.push(resolve); }));
  const stale = client.request("/api/nutrition/products");
  client.dispose(); client.activate();
  const current = client.request("/api/nutrition/products");
  pending[0](Response.json({ private: "test_old" })); pending[1](Response.json({ private: "test_new" }));
  await assert.rejects(stale, NutritionScopeChanged);
  assert.deepEqual(await (await current).json(), { private: "test_new" });
});

test("upstream failures and partial writes are not successful UI operations", async () => {
  const client = createScopedNutritionRequest(owner, () => owner, async () => Response.json({ error: "test_plan_conflict", details: { partialMutation: true, resourceId: "test_created" } }, { status: 409 }));
  await assert.rejects(client.request("/api/nutrition/products"), (error: unknown) => error instanceof NutritionRequestError && error.status === 409 && error.message.includes("勿重复创建"));
  const safety = createScopedNutritionRequest(owner, () => owner, async () => Response.json({ requiresConfirmation: true }, { status: 409 }));
  assert.equal((await safety.request("/api/nutrition/records", { method: "POST", body: "{}" }, [409])).status, 409);
  const falseSuccess = createScopedNutritionRequest(owner, () => owner, async () => Response.json({ success: false }));
  await assert.rejects(falseSuccess.request("/api/nutrition/products"), NutritionRequestError);
});
