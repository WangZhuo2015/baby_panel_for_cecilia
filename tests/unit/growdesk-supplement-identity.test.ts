import test from "node:test";
import assert from "node:assert/strict";
import { findMatchingSupplementProduct, fromGrowDeskSupplementRecordEnriched, supplementProductReference, type GrowDeskSupplementRecord } from "../../lib/growdesk/nutrition-compat";
import { fromGrowDeskTimelineEntry } from "../../lib/growdesk/timeline-compat";
import type { SupplementProduct } from "../../types/nutrition";
const product = (id: string, name = "test_same_name"): SupplementProduct => ({ id, familyId: "test_family", name, brand: "test_brand", dosageForm: "drops", unitName: "滴", defaultDose: 99, nutrients: { vitamin_d: { amount: 400, unit: "IU" } }, isActive: true });
const record: GrowDeskSupplementRecord = { id: "test_record", familyId: "test_family", babyId: "test_baby", productId: "test_missing", supplementName: "test_same_name", occurredAt: "2026-09-19T01:00:00.000Z", amount: "1.5 滴", dose: "1.5", unitName: "滴", notes: "test_note", version: "1", createdAt: "2026-09-19T01:00:00.000Z", updatedAt: "2026-09-19T01:00:00.000Z" };

test("an explicit missing ID does not adopt the nutrient composition of a same-name product", () => {
  const values = [product("test_replacement")];
  assert.equal(findMatchingSupplementProduct(record.supplementName, record.productId!, values), undefined);
  const result = fromGrowDeskSupplementRecordEnriched(record, values);
  assert.equal(result.productId, "test_missing");
  assert.equal(result.product?.id, "test_missing");
  assert.deepEqual(result.product?.nutrients, {});
  assert.equal(result.product?.isActive, false);
  assert.equal(result.dose, 1.5);
});

test("ambiguous names remain unresolved; unique names retain legacy compatibility", () => {
  assert.equal(findMatchingSupplementProduct("test_same_name", null, [product("test_one"), product("test_two")]), undefined);
  const unresolved = fromGrowDeskSupplementRecordEnriched({ ...record, productId: null }, [product("test_one"), product("test_two")]);
  assert.equal(unresolved.productId, record.id);
  const resolved = fromGrowDeskSupplementRecordEnriched({ ...record, productId: null }, [product("test_one")]);
  assert.equal(resolved.productId, "test_one");
});

test("canonical IDs win over conflicting note tags without hiding the original note", () => {
  assert.deepEqual(supplementProductReference("test_canonical", "[productId:test_other] test_note"), { productId: "test_canonical", cleanNotes: "[productId:test_other] test_note" });
  assert.deepEqual(supplementProductReference("test_canonical", "[productId:test_canonical] test_note"), { productId: "test_canonical", cleanNotes: "test_note" });
  assert.deepEqual(supplementProductReference(null, "[productId:test_legacy] test_note"), { productId: "test_legacy", cleanNotes: "test_note" });
  assert.deepEqual(supplementProductReference(null, "[productId:../test] test_note"), { productId: null, cleanNotes: "[productId:../test] test_note" });
});

test("archived products and old note tags retain identity, dose and record-time name", () => {
  const historical = { ...record, productId: null, notes: "[productId:test_archived] test_human_note", supplementName: "test_old_name" };
  const result = fromGrowDeskSupplementRecordEnriched(historical, [{ ...product("test_archived", "test_new_name"), isActive: false }]);
  assert.equal(result.productId, "test_archived");
  assert.equal(result.product?.name, "test_old_name");
  assert.equal(result.dose, 1.5);
  assert.equal(result.notes, "test_human_note");
});

test("a catalog record from another family is never used to enrich history", () => {
  const result = fromGrowDeskSupplementRecordEnriched(record, [{ ...product("test_missing"), familyId: "test_foreign_family" }]);
  assert.deepEqual(result.product?.nutrients, {});
  assert.equal(result.product?.familyId, record.familyId);
});

test("timeline and supplement-history views agree on a tagged product", () => {
  const historical = { ...record, productId: null, notes: "[productId:test_archived] test_human_note" };
  const p = { ...product("test_archived", "test_renamed"), isActive: false };
  const timeline = fromGrowDeskTimelineEntry({ id: "test_timeline", babyId: record.babyId, entityId: record.id, entityType: "supplement", occurredAt: record.occurredAt, summary: "test_summary", version: "1" }, { supplements: new Map([[record.id, historical]]), supplementProducts: new Map([[p.id, p]]) });
  const history = fromGrowDeskSupplementRecordEnriched(historical, [p]);
  assert.equal(timeline.rawRecord.productId, history.productId);
  assert.equal(timeline.rawRecord.dose, history.dose);
  assert.equal(timeline.rawRecord.productName, history.product?.name);
  assert.equal(timeline.rawRecord.notes, history.notes);
});
