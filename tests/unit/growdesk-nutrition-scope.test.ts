import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PUT, DELETE } from "../../app/api/nutrition/products/route";
import { GROWDESK_CONFIG } from "../../lib/config";
import { BridgeError, type BridgeFetch } from "../../lib/growdesk/bridge-protocol";
import { requireNutritionBaby, resolveNutritionScope } from "../../lib/growdesk/nutrition-scope";

const families = ["test_family_a", "test_family_b"];
const babies = families.map((familyId, i) => ({
  id: `test_baby_${i}`, familyId, name: `test_baby_${i}`, birthDate: "2026-01-01", gender: "girl",
  avatarUrl: null, gestationalWeeks: null, gestationalDays: null,
}));
const at = "2026-09-01T00:00:00.000Z";
const product = (familyId: string) => ({
  id: "test_product", familyId, name: "test_supplement", brand: "test_brand", dosageForm: "drops", unitName: "滴",
  defaultDose: "1", nutrientsJson: {}, notes: null, isActive: true, isArchived: false, version: 1, createdAt: at, updatedAt: at,
});
function setup(t: TestContext) {
  const old = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (old === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = old; });
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/v1/auth/bff/session") {
      return Response.json({ data: { accessToken: "test_access", user: { id: "test_user", username: "test_user", displayName: "test_user" } } });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test_access");
    if (method !== "GET") {
      writes.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : {} });
      assert.ok(url.pathname.includes("test_family_b") || url.pathname.includes("test_baby_1"), "must never write to the first family/baby");
      if (url.pathname.endsWith("/food-plan")) return Response.json({ data: { success: true } });
      if (method === "DELETE") return Response.json({ data: { id: "test_product", deleted: true } });
      return Response.json({ data: { ...product("test_family_b"), ...JSON.parse(String(init?.body)) } }, { status: method === "POST" ? 201 : 200 });
    }
    if (url.pathname === "/api/v1/families") return Response.json({ data: families.map(id => ({ id, name: id })) });
    const baby = babies.find(b => url.pathname === `/api/v1/babies/${b.id}`);
    if (baby) return Response.json({ data: baby });
    const group = babies.find(b => url.pathname === `/api/v1/families/${b.familyId}/babies`);
    if (group) return Response.json({ data: [group] });
    if (url.pathname.endsWith("/food-plan")) {
      assert.ok(url.pathname.includes("test_baby_1"));
      return Response.json({ data: { id: "test_plan", babyId: "test_baby_1", version: "4", planData: { untouched: "test_sentinel" }, createdAt: at, updatedAt: at } });
    }
    if (url.pathname.endsWith("/nutrition/supplement-products")) {
      return Response.json({ data: [product("test_family_b")], page: { nextCursor: null } });
    }
    throw new Error(`Unexpected path ${method} ${url.pathname}`);
  });
  return writes;
}
function request(method: string, body?: Record<string, unknown>, query = "") {
  return new Request("https://test.invalid/api/nutrition/products" + query, {
    method, headers: { origin: "https://test.invalid", "content-type": "application/json", cookie: `${GROWDESK_CONFIG.cookieName}=${"b".repeat(64)}`, "x-growdesk-expected-user": "test_user" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("all product methods resolve the explicitly selected second family", async t => {
  const writes = setup(t);
  const selected = { babyId: "test_baby_1", familyId: "test_family_b", type: "supplement", name: "test_supplement" };
  const read = await GET(request("GET", undefined, "?babyId=test_baby_1&type=supplement"));
  assert.equal(read.status, 200);
  assert.equal((await read.json()).supplements[0].familyId, "test_family_b");
  assert.equal((await POST(request("POST", selected))).status, 201);
  assert.equal((await PUT(request("PUT", { ...selected, id: "test_product" }))).status, 200);
  assert.equal((await DELETE(request("DELETE", undefined, "?babyId=test_baby_1&type=supplement&id=test_product"))).status, 200);
  assert.equal(writes.length, 3);
  assert.ok(writes.every(write => write.path.startsWith("/api/v1/families/test_family_b/")));
});

test("default-formula side effects use the selected baby's plan and preserve other namespaces", async t => {
  const writes = setup(t);
  const response = await POST(request("POST", { babyId: "test_baby_1", type: "formula", name: "test_formula", brand: "test_brand", isDefault: true }));
  assert.equal(response.status, 201);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, "/api/v1/families/test_family_b/nutrition/products");
  assert.equal(writes[1].path, "/api/v1/babies/test_baby_1/food-plan");
  assert.equal(writes[1].body.baseVersion, "4");
  assert.equal((writes[1].body.planData as Record<string, unknown>).untouched, "test_sentinel");
});

for (const [label, selection, code, status] of [
  ["ambiguous missing selection", {}, "FAMILY_SELECTION_REQUIRED", 409],
  ["empty explicit choice", { babyId: "" }, "INVALID_ID", 400],
  ["conflicting family", { babyId: "test_baby_1", familyId: "test_family_a" }, "BABY_SCOPE_MISMATCH", 409],
  ["foreign family", { familyId: "test_foreign_family" }, "FAMILY_ACCESS_DENIED", 403],
] as const) {
  test(`${label} fails before any product write`, async t => {
    const writes = setup(t);
    const response = await POST(request("POST", { type: "supplement", name: "test_name", ...selection }));
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
    assert.deepEqual(writes, []);
  });
}

test("cross-tab account changes and unsafe product ids do not write", async t => {
  const writes = setup(t);
  const req = request("POST", { babyId: "test_baby_1", name: "test_name" });
  req.headers.set("x-growdesk-expected-user", "test_old_user");
  const response = await POST(req);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "IDENTITY_CHANGED");
  assert.equal((await PUT(request("PUT", { babyId: "test_baby_1", id: "../test_other" }))).status, 400);
  assert.deepEqual(writes, []);
});

test("same-family multi-baby inference is rejected, but a sole baby remains backward compatible", async () => {
  let count = 2;
  const fetchApi: BridgeFetch = async <T>(path: string) => ({ ok: true, status: 200, data: (
    path === "/api/v1/families" ? [{ id: families[0], name: families[0] }]
      : Array.from({ length: count }, (_, i) => ({ ...babies[0], id: `test_baby_${i}` }))
  ) as T });
  await assert.rejects(resolveNutritionScope(fetchApi, "test_token", {}), (e: unknown) => e instanceof BridgeError && e.code === "BABY_SELECTION_REQUIRED");
  count = 1;
  assert.equal((await requireNutritionBaby(fetchApi, "test_token", {})).id, "test_baby_0");
});

test("a wrong-baby response cannot be used to choose a write scope", async () => {
  const fetchApi: BridgeFetch = async <T>() => ({ ok: true, status: 200, data: babies[0] as T });
  await assert.rejects(resolveNutritionScope(fetchApi, "test_token", { babyId: "test_baby_1" }), (e: unknown) => e instanceof BridgeError && e.code === "UPSTREAM_SCOPE_MISMATCH");
});
