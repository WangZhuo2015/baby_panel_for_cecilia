import test from "node:test";
import assert from "node:assert/strict";
import { createScopedNutritionRequest, NutritionScopeChanged } from "../../lib/nutrition/scoped-request";

const identity = { userId: "test_user", familyId: "test_family", babyId: "test_baby" };

test("multipart writes reject mismatched and repeated foreign scope values before fetch", async () => {
  let calls = 0;
  const client = createScopedNutritionRequest(identity, () => identity, async () => {
    calls++;
    return Response.json({ success: true });
  });
  try {
    for (const field of ["babyId", "familyId"] as const) {
      const body = new FormData();
      body.append(field, identity[field]);
      body.append(field, "test_foreign");
      await assert.rejects(client.request("/api/ai/parse-nutrition", { method: "POST", body }), NutritionScopeChanged);
    }
    assert.equal(calls, 0);
  } finally { client.dispose(); }
});

test("multipart scope is copied without mutating the caller's form and redirects are forbidden", async () => {
  const body = new FormData();
  body.append("name", "test_product");
  body.append("babyId", identity.babyId);
  const client = createScopedNutritionRequest(identity, () => identity, async (_input, init) => {
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof FormData);
    assert.notEqual(init.body, body);
    assert.equal(init.body.get("familyId"), identity.familyId);
    assert.equal(init.body.get("babyId"), identity.babyId);
    assert.equal(new Headers(init.headers).get("x-growdesk-expected-user"), identity.userId);
    return Response.json({ success: true });
  });
  try {
    await client.request("/api/ai/parse-nutrition", { method: "POST", body });
    assert.equal(body.has("familyId"), false);
  } finally { client.dispose(); }
});

test("an old response cannot be consumed after an A-B-A epoch transition", async () => {
  let finish!: (response: Response) => void;
  const client = createScopedNutritionRequest(identity, () => identity, async () => new Promise<Response>(resolve => { finish = resolve; }));
  const pending = client.request("/api/nutrition/products");
  client.dispose();
  client.activate();
  finish(Response.json({ formulas: [{ id: "test_stale" }] }));
  await assert.rejects(pending, NutritionScopeChanged);
  client.dispose();
});
