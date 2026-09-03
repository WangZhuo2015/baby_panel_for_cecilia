import assert from "node:assert/strict";
import test from "node:test";
import {
  RELATION_WHITELIST,
  RELATION_LABELS,
  RELATION_SELECTOR_OPTIONS,
  normalizeRelation,
} from "../../lib/constants";
import { TOUR_FEATURES } from "../../components/ui/FeatureTourCards";
import { GET as previewGetHandler } from "../../app/api/family/preview/route";

test("Family Guide & Onboarding: Relation whitelist supports specific grandparents", () => {
  // 爷爷、奶奶、姥姥、姥爷
  assert.ok(RELATION_WHITELIST.includes("grandfather"), "Must support grandfather");
  assert.ok(RELATION_WHITELIST.includes("grandmother"), "Must support grandmother");
  assert.ok(RELATION_WHITELIST.includes("maternal_grandfather"), "Must support maternal_grandfather (姥爷)");
  assert.ok(RELATION_WHITELIST.includes("maternal_grandmother"), "Must support maternal_grandmother (姥姥)");
  assert.ok(RELATION_WHITELIST.includes("mother"), "Must support mother");
  assert.ok(RELATION_WHITELIST.includes("father"), "Must support father");
  assert.ok(RELATION_WHITELIST.includes("caregiver"), "Must support caregiver");

  // 验证选择器列表中没有统称的"长辈"，而是爷爷奶奶姥姥姥爷
  const optionIds = RELATION_SELECTOR_OPTIONS.map((o) => o.id);
  assert.equal(optionIds.includes("grandparent" as any), false, "Selector options must NOT contain generic grandparent");
  assert.ok(optionIds.includes("grandfather"), "Selector options must contain grandfather");
  assert.ok(optionIds.includes("grandmother"), "Selector options must contain grandmother");
  assert.ok(optionIds.includes("maternal_grandmother"), "Selector options must contain 姥姥");
  assert.ok(optionIds.includes("maternal_grandfather"), "Selector options must contain 姥爷");

  // 验证映射
  assert.equal(RELATION_LABELS["grandfather"], "爷爷");
  assert.equal(RELATION_LABELS["grandmother"], "奶奶");
  assert.equal(RELATION_LABELS["maternal_grandmother"], "姥姥");
  assert.equal(RELATION_LABELS["maternal_grandfather"], "姥爷");

  // 归一化测试
  assert.equal(normalizeRelation("grandfather"), "grandfather");
  assert.equal(normalizeRelation("maternal_grandmother"), "maternal_grandmother");
  assert.equal(normalizeRelation("unknown_role"), "parent");
});

test("Family Guide & Onboarding: TOUR_FEATURES covers the 4 pillars of the product", () => {
  assert.equal(TOUR_FEATURES.length, 4, "Must provide 4 feature tour slides");
  const featureIds = TOUR_FEATURES.map((f) => f.id);
  assert.ok(featureIds.includes("daily_records"), "Must cover daily records");
  assert.ok(featureIds.includes("who_growth"), "Must cover WHO growth");
  assert.ok(featureIds.includes("food_nutrition"), "Must cover food and DRIs nutrition");
  assert.ok(featureIds.includes("vaccines_ai"), "Must cover vaccines and AI hub");

  for (const feat of TOUR_FEATURES) {
    assert.ok(feat.title && feat.title.length > 0, "Slide must have title");
    assert.ok(feat.points && feat.points.length >= 2, "Slide must have feature points");
  }
});

test("Family Guide & Onboarding: Preview API Route exports GET handler", () => {
  assert.equal(typeof previewGetHandler, "function", "GET handler must be exported");
});
