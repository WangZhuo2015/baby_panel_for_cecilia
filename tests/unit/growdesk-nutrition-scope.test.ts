import test from "node:test";
import assert from "node:assert/strict";
import { resolveNutritionScope } from "../../lib/growdesk/nutrition-scope";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { createNutritionFetch, NutritionIdentityChangedError, type NutritionIdentity } from "../../lib/nutrition/scoped-fetch";

const token = "test_access";
const url = "https://test.invalid/api/nutrition/products";
const familyA = { id: "test_family_a", name: "test A", role: "admin", timeZone: "Asia/Tokyo" };
const familyB = { id: "test_family_b", name: "test B", role: "admin", timeZone: "Asia/Tokyo" };
const baby = (id: string, familyId: string) => ({
  id, familyId, name: id, gender: "girl", birthDate: "2026-01-01",
  avatarUrl: null, gestationalWeeks: null, gestationalDays: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
function api(fn: (path: string) => unknown): BridgeFetch {
  return async <T>(path: string) => ({ ok: true, status: 200, data: fn(path) }) as BridgeResult<T>;
}
const multiFamily = api(path => {
  if (path === "/api/v1/families") return [familyA, familyB];
  if (path === `/api/v1/families/${familyA.id}/babies`) return [baby("test_baby_a", familyA.id)];
  if (path === `/api/v1/families/${familyB.id}/babies`) return [baby("test_baby_b", familyB.id)];
  if (path === "/api/v1/babies/test_baby_b") return baby("test_baby_b", familyB.id);
  throw new Error("Unexpected request " + path);
});
test("explicit non-first baby determines product family for all methods", async () => {
  assert.deepEqual(await resolveNutritionScope(multiFamily, token, url + "?babyId=test_baby_b"),
    { babyId: "test_baby_b", familyId: familyB.id });
  assert.deepEqual(await resolveNutritionScope(multiFamily, token, url, { babyId: "test_baby_b", familyId: familyB.id }),
    { babyId: "test_baby_b", familyId: familyB.id });
});
test("multi-family and conflicting request scope never silently fall back", async () => {
  await assert.rejects(resolveNutritionScope(multiFamily, token, url),
    e => e instanceof BridgeError && e.code === "FAMILY_SELECTION_REQUIRED");
  await assert.rejects(resolveNutritionScope(multiFamily, token, url + "?babyId=test_baby_b&familyId=test_family_a"),
    e => e instanceof BridgeError && e.status === 403);
  for (const [suffix, body] of [
    ["?babyId=test_baby_b", { babyId: "test_baby_a" }],
    ["?babyId=test_baby_b&babyId=test_baby_b", {}],
    ["?babyId=", {}], ["?familyId=test_family_b", { familyId: "test_family_a" }],
  ] as const) {
    await assert.rejects(resolveNutritionScope(api(() => { throw new Error("must not call"); }), token, url + suffix, body),
      e => e instanceof BridgeError && e.status === 400);
  }
});
test("single-family old clients remain supported and no-family is an explicit empty state", async () => {
  const single = api(path => path === "/api/v1/families" ? [familyA] : [baby("test_baby_a", familyA.id)]);
  assert.deepEqual(await resolveNutritionScope(single, token, url), { familyId: familyA.id, babyId: "test_baby_a" });
  assert.deepEqual(await resolveNutritionScope(api(() => []), token, url), { familyId: null, babyId: null });
});
test("multiple babies require a choice; corrupted upstream scope is rejected", async () => {
  const multiple = api(path => path === "/api/v1/families" ? [familyA] : [baby("test_a", familyA.id), baby("test_b", familyA.id)]);
  await assert.rejects(resolveNutritionScope(multiple, token, url + "?familyId=" + familyA.id),
    e => e instanceof BridgeError && e.code === "BABY_SELECTION_REQUIRED");
  await assert.rejects(resolveNutritionScope(api(() => baby("other", familyA.id)), token, url + "?babyId=test_a"),
    e => e instanceof BridgeError && e.code === "UPSTREAM_SCOPE_MISMATCH");
});

const identity: NutritionIdentity = { userId: "test_user", familyId: "test_family", babyId: "test_baby" };
test("browser nutrition requests retain other query and request fields and bind explicit scope", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const scoped = createNutritionFetch(identity, () => identity, async (path, init) => {
    calls.push({ path: String(path), init });
    return Response.json({ success: true });
  });
  const body = JSON.stringify({ type: "supplement", name: "test_product" });
  const response = await scoped("/api/nutrition/products?type=supplement&includeInactive=true", { method: "POST", body });
  assert.equal(calls.length, 1);
  const parsed = new URL(calls[0].path, "https://test.invalid");
  assert.equal(parsed.searchParams.get("familyId"), identity.familyId);
  assert.equal(parsed.searchParams.get("babyId"), identity.babyId);
  assert.equal(parsed.searchParams.get("includeInactive"), "true");
  assert.equal(calls[0].init?.body, body);
  assert.deepEqual(await response.json(), { success: true });
});
test("old browser click handlers cannot write after an account or baby switch", async () => {
  let current: NutritionIdentity | null = identity;
  let writes = 0;
  const scoped = createNutritionFetch(identity, () => current, async () => { writes++; return Response.json({}); });
  current = { ...identity, userId: "other" };
  await assert.rejects(scoped("/api/nutrition/products", { method: "POST", body: "{}" }), NutritionIdentityChangedError);
  current = { ...identity, babyId: "other" };
  await assert.rejects(scoped("/api/nutrition/schedules"), NutritionIdentityChangedError);
  current = null;
  await assert.rejects(scoped("/api/nutrition/products"), NutritionIdentityChangedError);
  assert.equal(writes, 0);
});
test("late response headers and late JSON cannot repopulate another identity's catalog", async () => {
  let current = identity;
  const scoped = createNutritionFetch(identity, () => current, async () => {
    current = { ...identity, familyId: "other" };
    return Response.json({ formulas: ["private"] });
  });
  await assert.rejects(scoped("/api/nutrition/products"), NutritionIdentityChangedError);
  current = identity;
  const response = await createNutritionFetch(identity, () => current, async () => Response.json({ formulas: ["private"] }))("/api/nutrition/products");
  current = { ...identity, userId: "other" };
  await assert.rejects(response.json(), NutritionIdentityChangedError);
});
test("scope cannot be attached to arbitrary origins or overridden by a URL", async () => {
  let calls = 0;
  const scoped = createNutritionFetch(identity, () => identity, async () => { calls++; return Response.json({}); });
  for (const path of ["https://other.test/api/nutrition/products", "//other.test/api/nutrition/products",
    "/api/nutrition/../auth/login", "/api/nutrition/products#fragment",
    "/api/nutrition/products?babyId=other", "/api/nutrition/products?babyId=test_baby&babyId=other"]) {
    await assert.rejects(scoped(path));
  }
  assert.equal(calls, 0);
});

test("catalog workflows cannot treat failed sub-writes as successful updates", async () => {
  const identity = { userId: "test_user", familyId: "test_family", babyId: "test_baby" };
  const backend = (async () => Response.json({ error: "版本冲突，请刷新" }, { status: 409 })) as typeof fetch;
  const strict = createNutritionFetch(identity, () => identity, backend, true);
  await assert.rejects(strict("/api/nutrition/schedules", { method: "POST" }), /版本冲突/);
  const ordinary = createNutritionFetch(identity, () => identity, backend);
  assert.equal((await ordinary("/api/nutrition/schedules")).status, 409);
});
