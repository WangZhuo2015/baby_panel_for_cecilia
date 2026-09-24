import test from "node:test";
import assert from "node:assert/strict";
import { BridgeError, type BridgeFetch, type BridgeResult } from "../../lib/growdesk/bridge-protocol";
import { fetchNativeTimelineSupplementProducts } from "../../lib/growdesk/native-timeline-products";
import { fromGrowDeskTimelineEntry } from "../../lib/growdesk/timeline-compat";

const familyId = "test_family_catalog";
const accessToken = "test_catalog_token";
function api(implementation: (path: string) => BridgeResult<unknown>): BridgeFetch {
  return async <T>(path: string, options?: Parameters<BridgeFetch>[1]) => {
    assert.equal(options?.accessToken, accessToken);
    return implementation(path) as BridgeResult<T>;
  };
}
const product = { id: "test_product_old", familyId, name: "test archived vitamin", unitName: "滴", defaultDose: "9.0", isArchived: true, isActive: false };

test("native timeline exhausts canonical catalog including archived products without reading food-plan", async () => {
  const calls: string[] = [];
  const fetcher = api(path => {
    calls.push(path);
    const url = new URL(path, "https://test.invalid");
    assert.equal(url.pathname, `/api/v1/families/${familyId}/nutrition/supplement-products`);
    assert.equal(url.searchParams.get("includeArchived"), "true");
    assert.equal(url.searchParams.get("limit"), "100");
    return url.searchParams.has("cursor")
      ? { ok: true, status: 200, data: [product], page: { nextCursor: null } }
      : { ok: true, status: 200, data: [{ ...product, id: "test_product_new", isArchived: false }], page: { nextCursor: "test_cursor" } };
  });
  const map = await fetchNativeTimelineSupplementProducts(fetcher, accessToken, familyId);
  assert.equal(calls.length, 2);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get(product.id), product);
  assert.notEqual(map.get(product.id), product, "do not mutate a shared catalog response");
});

test("native supplement timeline retains original dose and explicit product ID", async () => {
  const products = await fetchNativeTimelineSupplementProducts(api(() => ({ ok: true, status: 200, data: [product], page: { nextCursor: null } })), accessToken, familyId);
  const item = fromGrowDeskTimelineEntry({
    id: "test_projection", babyId: "test_baby_catalog", entityId: "test_record_catalog", entityType: "supplement",
    version: "3", occurredAt: "2026-01-02T01:00:00.000Z", summary: "test supplement",
  }, { supplementProducts: products, supplements: new Map([["test_record_catalog", {
    id: "test_record_catalog", babyId: "test_baby_catalog", productId: product.id,
    supplementName: "test historical vitamin", dose: "1.5", unitName: "滴", notes: null, version: "3",
  }]]) });
  assert.equal(item.rawRecord.productId, product.id);
  assert.equal(item.rawRecord.productName, "test historical vitamin");
  assert.equal(item.rawRecord.dose, 1.5, "must not replace historical dose with current defaultDose");
  assert.equal(item.rawRecord.version, "3");
});

test("canonical product scope, identity and pagination errors fail closed", async () => {
  const invalidLists = [
    [null], ["invalid"], [{ ...product, familyId: "test_other_family" }],
    [{ ...product, id: "../invalid" }], [{ ...product, name: "" }], [product, product],
  ];
  for (const data of invalidLists) {
    await assert.rejects(fetchNativeTimelineSupplementProducts(api(() => ({ ok: true, status: 200, data, page: { nextCursor: null } })), accessToken, familyId),
      (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_INVALID_RECORD");
  }
  await assert.rejects(fetchNativeTimelineSupplementProducts(api(() => ({ ok: true, status: 200, data: [] })), accessToken, familyId),
    (error: unknown) => error instanceof BridgeError && error.code === "UPSTREAM_INVALID_PAGE");
});

test("catalog errors do not fall back to stale food-plan or empty success", async () => {
  for (const status of [401, 403, 404, 429, 503]) {
    let calls = 0;
    await assert.rejects(fetchNativeTimelineSupplementProducts(api(() => {
      calls += 1;
      return { ok: false, status, error: { code: "TEST_CATALOG_FAILURE", message: "test" } };
    }), accessToken, familyId), (error: unknown) => error instanceof BridgeError && error.status === status && error.code === "TEST_CATALOG_FAILURE");
    assert.equal(calls, 1);
  }
});
