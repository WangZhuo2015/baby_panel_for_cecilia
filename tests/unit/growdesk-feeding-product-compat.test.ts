import assert from "node:assert/strict";
import test from "node:test";
import { GET as feedingGet } from "../../app/api/records/feeding/route";
import { GROWDESK_CONFIG } from "../../lib/config";
import { BridgeError, type BridgeFetch } from "../../lib/growdesk/bridge-protocol";
import {
  enrichGrowDeskFeedingRecords,
  type GrowDeskFeedingFormulaProduct,
} from "../../lib/growdesk/feeding-product-compat";
import type { GrowDeskFeedingRecord } from "../../lib/growdesk/feeding-compat";

const familyId = "test_family";
const babyId = "test_baby";
const productId = "test_formula";

function feeding(id: string, formulaProductId: string | null): GrowDeskFeedingRecord {
  return {
    id,
    babyId,
    familyId,
    feedingType: formulaProductId ? "formula" : "bottle",
    occurredAt: "2026-09-19T01:00:00.000Z",
    amountMl: "120",
    leftMinutes: null,
    rightMinutes: null,
    spitUp: false,
    formulaProductId,
    notes: null,
    source: "ui_manual",
    sourceAgent: null,
    recordedByUserId: "test_user",
    version: "7",
    createdAt: "2026-09-19T01:00:00.000Z",
    updatedAt: "2026-09-19T01:00:00.000Z",
  };
}

function canonicalProduct(overrides: Partial<GrowDeskFeedingFormulaProduct> = {}): GrowDeskFeedingFormulaProduct {
  return {
    id: productId,
    familyId,
    name: "test formula",
    brand: "test brand",
    stage: "1",
    scoopGrams: "4.300",
    waterMlPerScoop: "30",
    reconstitutionRatio: "0.1433",
    servingSizeUnit: "per_100g",
    // PostgreSQL JSONB commonly returns the scalar members in this order.
    nutrientsJson: { energy: { unit: "kcal", amount: 68 } },
    notes: "test notes",
    isActive: true,
    isDefault: false,
    isArchived: false,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

function apiWith(
  productPages: Array<{ data: unknown[]; nextCursor: string | null }> = [{ data: [canonicalProduct()], nextCursor: null }],
  planData: Record<string, unknown> = {
    supplementState: {
      defaultFormulaId: productId,
      customFormulaNutrients: {
        [productId]: {
          energy: { unit: "kcal", amount: 68, source: "test_reference" },
          protein: { unit: "g", amount: 1.4 },
        },
      },
    },
  },
) {
  const requests: string[] = [];
  let productPage = 0;
  const api: BridgeFetch = async <T>(path: string) => {
    requests.push(path);
    if (path.endsWith("/food-plan")) {
      return { ok: true, status: 200, data: { babyId, planData, updatedAt: "2026-09-19T00:00:00.000Z" } } as any;
    }
    if (path.includes("/nutrition/products?")) {
      const page = productPages[Math.min(productPage++, productPages.length - 1)]!;
      return { ok: true, status: 200, data: page.data, page: { nextCursor: page.nextCursor } } as any;
    }
    throw new Error(`unexpected path: ${path}`);
  };
  return { api, requests };
}

test("feeding compatibility enriches list rows once with the authorized family product", async () => {
  const { api, requests } = apiWith();
  const rows = await enrichGrowDeskFeedingRecords(api, "test_token", babyId, [
    feeding("test_formula_row", productId),
    feeding("test_bottle_row", null),
  ]);

  assert.equal(requests.filter((path) => path.endsWith("/food-plan")).length, 1);
  assert.equal(requests.filter((path) => path.includes("/nutrition/products?")).length, 1);
  assert.match(requests.find((path) => path.includes("/nutrition/products?"))!, /limit=200/);
  assert.match(requests.find((path) => path.includes("/nutrition/products?"))!, /includeArchived=true/);
  assert.deepEqual(rows[0]!.formulaProduct, {
    id: productId,
    familyId,
    name: "test formula",
    brand: "test brand",
    stage: 1,
    scoopWeightG: 4.3,
    waterPerScoopMl: 30,
    reconstitutionRatio: 0.1433,
    servingSizeUnit: "per_100g",
    nutrientsJson: '{"energy":{"amount":68,"unit":"kcal","source":"test_reference"},"protein":{"amount":1.4,"unit":"g"}}',
    notes: "test notes",
    isActive: true,
    isDefault: true,
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  });
  assert.equal(rows[1]!.formulaProduct, null);
  assert.equal(rows[0]!.version, "7");
  assert.equal(rows[0]!.baseVersion, "7");
});

test("feeding compatibility exhausts formula-product pages without issuing per-row reads", async () => {
  const secondProduct = canonicalProduct({ id: "test_formula_2", name: "test formula 2", isDefault: false });
  const { api, requests } = apiWith([
    { data: [], nextCursor: "test_page_2" },
    { data: [secondProduct], nextCursor: null },
  ], { supplementState: {} });
  const rows = await enrichGrowDeskFeedingRecords(api, "test_token", babyId, [feeding("test_row", "test_formula_2")]);

  assert.equal(rows[0]!.formulaProduct?.id, "test_formula_2");
  assert.equal(requests.filter((path) => path.includes("/nutrition/products?")).length, 2);
  assert.match(requests[2]!, /cursor=test_page_2/);
});

test("feeding compatibility propagates catalog failures and rejects cross-family products", async () => {
  const failedApi: BridgeFetch = async <T>(path: string) => {
    if (path.endsWith("/food-plan")) return { ok: true, status: 200, data: { babyId, planData: {} } } as any;
    return { ok: false, status: 503, error: { code: "TEST_OUTAGE", message: "catalog unavailable" } } as any;
  };
  await assert.rejects(
    () => enrichGrowDeskFeedingRecords(failedApi, "test_token", babyId, [feeding("test_row", productId)]),
    (error: unknown) => error instanceof BridgeError && error.status === 503 && error.code === "TEST_OUTAGE",
  );

  const { api } = apiWith([{ data: [canonicalProduct({ familyId: "test_other_family" })], nextCursor: null }], { supplementState: {} });
  await assert.rejects(
    () => enrichGrowDeskFeedingRecords(api, "test_token", babyId, [feeding("test_row", productId)]),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_SCOPE_MISMATCH",
  );
});

test("feeding GET returns the embedded formulaProduct for both the list and detail path", async (t) => {
  const previous = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = previous;
  });

  const product = canonicalProduct();
  const rawRecord = feeding("test_route_record", productId);
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/auth/bff/session")) {
      return Response.json({ data: { accessToken: "test_token", user: { id: "test_user" } } });
    }
    if (url.pathname.endsWith("/records/feeding")) {
      return Response.json({ data: [rawRecord], page: { nextCursor: null } });
    }
    if (url.pathname.endsWith("/records/feeding/test_route_record")) {
      return Response.json({ data: rawRecord });
    }
    if (url.pathname.endsWith("/food-plan")) {
      return Response.json({ data: { babyId, planData: { supplementState: { defaultFormulaId: productId } }, updatedAt: "2026-09-19T00:00:00.000Z" } });
    }
    if (url.pathname.endsWith("/nutrition/products")) {
      return Response.json({ data: [product], page: { nextCursor: null } });
    }
    throw new Error(`unexpected upstream request: ${url}`);
  });

  const cookie = `${GROWDESK_CONFIG.cookieName}=${"a".repeat(64)}`;
  const listResponse = await feedingGet(new Request(`https://test.invalid/api/records/feeding?babyId=${babyId}`, { headers: { cookie } }));
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json() as Array<Record<string, any>>;
  assert.equal(list[0]?.formulaProduct?.id, productId);

  const detailResponse = await feedingGet(new Request(`https://test.invalid/api/records/feeding?babyId=${babyId}&id=${rawRecord.id}`, { headers: { cookie } }));
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json() as Record<string, any>;
  assert.equal(detail.formulaProduct?.id, productId);
  assert.equal(seen.filter((entry) => entry.includes("/nutrition/products")).length, 2);
});
