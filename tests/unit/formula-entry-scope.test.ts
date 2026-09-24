import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScopedNutritionRequest, NutritionScopeChanged, type NutritionClientScope } from "../../lib/nutrition/scoped-request";

const scope: NutritionClientScope = { userId: "test_reader", familyId: "test_second_family", babyId: "test_second_baby" };
const source = (path: string) => readFileSync(path, "utf8");

test("retained formula forms use the current scoped client rather than a competing implementation", () => {
  assert.match(source("lib/hooks/useNutritionFetch.ts"), /export \{ useScopedNutritionRequest as useNutritionFetch \} from "\.\/useScopedNutritionRequest"/);
  for (const path of ["components/records/FeedingFormFields.tsx", "components/nutrition/QuickFormulaManageModalContent.tsx"]) {
    const content = source(path);
    assert.match(content, /useNutritionFetch/);
    assert.doesNotMatch(content, /\bfetch\s*\(/, "every catalog operation must use the captured identity");
  }
  assert.match(source("components/records/FeedingForm.tsx"), /useNutritionScopeKey\(props\.initialData\?\.babyId\)/);
  assert.match(source("components/records/FeedingForm.tsx"), /key=\{scopeKey\}/);
  assert.match(source("components/nutrition/QuickFormulaManageModal.tsx"), /key=\{`\$\{scopeKey\}:\$\{props\.isOpen\}`\}/);
  assert.match(source("components/records/FeedingFormFields.tsx"), /<QuickFormulaManageModal\s+babyId=\{initialData\?\.babyId\}/);
});

test("formula list, default, preset, custom and archive operations retain the explicitly selected second family", async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetchApi: typeof fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input), "https://test.invalid"), init });
    return Response.json({ id: "test_formula", formulas: [] });
  };
  const client = createScopedNutritionRequest(scope, () => scope, fetchApi);
  const requests: [string, RequestInit][] = [
    ["/api/nutrition/products?type=formula&includeInactive=true", {}],
    ["/api/nutrition/products", { method: "PUT", body: JSON.stringify({ id: "test_formula", type: "formula", isDefault: true, isActive: true }) }],
    ["/api/nutrition/products", { method: "POST", body: JSON.stringify({ type: "formula", name: "test_preset" }) }],
    ["/api/nutrition/products", { method: "POST", body: JSON.stringify({ type: "formula", name: "test_custom" }) }],
    ["/api/nutrition/products?id=test_formula&type=formula", { method: "DELETE" }],
  ];
  for (const [path, options] of requests) await (await client.request(path, options)).json();
  assert.equal(calls.length, 5);
  for (const { url, init } of calls) {
    assert.equal(url.searchParams.get("babyId"), scope.babyId);
    assert.equal(url.searchParams.get("familyId"), scope.familyId);
    assert.equal(new Headers(init.headers).get("x-growdesk-expected-user"), scope.userId);
    assert.equal(init.redirect, "error");
    if (typeof init.body === "string") {
      const body = JSON.parse(init.body);
      assert.equal(body.babyId, scope.babyId);
      assert.equal(body.familyId, scope.familyId);
    }
  }
  client.dispose();
});

test("an old formula manager cannot write after a baby switch or consume its late catalog response", async () => {
  let active = scope;
  let release!: (value: Response) => void;
  let calls = 0;
  const fetchApi: typeof fetch = () => {
    calls += 1;
    return new Promise<Response>(resolve => { release = resolve; });
  };
  const client = createScopedNutritionRequest(scope, () => active, fetchApi);
  const pending = client.request("/api/nutrition/products?type=formula");
  active = { ...scope, babyId: "test_other_baby" };
  release(Response.json({ formulas: [{ id: "test_private_formula" }] }));
  await assert.rejects(pending, NutritionScopeChanged);
  await assert.rejects(client.request("/api/nutrition/products", {
    method: "PUT", body: JSON.stringify({ id: "test_private_formula", type: "formula", isDefault: true }),
  }), NutritionScopeChanged);
  assert.equal(calls, 1);
  client.dispose();
});
