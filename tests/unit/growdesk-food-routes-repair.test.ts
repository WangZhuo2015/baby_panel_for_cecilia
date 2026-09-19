import test from "node:test";
import assert from "node:assert/strict";
import { GROWDESK_CONFIG } from "../../lib/config";
import { GET as getItems, POST as postItem } from "../../app/api/food/items/route";
import { GET as getPlans, POST as postPlan } from "../../app/api/food/plans/route";
import { PUT as putLog } from "../../app/api/food/logs/route";
import { toGrowDeskFoodCreatePayload } from "../../lib/growdesk/food-compat";

const request = (path: string, body?: unknown) => new Request(`https://test.invalid${path}`, { method: body ? "POST" : "GET", headers: { cookie: `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`, origin: "https://test.invalid", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
function setup(t: any, handler: (url: string, init?: RequestInit) => Response) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.GROWDESK_ENABLED; else process.env.GROWDESK_ENABLED = previous; });
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/v1/auth/bff/session")) return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    return handler(url, init);
  });
}

test("F3 custom food POST sends canonical allergenRisk, never legacy allergens", async t => {
  const writes: any[] = [];
  setup(t, (_url, init) => { const body = JSON.parse(String(init?.body)); writes.push(body); return Response.json({ id: "test_food", ...body }, { status: 201 }); });
  for (const [allergens, risk] of [[[], "low"], [["test_egg"], "high"]] as const) {
    const res = await postItem(request("/api/food/items", { name: "test_food", category: "other", allergens }));
    assert.equal(res.status, 201);
    assert.equal(writes.at(-1).allergenRisk, risk);
    assert.equal("allergens" in writes.at(-1), false);
  }
});

test("F3 GET tried filter respects backend familyStatus.tried", async t => {
  setup(t, () => Response.json({ data: [{ id: "test_tried", name: "test_rice", familyStatus: { tried: true, reaction: null } }, { id: "test_untried", name: "test_pear", familyStatus: { tried: false, reaction: null } }] }));
  const res = await getItems(request("/api/food/items?status=tried"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.map((item: any) => [item.id, item.status]), [["test_tried", "tried"]]);
});

test("F2 actual log PUT reads existing observations before merging a partial edit", async t => {
  const existing = { id: "test_food", babyId: "test_baby", familyId: "test_family", version: "1", createdAt: "2026-09-17T00:00:00Z", updatedAt: "2026-09-17T00:00:00Z", ...toGrowDeskFoodCreatePayload({ date: "2026-09-17", time: "20:00", acceptance: 3, babyState: "happy", hasAbnormal: true, abnormalNotes: "test_rash", notes: "test_note" }) };
  let reads = 0;
  setup(t, (_url, init) => {
    if (init?.method === "PATCH") return Response.json({ data: { ...existing, ...JSON.parse(String(init.body)) } });
    reads++;
    return Response.json({ data: existing });
  });
  const req = request("/api/food/logs", { id: "test_food", babyId: "test_baby", version: "1", acceptance: 0 });
  const res = await putLog(new Request(req, { method: "PUT" }));
  assert.equal(res.status, 200);
  const restored = await res.json();
  assert.equal(reads, 1);
  assert.equal(restored.acceptance, 0);
  assert.equal(restored.babyState, "happy");
  assert.equal(restored.hasAbnormal, true);
  assert.equal(restored.abnormalNotes, "test_rash");
  assert.equal(restored.notes, "test_note");
});

const supplementState = { formula: { defaultFormulaId: "test_formula" }, supplements: [{ id: "test_supplement" }], vaccineSelections: { test_vaccine: true } };
const plan = { babyId: "test_baby", planData: { date: "2026-09-17", name: "test_recipe", tags: [], ingredients: ["test_rice"], steps: [], supplementState }, updatedAt: "2026-09-17T00:00:00Z" };

test("F5 saving a recipe merges unwrapped planData and preserves supplementState", async t => {
  let saved: any;
  setup(t, (_url, init) => {
    if (init?.method === "PUT") { saved = JSON.parse(String(init.body)); return Response.json({ data: { ...plan, planData: saved.planData } }); }
    return Response.json({ data: plan });
  });
  const res = await postPlan(request("/api/food/plans", { babyId: "test_baby", date: "2026-09-17", name: "test_new_recipe" }));
  assert.equal(res.status, 201);
  assert.deepEqual(saved.planData.supplementState, supplementState);
  assert.deepEqual(saved.planData.ingredients, ["test_rice"]);
  assert.equal(saved.planData.name, "test_new_recipe");
});

test("F5 GET exposes recipe date and fields at legacy top level", async t => {
  setup(t, () => Response.json({ data: plan }));
  const res = await getPlans(request("/api/food/plans?babyId=test_baby"));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data[0].date, "2026-09-17");
  assert.equal(data[0].name, "test_recipe");
  assert.deepEqual(data[0].ingredients, ["test_rice"]);
});

test("F5 failed read must not overwrite the saved supplement state", async t => {
  let writes = 0;
  setup(t, (_url, init) => { if (init?.method === "PUT") writes++; return Response.json({ error: { message: "test_unavailable" } }, { status: 503 }); });
  const res = await postPlan(request("/api/food/plans", { babyId: "test_baby", name: "test_recipe" }));
  assert.equal(res.status, 503);
  assert.equal(writes, 0);
});
