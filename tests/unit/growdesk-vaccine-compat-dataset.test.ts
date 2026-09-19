import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadFullVaccineKnowledge } from "../../lib/growdesk/vaccine-compat";

type VaccineSource = {
  id: string;
  catchUp?: { supported?: boolean; rules?: string[]; sourceRefs?: string[] };
  product?: Record<string, unknown> | null;
  doses?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
type OptionalTimelineItem = Record<string, unknown> & {
  vaccineId?: string;
  doseNumber?: number;
};

const source = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "data", "02_vaccines.json"), "utf8"),
) as { vaccines: VaccineSource[]; optionalVaccineTimeline: Array<{ ageMonths?: number | null; items?: OptionalTimelineItem[] }> };

test("vaccine compatibility preserves every legacy-seeded source field", () => {
  const knowledge = loadFullVaccineKnowledge("CN-JS");
  const byId = new Map<string, Record<string, any>>(
    knowledge.vaccines.map((v: Record<string, any>) => [v.vaccineId, v]),
  );

  assert.equal(knowledge.vaccines.length, source.vaccines.length);

  for (const expected of source.vaccines) {
    const actual = byId.get(expected.id);
    if (!actual) throw new Error(`missing vaccine ${expected.id}`);

    assert.deepEqual(actual.catchUp, expected.catchUp ?? null, `${expected.id}: nested catchUp`);
    assert.equal(actual.catchUpSupported, expected.catchUp?.supported ?? false, `${expected.id}: catchUpSupported`);
    assert.deepEqual(actual.catchUpRules, expected.catchUp?.rules ?? [], `${expected.id}: catchUpRules`);
    assert.equal(actual.targetPopulation, expected.targetPopulation ?? null, `${expected.id}: targetPopulation`);
    assert.equal(actual.policyEffectiveDate, expected.policyEffectiveDate ?? null, `${expected.id}: policyEffectiveDate`);
    assert.equal(actual.policyVersion, expected.policyVersion ?? null, `${expected.id}: policyVersion`);
    assert.equal(actual.routineHealthyChildOption, expected.routineHealthyChildOption ?? true, `${expected.id}: routineHealthyChildOption`);
    assert.equal(actual.manualReviewRequired, expected.manualReviewRequired ?? false, `${expected.id}: manualReviewRequired`);
    assert.equal(actual.marketStatus, expected.marketStatus ?? null, `${expected.id}: marketStatus`);
    assert.deepEqual(actual.product, expected.product ?? null, `${expected.id}: product`);
    assert.equal(actual.productBrandName, expected.product?.brandName ?? null, `${expected.id}: productBrandName`);
    assert.equal(actual.productManufacturer, expected.product?.manufacturer ?? null, `${expected.id}: productManufacturer`);
    assert.equal(actual.productApprovalNumber, expected.product?.approvalNumber ?? null, `${expected.id}: productApprovalNumber`);
    assert.equal(actual.jiangsuNotes, expected.jiangsuNotes ?? null, `${expected.id}: jiangsuNotes`);
    assert.equal(actual.suzhouNotes, expected.suzhouNotes ?? null, `${expected.id}: suzhouNotes`);
    assert.equal(actual.simultaneousVaccination, expected.simultaneousVaccination ?? null, `${expected.id}: simultaneousVaccination`);
    assert.deepEqual(actual.sourceRefsJson, expected.sourceRefs ?? [], `${expected.id}: sourceRefsJson`);

    const actualDoses = new Map<number, Record<string, any>>(
      ((actual.doses ?? []) as Record<string, any>[]).map((dose) => [dose.doseNumber, dose]),
    );
    for (const expectedDose of expected.doses ?? []) {
      const expectedDoseNumber = expectedDose.doseNumber as number;
      const actualDose = actualDoses.get(expectedDoseNumber);
      if (!actualDose) throw new Error(`${expected.id}: missing dose ${String(expectedDoseNumber)}`);
      for (const field of [
        "doseLabel",
        "recommendedAgeMonths",
        "minimumAgeDays",
        "maximumAgeDays",
        "recommendedAgeMaxMonths",
        "minimumIntervalDaysFromPrevious",
        "maximumIntervalDaysFromPrevious",
        "route",
        "site",
        "doseVolumeMl",
        "notes",
      ]) {
        assert.deepEqual(actualDose[field], expectedDose[field] ?? null, `${expected.id} dose ${String(expectedDoseNumber)}: ${field}`);
      }
      assert.deepEqual(actualDose.sourceRefsJson, expectedDose.sourceRefs ?? [], `${expected.id} dose ${String(expectedDoseNumber)}: sourceRefsJson`);
      assert.deepEqual(actualDose.sourceRefs, expectedDose.sourceRefs ?? [], `${expected.id} dose ${String(expectedDoseNumber)}: sourceRefs`);
    }
  }
});

test("vaccine compatibility keeps source dose numbers in optional timeline", () => {
  const knowledge = loadFullVaccineKnowledge("CN-JS");
  const expected = source.optionalVaccineTimeline
    .flatMap((entry) => (entry.items ?? []).map((item) => ({ ...item, ageMonths: entry.ageMonths ?? null })))
    .find((item) => item.vaccineId === "vac_dtap_ipv_hib_pentaxim" && item.ageMonths === 18);
  const actual = knowledge.schedule.find(
    (entry: any) => entry.vaccineId === expected?.vaccineId && entry.ageMonths === expected?.ageMonths && entry.isOptional,
  );

  assert.equal(expected?.doseNumber, 4);
  assert.equal(actual?.doseNumber, expected?.doseNumber);
});
