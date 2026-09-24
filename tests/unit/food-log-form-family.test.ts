import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveFoodFormFamilyId } from "../../components/records/FoodLogForm";

test("FoodLogForm resolves only the selected baby's authorized family", () => {
  const baby = { id: "test_baby_b", familyId: "test_family_b" };
  assert.equal(resolveFoodFormFamilyId({
    selectedBabyId: baby.id,
    baby,
    family: { id: "test_family_a" },
    families: [{ id: "test_family_a" }, { id: "test_family_b" }],
  }), "test_family_b");
  assert.equal(resolveFoodFormFamilyId({
    selectedBabyId: baby.id,
    baby,
    family: { id: "test_family_a" },
    families: [{ id: "test_family_a" }],
  }), null);
  assert.equal(resolveFoodFormFamilyId({
    selectedBabyId: "test_baby_a",
    baby,
    family: { id: "test_family_b" },
    families: [{ id: "test_family_b" }],
  }), null);
});

test("FoodLogForm exposes loading, disabled custom add, failure, and retry states", () => {
  const source = readFileSync(new URL("../../components/records/FoodLogForm.tsx", import.meta.url), "utf8");
  assert.match(source, /disabled=\{familyLoading \|\| !familyId\}/);
  assert.match(source, /加载家庭\.\.\./);
  assert.match(source, /未能加载当前宝宝所属家庭，请重试/);
  assert.match(source, /setFamilyRetry\(\(value\) => value \+ 1\)/);
});
