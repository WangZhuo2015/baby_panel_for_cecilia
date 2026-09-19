import assert from "node:assert/strict";
import test from "node:test";

import { GROWDESK_CONFIG } from "../../lib/config";
import {
  foodPlanWriteBody,
  readGrowDeskFoodPlan,
} from "../../lib/growdesk/food-plan-state";
import { POST as productsPost, GET as productsGet } from "../../app/api/nutrition/products/route";
import { POST as schedulesPost } from "../../app/api/nutrition/schedules/route";
import { PUT as selectionsPut } from "../../app/api/vaccines/selections/route";

const BABY = "test_baby";
const FAMILY = "test_family";
const COOKIE = `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`;

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: "test_plan",
    babyId: BABY,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    version: "7",
    planData: {},
    ...overrides,
  };
}

function apiBaby(id = BABY, familyId = FAMILY) {
  return {
    id,
    familyId,
    name: `test_baby_name_${id}`,
    birthDate: "2026-01-01",
    gender: "girl",
    avatarUrl: null,
    gestationalWeeks: null,
    gestationalDays: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
}

function formula(id: string, familyId = FAMILY) {
  return {
    id,
    familyId,
    brand: "test_brand",
    name: `test_formula_${id}`,
    stage: "1",
    scoopGrams: "4.3",
    waterMlPerScoop: "30",
    reconstitutionRatio: "0.1433",
    servingSizeUnit: "per_100g",
    nutrientsJson: { energy: { amount: 68, unit: "kcal" } },
    notes: null,
    isActive: true,
    isDefault: false,
    isArchived: false,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
}

function supplement() {
  return {
    id: "test_supplement",
    familyId: FAMILY,
    name: "test_vitamin",
    brand: "test_brand",
    dosageForm: "drops",
    unitName: "滴",
    defaultDose: 1,
    nutrients: {},
    isActive: true,
  };
}

function request(path: string, method = "GET", body?: unknown) {
  return new Request(`https://test.invalid${path}`, {
    method,
    headers: {
      cookie: COOKIE,
      origin: "https://test.invalid",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function setup(t: any, handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/v1/auth/bff/session")) {
      return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    }
    return handler(url, init || {});
  });
}

function oneFamilyIdentity(url: URL): Response | null {
  if (url.pathname === "/api/v1/families") {
    return Response.json({ data: [{ id: FAMILY, name: "test_family", timeZone: "Asia/Shanghai" }] });
  }
  if (url.pathname === `/api/v1/families/${FAMILY}/babies`) {
    return Response.json({ data: [apiBaby()] });
  }
  return null;
}

function selectedFamilyIdentity(url: URL): Response | null {
  if (url.pathname === "/api/v1/families") {
    return Response.json({
      data: [
        { id: "test_family_first", name: "test_first", timeZone: "Asia/Shanghai" },
        { id: "test_family_second", name: "test_second", timeZone: "Asia/Shanghai" },
      ],
    });
  }
  if (url.pathname === "/api/v1/families/test_family_first/babies") {
    return Response.json({ data: [apiBaby("test_baby_first", "test_family_first")] });
  }
  if (url.pathname === "/api/v1/families/test_family_second/babies") {
    return Response.json({ data: [apiBaby("test_baby_second", "test_family_second")] });
  }
  if (url.pathname === "/api/v1/babies/test_baby_second") {
    return Response.json({ data: apiBaby("test_baby_second", "test_family_second") });
  }
  return null;
}

test("food-plan CAS reader accepts only the canonical empty version 0 state", () => {
  const empty = readGrowDeskFoodPlan({
    ok: true,
    status: 200,
    data: {
      id: null,
      babyId: BABY,
      createdAt: null,
      updatedAt: "2026-09-19T00:00:00.000Z",
      version: "0",
      planData: {},
    },
  }, BABY);
  assert.deepEqual(foodPlanWriteBody(empty, { vaccineSelections: {} }), {
    baseVersion: "0",
    planData: { vaccineSelections: {} },
  });

  assert.throws(
    () => readGrowDeskFoodPlan({
      ok: true,
      status: 200,
      data: { ...plan(), version: "0", planData: { recipe: "test_recipe" } },
    }, BABY),
    (error: unknown) => (error as any)?.status === 502 && (error as any)?.code === "UPSTREAM_INVALID_RESPONSE",
  );
});

test("food-plan CAS reader preserves upstream failures and rejects malformed versions as upstream errors", () => {
  assert.throws(
    () => readGrowDeskFoodPlan({ ok: false, status: 503, error: { code: "TEST_OUTAGE", message: "test_unavailable" } }, BABY),
    (error: unknown) => (error as any)?.status === 503 && (error as any)?.code === "TEST_OUTAGE",
  );
  assert.throws(
    () => readGrowDeskFoodPlan({ ok: true, status: 200, data: { ...plan(), version: undefined } }, BABY),
    (error: unknown) => (error as any)?.status === 502 && (error as any)?.code === "UPSTREAM_INVALID_RESPONSE",
  );
});

test("products GET uses the requested baby family and exhausts formula pages", async t => {
  setup(t, async url => {
    const identity = selectedFamilyIdentity(url);
    if (identity) return identity;
    if (url.pathname === "/api/v1/babies/test_baby_second/food-plan") {
      return Response.json({ data: plan({ babyId: "test_baby_second", planData: { supplementState: {} } }) });
    }
    if (url.pathname === "/api/v1/families/test_family_second/nutrition/products") {
      if (url.searchParams.get("cursor") === "test_cursor") {
        return Response.json({ data: [formula("test_formula_second", "test_family_second")], page: { nextCursor: null } });
      }
      return Response.json({ data: [formula("test_formula_first", "test_family_second")], page: { nextCursor: "test_cursor" } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const response = await productsGet(request("/api/nutrition/products?babyId=test_baby_second&type=formula"));
  assert.equal(response.status, 200);
  const body = await response.json() as { formulas: Array<{ id: string; familyId: string }> };
  assert.deepEqual(body.formulas.map(item => item.id), ["test_formula_first", "test_formula_second"]);
  assert.ok(body.formulas.every(item => item.familyId === "test_family_second"));
});

test("products GET propagates a paginated catalog outage instead of returning an empty list", async t => {
  setup(t, async url => {
    const identity = oneFamilyIdentity(url);
    if (identity) return identity;
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan`) {
      return Response.json({ data: plan({ planData: { supplementState: {} } }) });
    }
    if (url.pathname === `/api/v1/families/${FAMILY}/nutrition/products`) {
      return Response.json({ error: { code: "TEST_OUTAGE", message: "test_catalog_down" } }, { status: 503 });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const response = await productsGet(request("/api/nutrition/products?type=formula"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "TEST_OUTAGE");
});

test("formula creation sends the observed food-plan version", async t => {
  let planWrite: Record<string, any> = {};
  setup(t, async (url, init) => {
    const identity = oneFamilyIdentity(url);
    if (identity) return identity;
    if (url.pathname === `/api/v1/families/${FAMILY}/nutrition/products`) {
      return Response.json({ data: formula("test_formula_created") }, { status: 201 });
    }
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan`) {
      if (init.method === "PUT") {
        planWrite = JSON.parse(String(init.body)) as Record<string, any>;
        return Response.json({ data: plan({ version: "8", planData: planWrite.planData }) });
      }
      return Response.json({ data: plan({ planData: { supplementState: {} } }) });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const response = await productsPost(request("/api/nutrition/products", "POST", {
    type: "formula",
    name: "test_formula_new",
    brand: "test_brand",
    isDefault: true,
  }));
  assert.equal(response.status, 201);
  assert.equal(planWrite.baseVersion, "7");
});

test("formula creation reports a food-plan 409 as a partial mutation", async t => {
  setup(t, async (url, init) => {
    const identity = oneFamilyIdentity(url);
    if (identity) return identity;
    if (url.pathname === `/api/v1/families/${FAMILY}/nutrition/products`) {
      return Response.json({ data: formula("test_formula_created") }, { status: 201 });
    }
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan` && init.method !== "PUT") {
      return Response.json({ data: plan({ planData: { supplementState: {} } }) });
    }
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan` && init.method === "PUT") {
      return Response.json({ error: { code: "VERSION_CONFLICT", message: "test_stale_plan" } }, { status: 409 });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });
  const conflict = await productsPost(request("/api/nutrition/products", "POST", {
    type: "formula",
    name: "test_formula_conflict",
    brand: "test_brand",
    isDefault: true,
  }));
  assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json();
  assert.equal(conflictBody.code, "VERSION_CONFLICT");
  assert.equal(conflictBody.details.partialMutation, true);
});

test("formula creation propagates a food-plan 503 instead of merging an empty plan", async t => {
  setup(t, async (url, init) => {
    const identity = oneFamilyIdentity(url);
    if (identity) return identity;
    if (url.pathname === `/api/v1/families/${FAMILY}/nutrition/products`) {
      return Response.json({ data: formula("test_formula_created") }, { status: 201 });
    }
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan` && init.method !== "PUT") {
      return Response.json({ error: { code: "TEST_PLAN_OUTAGE", message: "test_plan_unavailable" } }, { status: 503 });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const response = await productsPost(request("/api/nutrition/products", "POST", {
    type: "formula",
    name: "test_formula_plan_outage",
    brand: "test_brand",
    isDefault: true,
  }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "TEST_PLAN_OUTAGE");
  assert.equal(body.details.partialMutation, true);
});

test("supplement schedule and vaccine selection carry the same observed food-plan version", async t => {
  const writes: Array<Record<string, unknown>> = [];
  setup(t, async (url, init) => {
    if (url.pathname === `/api/v1/babies/${BABY}`) return Response.json({ data: apiBaby() });
    if (url.pathname === `/api/v1/babies/${BABY}/food-plan`) {
      if (init.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return Response.json({ data: plan({ version: "8" }) });
      }
      return Response.json({ data: plan({ planData: { supplementState: { supplementProducts: [supplement()], supplementSchedules: [] } } }) });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const schedule = await schedulesPost(request("/api/nutrition/schedules", "POST", {
    babyId: BABY,
    productId: "test_supplement",
  }));
  assert.equal(schedule.status, 201);

  const vaccine = await selectionsPut(request("/api/vaccines/selections", "PUT", {
    babyId: BABY,
    vaccineId: "test_vaccine",
    doseNumber: 1,
    selected: false,
  }));
  assert.equal(vaccine.status, 200);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(write => write.baseVersion), ["7", "7"]);
});
