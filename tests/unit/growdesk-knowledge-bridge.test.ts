import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  projectLegacyKnowledgeItem,
  sortLegacyMilestones,
} from "../../lib/growdesk/knowledge-bridge";

function readDataset<T>(fileName: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", fileName), "utf8")) as T;
}

test("knowledge bridge preserves canonical details and restores activity JSON columns", () => {
  const projected = projectLegacyKnowledgeItem("activities", {
    id: "wrapper-id",
    details: {
      id: "act_face_talk",
      activityId: "act_face_talk",
      title: "面对面说话与回应",
      categories: ["language", "social_emotional"],
      ageMinMonths: 0,
      ageMaxMonths: 3,
      developmentGoals: ["建立轮流互动"],
      materials: [],
      steps: [{ order: 1, instruction: "说话并等待回应" }],
      safety: ["保持清醒时进行"],
      stopConditions: ["疲倦时停止"],
      sourceRefs: ["src_nhc_care_2022"],
      canonicalOnly: { evidence: "preserve" },
    },
  });

  assert.equal(projected.id, "act_face_talk");
  assert.deepEqual(JSON.parse(String(projected.categoriesJson)), projected.categories);
  assert.deepEqual(JSON.parse(String(projected.developmentGoalsJson)), projected.developmentGoals);
  assert.deepEqual(JSON.parse(String(projected.materialsJson)), projected.materials);
  assert.deepEqual(JSON.parse(String(projected.stepsJson)), projected.steps);
  assert.deepEqual(JSON.parse(String(projected.safetyJson)), projected.safety);
  assert.deepEqual(JSON.parse(String(projected.stopConditionsJson)), projected.stopConditions);
  assert.deepEqual(JSON.parse(String(projected.sourceRefsJson)), projected.sourceRefs);
  assert.deepEqual(projected.canonicalOnly, { evidence: "preserve" });
  assert.equal(projected.targetMonthMin, 0);
  assert.equal(projected.targetMonthMax, 3);
  assert.equal(projected.goal, null);
  assert.equal(projected.medicalTreatment, false);
});

test("knowledge bridge restores warning-sign and feeding-guideline JSON columns", () => {
  const warning = projectLegacyKnowledgeItem("warning-signs", {
    id: "rf_3m_01",
    ageMonths: 3,
    monthAge: 3,
    description: "对较大声音没有反应",
    recommendedAction: "咨询专业人员",
    signText: "对较大声音没有反应",
    actionAdvice: "咨询专业人员",
    sourceRefs: ["src_warning"],
  });
  assert.equal(warning.warningSignId, "rf_3m_01");
  assert.equal(warning.monthAge, 3);
  assert.equal(warning.signText, "对较大声音没有反应");
  assert.equal(warning.actionAdvice, "咨询专业人员");
  assert.equal(warning.description, "对较大声音没有反应");
  assert.equal(warning.recommendedAction, "咨询专业人员");
  assert.equal(warning.sourceRefsJson, '["src_warning"]');

  const guideline = projectLegacyKnowledgeItem("feeding-guidelines", {
    id: "feeding-guideline-0",
    ageMinMonths: 6,
    ageMaxMonths: 8,
    texture: ["泥糊"],
    foodDiversity: ["富铁食物"],
    responsiveFeeding: ["不强迫"],
    safety: ["持续看护"],
    sourceRefs: ["src_food"],
  });
  assert.equal(guideline.textureJson, '["泥糊"]');
  assert.equal(guideline.foodDiversityJson, '["富铁食物"]');
  assert.equal(guideline.responsiveFeedingJson, '["不强迫"]');
  assert.equal(guideline.safetyJson, '["持续看护"]');
  assert.equal(guideline.sourceRefsJson, '["src_food"]');
  assert.deepEqual(guideline.texture, ["泥糊"]);
});

test("knowledge bridge restores milestone flattened fields and assessment ordering", () => {
  const projected = projectLegacyKnowledgeItem("milestones", {
    id: "mil_so_2m_looks_face",
    monthAge: 2,
    ageRange: { earliestMonth: null, medianMonth: 2, latestMonth: 4 },
    criterion: { type: "by_age", threshold: "约75%", description: "多数儿童" },
    sourceRefs: ["src_cdc"],
  });
  assert.equal(projected.milestoneId, "mil_so_2m_looks_face");
  assert.equal(projected.assessmentAgeMonths, 2);
  assert.equal(projected.ageRangeMedianMonth, 2);
  assert.equal(projected.criterionType, "by_age");
  assert.equal(projected.criterionThreshold, "约75%");
  assert.equal(projected.criterionDescription, "多数儿童");
  assert.equal(projected.sourceRefsJson, '["src_cdc"]');

  const ordered = sortLegacyMilestones([
    { id: "late", assessmentAgeMonths: 4 },
    { id: "early-a", assessmentAgeMonths: 2 },
    { id: "early-b", assessmentAgeMonths: 2 },
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ["early-a", "early-b", "late"]);
});

test("knowledge bridge keeps the legacy reference datasets lossless", () => {
  const milestones = readDataset<{ milestones: Array<Record<string, any>> }>("03_milestones.json").milestones;
  const activities = readDataset<{ activities: Array<Record<string, any>> }>("06_activities.json").activities;
  const milestoneData = readDataset<{ developmentRedFlags: Array<Record<string, any>> }>("03_milestones.json");
  const guidelines = readDataset<{ feedingGuidelines: Array<Record<string, any>> }>("04_foods.json").feedingGuidelines;

  for (const expected of activities) {
    const actual = projectLegacyKnowledgeItem("activities", expected);
    for (const field of ["categories", "developmentGoals", "materials", "steps", "safety", "stopConditions", "sourceRefs"]) {
      assert.deepEqual(JSON.parse(String(actual[`${field}Json`])), expected[field] ?? [], `activity ${expected.id}: ${field}`);
    }
  }

  for (const expected of milestoneData.developmentRedFlags) {
    const actual = projectLegacyKnowledgeItem("warning-signs", expected);
    assert.deepEqual(JSON.parse(String(actual.sourceRefsJson)), expected.sourceRefs ?? [], `warning ${expected.id}: sourceRefs`);
    assert.equal(actual.warningSignId, expected.id);
    assert.equal(actual.ageMonths, expected.ageMonths);
  }

  for (const expected of guidelines) {
    const actual = projectLegacyKnowledgeItem("feeding-guidelines", expected);
    for (const field of ["texture", "foodDiversity", "responsiveFeeding", "safety", "sourceRefs"]) {
      assert.deepEqual(JSON.parse(String(actual[`${field}Json`])), expected[field] ?? [], `guideline ${expected.ageMinMonths}: ${field}`);
    }
  }

  const projectedMilestones = sortLegacyMilestones(
    milestones.map((item) => projectLegacyKnowledgeItem("milestones", item)),
  );
  assert.equal(projectedMilestones.length, milestones.length);
  assert.ok(projectedMilestones.every((item, index) => {
    if (index === 0) return true;
    return Number(item.assessmentAgeMonths) >= Number(projectedMilestones[index - 1].assessmentAgeMonths);
  }));
});
