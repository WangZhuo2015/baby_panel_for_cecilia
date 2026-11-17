import assert from "node:assert/strict";
import test from "node:test";
import {
  matchVaccineProduct,
  parseVaccineRecordInput,
  projectVaccineLedgerRecord,
  vaccineDoseNumber,
} from "../../lib/vaccine-records";
import { buildVaccineSelections, fromGrowDeskVaccineRecord, toGrowDeskVaccineRecordPayload, type GrowDeskVaccineRecord } from "../../lib/growdesk/vaccine-compat";

test("unknown booklet entries preserve their source without inventing a date or first dose", () => {
  const record = parseVaccineRecordInput({ name: "test_手写记录", recordStatus: "needs_review", sourceText: "手写日期为 6.8，无法确认年份和用途" }, "2030-01-01");
  assert.equal(record.doseNumber, null);
  assert.equal(record.administeredDate, null);
  assert.equal(record.scheduledDate, null);
  assert.equal(record.completedDate, null);
  assert.equal(record.isCompleted, false);
  assert.equal(record.sourceText, "手写日期为 6.8，无法确认年份和用途");
  assert.equal(vaccineDoseNumber("批号 TEST-1234"), null);
  assert.equal(vaccineDoseNumber(""), null);
  assert.equal(vaccineDoseNumber("第 3 剂"), 3);
});

test("completed records need a real, nonfuture date; an appointment date is never used as actual", () => {
  assert.throws(() => parseVaccineRecordInput({ name: "test_疫苗", recordStatus: "completed", scheduledDate: "2024-06-10" }, "2024-07-01"), /实际接种日期/);
  assert.throws(() => parseVaccineRecordInput({ name: "test_疫苗", recordStatus: "completed", completedDate: "2024-07-02" }, "2024-07-01"), /不能晚于今天/);
  assert.throws(() => parseVaccineRecordInput({ name: "test_疫苗", recordStatus: "completed", completedDate: "2024-02-30" }, "2024-07-01"), /完整有效/);
  assert.throws(() => parseVaccineRecordInput({ name: "test_疫苗", recordStatus: "planned" }, "2024-07-01"), /预约日期/);
  assert.throws(() => parseVaccineRecordInput({ name: "test_疫苗", recordStatus: "planned", scheduledDate: "2024-07-15", completedDate: "2024-06-15" }, "2024-07-01"), /不能同时/);
  const planned = parseVaccineRecordInput({ name: "test_疫苗", isCompleted: false, scheduledDate: "2024-07-15" }, "2024-07-01");
  assert.equal(planned.recordStatus, "planned");
  assert.equal(planned.administeredDate, null);
});

test("booklet metadata and dose uncertainty survive normalization and the cloud round trip", () => {
  const payload = toGrowDeskVaccineRecordPayload({
    name: "test_目录外原文", recordStatus: "completed", completedDate: "2024-03-15", doseNumber: null,
    manufacturer: "test_厂商", clinic: "test_门诊", batchNumber: "TEST-LOT-008", traceCode: "00001234567890",
    administrationRoute: "口服", injectionSite: "不适用", sourceText: "test_本子原文", notes: "test_备注",
  });
  assert.equal(payload.doseNumber, null);
  assert.equal(payload.scheduledDate, null);
  assert.equal(payload.notes, "test_备注", "do not add synthetic dose labels to clinical notes");
  const record = fromGrowDeskVaccineRecord({ ...payload, id: "test_record", babyId: "test_baby", familyId: "test_family", version: "4", createdAt: "2024-03-16T00:00:00Z", updatedAt: "2024-03-16T00:00:00Z" });
  for (const key of ["manufacturer", "clinic", "batchNumber", "traceCode", "administrationRoute", "injectionSite", "sourceText", "notes"] as const) assert.equal(record[key], payload[key]);
  assert.equal(record.doseNumber, null);
  assert.equal(record.completedDate, "2024-03-15");
  assert.equal(record.version, "4");
  assert.equal(record.vaccineId, null, "a free-text code is not a product identity");
});

test("only explicit catalogue names and brands identify a product; family names remain unassigned", () => {
  const catalog = [
    { vaccineId: "vac_dtap_ipv_hib_pentaxim", name: "五联产品", shortName: null },
    { vaccineId: "vac_rotavirus5", name: "轮状产品", shortName: null },
    { vaccineId: "vac_pcv13_crm197", name: "PCV13甲产品", shortName: "PCV13-CRM197" },
    { vaccineId: "vac_pcv13_tt", name: "PCV13乙产品", shortName: "PCV13-TT" },
    { vaccineId: "vac_hib_acthib", name: "b型流感嗜血杆菌结合疫苗（安尔宝/Act-HIB）", shortName: "Hib" },
  ];
  assert.equal(matchVaccineProduct("PENTAXIM", catalog)?.vaccineId, "vac_dtap_ipv_hib_pentaxim");
  assert.equal(matchVaccineProduct("RotaTeq", catalog)?.vaccineId, "vac_rotavirus5");
  assert.equal(matchVaccineProduct("Act-HIB", catalog)?.vaccineId, "vac_hib_acthib");
  assert.equal(matchVaccineProduct("PCV13乙产品", catalog)?.vaccineId, "vac_pcv13_tt");
  for (const name of ["DTaP-IPV/Hib", "五联", "五价轮状", "Hib", "ACYW流脑（结合）"]) {
    assert.equal(matchVaccineProduct(name, catalog), null, `${name} must not silently select a brand`);
  }
  assert.equal(matchVaccineProduct("13价肺炎疫苗", catalog), null);
  assert.equal(matchVaccineProduct("test_完全无关疫苗", catalog), null, "empty shortName must not match every name");
  assert.equal(matchVaccineProduct("PCV13", catalog), null);
  const unassigned = toGrowDeskVaccineRecordPayload({ name: "PENTAXIM", vaccineId: null, recordStatus: "needs_review" });
  assert.equal(unassigned.vaccineCode, "PENTAXIM", "an explicit unassigned choice must survive the BFF");
  const reread = fromGrowDeskVaccineRecord({ ...unassigned, id: "test_unassigned", babyId: "test_baby", familyId: "test_family",
    version: "1", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" });
  assert.equal(reread.vaccineId, null, "reading a new ledger row must not reassign an explicitly unassigned product");
  const unlinkedCompleted = { ...unassigned, id: "test_unlinked_completed", babyId: "test_baby", familyId: "test_family",
    version: "1", createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z", recordStatus: "completed" as const,
    administeredDate: "2024-01-01", completedDate: "2024-01-01", isCompleted: true, doseNumber: 1 };
  const progress = buildVaccineSelections([unlinkedCompleted], undefined, { vaccines: [{ ...catalog[0], doses: [{ doseNumber: 1 }] }] });
  assert.equal(progress[0].completed, false, "a deliberately unlinked record must not claim a product-specific completion");
  const selected = toGrowDeskVaccineRecordPayload({ name: "test_原文", vaccineId: "vac_dtap_ipv_hib_pentaxim", recordStatus: "needs_review" });
  assert.equal(selected.vaccineId, "vac_dtap_ipv_hib_pentaxim", "explicit catalogue codes are valid canonical identities, not null");
});

test("progress comes only from completed records, and later plans or unknown doses cannot erase or manufacture completion", () => {
  const base: GrowDeskVaccineRecord = {
    id: "test_completed", babyId: "test_baby", familyId: "test_family", vaccineCode: "vac_test",
    doseNumber: 2, legacyDose: "第2剂", recordStatus: "completed", administeredDate: "2024-06-12", scheduledDate: null,
    completedDate: "2024-06-12", isCompleted: true, clinic: null, batchNumber: null, notes: null,
    version: "1", createdAt: "2024-06-12T00:00:00Z", updatedAt: "2024-06-12T00:00:00Z",
  };
  const catalog = { vaccines: [{ vaccineId: "vac_test", name: "test_疫苗", doses: [{ doseNumber: 1 }, { doseNumber: 2 }, { doseNumber: 3 }] }] };
  const selections = buildVaccineSelections([
    base,
    { ...base, id: "test_planned", recordStatus: "planned", isCompleted: false, administeredDate: null, completedDate: null, scheduledDate: "2030-01-01" },
    { ...base, id: "test_review", doseNumber: 1, recordStatus: "needs_review", isCompleted: false, administeredDate: null, completedDate: null },
    { ...base, id: "test_unknown_dose", doseNumber: null, legacyDose: "剂次待核对" },
  ], { "vac_test-1": { completed: true, selected: true }, "vac_test-2": { completed: false, selected: false } }, catalog);
  assert.equal(selections.find(row => row.doseNumber === 1)?.completed, false, "stale selection flags are not clinical records");
  assert.equal(selections.find(row => row.doseNumber === 2)?.completed, true);
  assert.equal(selections.find(row => row.doseNumber === 2)?.recordId, "test_completed");
  assert.equal(selections.find(row => row.doseNumber === 3)?.completed, false);
  const old = projectVaccineLedgerRecord({ id: "test_legacy", babyId: "test_baby", name: "test_疫苗", dose: "", isCompleted: true, completedDate: null, scheduledDate: "2024-06-12" });
  assert.equal(old.recordStatus, "needs_review");
  assert.equal(old.doseNumber, null);
  assert.equal(old.isCompleted, false);
  const historical = projectVaccineLedgerRecord({ id: "test_historical", babyId: "test_baby", name: "test_疫苗", dose: "第2剂", doseNumber: null,
    recordStatus: null, isCompleted: true, completedDate: "2024-06-12" });
  assert.equal(historical.doseNumber, 2, "an explicit historical ordinal survives the additive migration");
  assert.equal(historical.completedDate, "2024-06-12");
  const explicitlyUnknown = projectVaccineLedgerRecord({ id: "test_unknown", babyId: "test_baby", name: "test_疫苗", dose: "第2剂", doseNumber: null,
    recordStatus: "needs_review", isCompleted: false });
  assert.equal(explicitlyUnknown.doseNumber, null, "an explicit unknown ordinal is not replaced by unverified source text");
});
