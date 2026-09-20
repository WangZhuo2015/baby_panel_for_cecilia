import assert from "node:assert/strict";
import test from "node:test";
import {
  loadFullVaccineKnowledge,
  projectLegacyVaccineKnowledge,
  projectLegacyVaccineSelections,
} from "../../lib/growdesk/vaccine-compat";
import {
  legacyDataReleaseId,
  legacyFixtureSiblingId,
  legacyReferenceId,
  legacyScheduleEngineRuleId,
  legacyVaccineId,
} from "../../lib/growdesk/knowledge-legacy-id";

test("legacy vaccine catalogue is projected from source order with the old DTO keys", () => {
  const full = loadFullVaccineKnowledge("CN-JS");
  const legacy = projectLegacyVaccineKnowledge(full, "CN-JS");

  assert.deepEqual(Object.keys(legacy), [
    "national",
    "nonProgram",
    "provincial",
    "strategyGroups",
    "schedule",
    "engineRules",
    "dataRelease",
  ]);
  assert.equal(legacy.national.length, 13);
  assert.equal(legacy.nonProgram.length, 19);
  assert.equal(legacy.provincial.length, 1);
  assert.equal(legacy.schedule.length, 51);
  assert.equal(legacy.engineRules.length, 8);
  assert.equal(legacy.national[0].id, legacyVaccineId({ id: "vac_hepb" }));
  assert.equal((legacy.national[0].doses as Array<Record<string, unknown>>)[0].vaccineId, legacy.national[0].id);
  assert.equal(legacy.strategyGroups[0].id, legacyReferenceId("VaccineStrategyGroup", 0));
  assert.equal(legacy.engineRules[0].id, legacyScheduleEngineRuleId({ id: "rule_rotavirus_exclusive" }));
  assert.equal(legacy.schedule[0].id, legacyReferenceId("VaccineScheduleEntry", 24));
  assert.equal(legacy.schedule[0].ageMonths, null);
  assert.equal(legacy.schedule[0].ageDays, 42);
  assert.equal(legacy.dataRelease.id, legacyDataReleaseId());
  assert.equal(legacy.dataRelease.sources.length, 59);
  assert.equal("vaccines" in legacy, false);
});

test("legacy vaccine selections retain only saved rows and derive fixture identity from the canonical record", () => {
  const babyId = "a0000000-0000-4000-8000-000000000004";
  const recordId = "a0000000-0000-4000-8000-000000000505";
  const timestamp = "test_fixture_timestamp";
  const result = projectLegacyVaccineSelections([
    {
      id: recordId,
      babyId,
      familyId: "test_family",
      vaccineCode: "vac_hepb",
      administeredDate: "test_date",
      clinic: null,
      batchNumber: null,
      notes: "第1剂",
      version: "1",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ], {
    "vac_hepb-1": { selected: true, completed: true },
  }, babyId);

  assert.deepEqual(result, [{
    id: legacyFixtureSiblingId(recordId, 1),
    babyId,
    vaccineId: "vac_hepb",
    doseNumber: 1,
    selected: true,
    completed: true,
    updatedAt: timestamp,
  }]);
  assert.equal("recordId" in result[0], false);
});
