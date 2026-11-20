import assert from "node:assert/strict";
import test from "node:test";
import { countHealthMeasurementMutations } from "../../lib/mcp/health-measurement-actions";

test("health measurement action counter identifies one requested mutation", () => {
  assert.equal(countHealthMeasurementMutations({ growth: { weightKg: 7.2 } }), 1);
  assert.equal(countHealthMeasurementMutations({ deleteAction: { type: "growth", id: "test-id" } }), 1);
});

test("health measurement action counter detects partial-write combinations before execution", () => {
  assert.equal(countHealthMeasurementMutations({ growth: {}, undoAction: { snapshotId: "test-snapshot" } }), 2);
  assert.equal(countHealthMeasurementMutations({ vaccine: {}, medicalReport: {}, deleteAction: {} }), 3);
  assert.equal(countHealthMeasurementMutations({ growth: null, vaccine: false, undoAction: undefined }), 0);
  assert.equal(countHealthMeasurementMutations(null), 0);
});
