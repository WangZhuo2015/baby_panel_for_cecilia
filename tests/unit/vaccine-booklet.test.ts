import assert from "node:assert/strict";
import test from "node:test";
import { vaccineRecordFields, parseDoseNumber } from "../../lib/growdesk/vaccine-record-fields";
import { completedVaccineFacts } from "../../lib/growdesk/vaccine-selection-facts";
import { fromGrowDeskVaccineRecord, toGrowDeskVaccineRecordPayload, toGrowDeskVaccineUpdatePayload, buildVaccineSelections, type GrowDeskVaccineRecord } from "../../lib/growdesk/vaccine-compat";

const record: GrowDeskVaccineRecord = {
  id: "test_record", babyId: "test_baby", familyId: "test_family", vaccineCode: "vac_test", vaccineId: "test_catalog_row",
  administeredDate: "2024-02-29", scheduledDate: null, completedDate: "2024-02-29", isCompleted: true,
  legacyName: "test_本上原名", legacyDose: null, doseNumber: null, clinic: "test_clinic", batchNumber: "test_batch",
  manufacturer: "test_manufacturer", productName: "test_product", traceabilityCode: "000012345678901234567890", injectionSite: "test_site",
  notes: "test_notes", version: "90071992547409999", createdAt: "2024-03-01T00:00:00Z", updatedAt: "2024-03-01T00:00:00Z",
};

test("historical booklet fields round trip without inventing a plan, dose, or date", () => {
  const view = fromGrowDeskVaccineRecord(record);
  assert.equal(view.scheduledDate, null);
  assert.equal(view.doseNumber, null);
  assert.equal(view.dose, null);
  assert.equal(view.completedDate, "2024-02-29");
  assert.equal(view.version, "90071992547409999");
  const edited = toGrowDeskVaccineUpdatePayload({ baseVersion: view.version, clinic: "test_corrected", batchNumber: null }, record);
  assert.equal("vaccineId" in edited, false);
  assert.equal("administeredDate" in edited, false);
  assert.equal("scheduledDate" in edited, false);
  assert.equal("doseNumber" in edited, false);
  assert.equal(edited.batchNumber, null);
  assert.deepEqual(Object.keys(edited).sort(), ["baseVersion", "batchNumber", "clinic"]);
  const roundTrip = toGrowDeskVaccineRecordPayload(view as unknown as Record<string, unknown>);
  assert.equal(roundTrip.traceabilityCode, "000012345678901234567890");
  assert.equal(roundTrip.manufacturer, "test_manufacturer");
  assert.equal(roundTrip.productName, "test_product");
  assert.equal(roundTrip.injectionSite, "test_site");
  assert.equal(roundTrip.notes, "test_notes");
  assert.equal(edited.baseVersion, view.version);
});

test("record creation requires an explicit actual date; a plan cannot masquerade as a vaccination", () => {
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗" }), /实际接种日期/);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", scheduledDate: "2026-08-01", isCompleted: true }), /实际接种日期/);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", completedDate: "2026-02-30" }), /实际接种日期/);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", isCompleted: false }), /计划接种日期/);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", isCompleted: false, scheduledDate: "2026-08-01", completedDate: "2026-08-01" }), /不能填写/);
  const historical = vaccineRecordFields({ name: "test_本上原名", completedDate: "2024-02-29" });
  assert.equal(historical.scheduledDate, null);
  assert.equal(historical.doseNumber, null);
  assert.equal(historical.dose, null);
  const planned = vaccineRecordFields({ name: "test_本上原名", scheduledDate: "2026-08-01", isCompleted: false });
  assert.throws(() => vaccineRecordFields({ isCompleted: true }, planned), /预约转为已接种/);
  assert.equal(vaccineRecordFields({ isCompleted: true, completedDate: "2026-08-03" }, planned).completedDate, "2026-08-03");
});

test("dose parsing preserves uncertainty and does not take valency or year numbers as a dose", () => {
  for (const value of [null, undefined, "", "待核对", "13价肺炎", "五联", "2026年补种", "第13剂"]) assert.equal(parseDoseNumber(value), null);
  assert.equal(parseDoseNumber("第2剂"), 2);
  assert.equal(parseDoseNumber("剂次: 第3剂"), 3);
  assert.equal(parseDoseNumber("test_note (剂次: 第2剂)"), 2);
  assert.equal(vaccineRecordFields({ name: "test_疫苗", dose: "加强（待核对）", completedDate: "2026-08-01" }).doseNumber, null);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", dose: "第2剂", doseNumber: 3, completedDate: "2026-08-01" }), /不一致/);
  assert.equal(vaccineRecordFields({ name: "test_疫苗", dose: "待".repeat(100), completedDate: "2026-08-01" }).dose?.length, 100);
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", dose: "待".repeat(101), completedDate: "2026-08-01" }), /100/);
});

test("unmapped names remain recordable; tracing codes are text and notes stay unchanged", () => {
  const payload = toGrowDeskVaccineRecordPayload({ name: "test_" + "名称".repeat(80), completedDate: "2026-08-01", notes: "test_original", traceabilityCode: "000123" });
  assert.equal(payload.vaccineCode, "unmapped");
  assert.equal(payload.legacyName.length, 165);
  assert.equal(payload.notes, "test_original");
  assert.equal(payload.traceabilityCode, "000123");
  const linked = toGrowDeskVaccineRecordPayload({ name: "test_原名", vaccineId: "vac_test", completedDate: "2026-08-01" });
  assert.equal(linked.vaccineCode, "vac_test");
  assert.equal("vaccineId" in linked, false, "stable codes must not be sent as normalized row IDs");
  const relinked = toGrowDeskVaccineUpdatePayload({ baseVersion: record.version, vaccineId: "vac_other" }, record);
  assert.equal(relinked.vaccineCode, "vac_other");
  assert.equal("vaccineId" in relinked, false);
  const unlinked = toGrowDeskVaccineUpdatePayload({ baseVersion: record.version, vaccineId: null }, record);
  assert.equal(unlinked.vaccineId, null);
  assert.equal(unlinked.vaccineCode, "unmapped");
  assert.throws(() => vaccineRecordFields({ name: "test_疫苗", completedDate: "2026-08-01", traceabilityCode: 123 }), /文本/);
});

test("programme choices and unknown doses cannot mark real doses complete", () => {
  const catalog = [{ id: "test_catalog", vaccineId: "vac_test", name: "test_疫苗", doses: [{ doseNumber: 1 }] }];
  const projected = buildVaccineSelections([{ ...record, vaccineCode: "vac_test" }], { "vac_test-1": { selected: true, completed: true } }, { vaccines: catalog });
  assert.equal(projected[0].completed, false);
  assert.equal(projected[0].recordId, null);
  const base = { id: "test_record", name: "test_疫苗", vaccineId: "vac_test", dose: null, doseNumber: null, isCompleted: true, completedDate: "2026-08-01" };
  assert.equal(completedVaccineFacts([base], catalog).size, 0);
  assert.equal(completedVaccineFacts([{ ...base, doseNumber: 1, isCompleted: false }], catalog).size, 0);
  assert.equal(completedVaccineFacts([{ ...base, doseNumber: 1 }], catalog).get("vac_test-1"), "test_record");
});
