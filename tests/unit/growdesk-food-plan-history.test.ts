import test from "node:test";
import assert from "node:assert/strict";
import { appendRecipe, createRecipe, listRecipes, readPlanEnvelope } from "../../lib/growdesk/food-plan-history";

const babyId = "test_baby_recipes";
const stamp = "2026-09-17T00:00:00.000Z";
function initial() {
  return readPlanEnvelope({ id: "test_original", babyId, createdAt: stamp, updatedAt: stamp, version: "3", planData: {
    date: "2026-09-17", name: "test_original_recipe", tags: [], ingredients: [], steps: [], nutrition: "test_nutrition",
    supplementState: { defaultFormulaId: "test_formula" }, vaccineSelections: { test_vaccine: true },
  } }, babyId);
}
test("recipe history preserves multiple dates and same-day rows with real stable identities", () => {
  let plan = initial();
  const recipes = ["2026-09-18", "2026-09-18"].map((date, i) => createRecipe({ date, name: `test_recipe_${i}` }, babyId));
  for (const recipe of recipes) plan = { ...plan, planData: appendRecipe(plan, recipe) };
  const all = listRecipes(plan, new URLSearchParams());
  assert.deepEqual(all.map(r => r.id), [recipes[0].id, recipes[1].id, "test_original"]);
  assert.equal(all[2].createdAt, stamp);
  assert.equal(listRecipes(plan, new URLSearchParams({ date: "2026-09-18" })).length, 2);
  assert.deepEqual(plan.planData.supplementState, initial().planData.supplementState);
  assert.deepEqual(plan.planData.vaccineSelections, initial().planData.vaccineSelections);
  assert.equal("supplementState" in all[2], false);
  assert.equal("vaccineSelections" in all[2], false);
});
test("recipe append validates input and never adopts client-supplied identity or shared state", () => {
  const recipe = createRecipe({ name: "test_new", id: "spoofed", babyId: "other", supplementState: {} }, babyId);
  assert.notEqual(recipe.id, "spoofed"); assert.equal(recipe.babyId, babyId);
  assert.equal("supplementState" in recipe, false);
  assert.throws(() => createRecipe({ name: "test_new", date: "2026-02-30" }, babyId), /有效/);
  assert.throws(() => createRecipe({ name: "test_new", tags: [123] }, babyId), /tags/);
  assert.throws(() => listRecipes(initial(), new URLSearchParams({ date: "invalid" })), /Invalid date/);
  assert.throws(() => readPlanEnvelope({ ...initial(), babyId: "other" }, babyId), (error: any) => error.code === "UPSTREAM_SCOPE_MISMATCH" && error.status === 502);
});
test("first recipe uses empty version-zero state; missing upstream version fails closed", () => {
  const empty = readPlanEnvelope({ id: null, createdAt: null, updatedAt: stamp, babyId, version: "0", planData: {} }, babyId);
  const recipe = createRecipe({ name: "test_first" }, babyId);
  assert.deepEqual(listRecipes({ ...empty, planData: appendRecipe(empty, recipe) }, new URLSearchParams()), [recipe]);
  assert.throws(() => readPlanEnvelope({ id: null, createdAt: null, babyId, planData: {} }, babyId));
});
