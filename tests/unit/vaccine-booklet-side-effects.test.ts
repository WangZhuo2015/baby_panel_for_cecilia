import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVaccineReminderNotifications,
  calendarDaysUntil,
  completedVaccineReminderKey,
  plannedVaccineReminderRecord,
  type FamilyClock,
  type GrowDeskNotificationScope,
} from "../../lib/growdesk/notification-parity";
import { vaccineSnapshotRestoreData } from "../../lib/records/snapshot";
import { matchVaccineProduct, parseVaccineRecordInput } from "../../lib/vaccine-records";

const scope: GrowDeskNotificationScope = {
  babyId: "test_baby_vaccine_side_effects",
  familyId: "test_family_vaccine_side_effects",
  birthDate: "2026-03-19",
};

const clock: FamilyClock = {
  date: "2026-09-19",
  timeZone: "Asia/Shanghai",
  startMs: Date.parse("2026-09-18T16:00:00.000Z"),
  endMs: Date.parse("2026-09-19T16:00:00.000Z"),
};

function recordBase(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    babyId: scope.babyId,
    familyId: scope.familyId,
    createdAt: "2026-09-19T02:00:00.000Z",
    updatedAt: "2026-09-19T02:00:00.000Z",
    vaccineId: "vac_test_product",
    vaccineCode: "vac_test_product",
    legacyName: "test_疫苗本名称",
    ...extra,
  };
}

function reminderItems(records: Record<string, unknown>[]) {
  return buildVaccineReminderNotifications(
    [],
    records,
    {
      babyId: scope.babyId,
      id: "test_plan",
      createdAt: "2026-09-18T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
      version: "1",
      planData: {},
    },
    scope,
    clock,
    Date.parse("2026-09-19T04:00:00.000Z"),
  );
}

test("vaccine reminders skip review rows and planned rows without a real scheduled date", () => {
  assert.deepEqual(reminderItems([
    recordBase("test_review", {
      recordStatus: "needs_review",
      isCompleted: false,
      doseNumber: null,
      administeredDate: null,
      scheduledDate: null,
      completedDate: null,
    }),
    recordBase("test_planned_no_date", {
      recordStatus: "planned",
      isCompleted: false,
      doseNumber: null,
      administeredDate: null,
      scheduledDate: null,
      completedDate: null,
    }),
  ]), []);

  assert.equal(plannedVaccineReminderRecord(recordBase("test_no_date", {
    recordStatus: "planned", scheduledDate: null,
  })), null);
  assert.equal(calendarDaysUntil("not-a-date", clock.date), null);
});

test("unknown planned doses keep a neutral label and never become dose one", () => {
  const items = reminderItems([
    recordBase("test_planned_unknown_dose", {
      recordStatus: "planned",
      isCompleted: false,
      dose: "剂次待核对",
      doseNumber: null,
      legacyDose: null,
      administeredDate: null,
      scheduledDate: "2026-09-20",
      completedDate: null,
    }),
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "💉 test_疫苗本名称 剂次待核对");
  assert.doesNotMatch(items[0]?.title || "", /第1剂/);
  assert.equal(plannedVaccineReminderRecord(recordBase("test_unknown", {
    recordStatus: "planned", doseNumber: null, legacyDose: null, dose: null,
    scheduledDate: "2026-09-20",
  }))?.doseNumber, null);
});

test("only a dated nonfuture completion with a known dose suppresses the matching plan", () => {
  const planned = recordBase("test_plan_dose_2", {
    recordStatus: "planned", isCompleted: false, doseNumber: 2,
    legacyDose: "第2剂", scheduledDate: "2026-09-20", completedDate: null,
  });
  const futureCompleted = recordBase("test_future_completed_dose_2", {
    recordStatus: "completed", isCompleted: true, doseNumber: 2,
    legacyDose: "第2剂", administeredDate: "2026-09-20", completedDate: "2026-09-20",
  });

  assert.equal(completedVaccineReminderKey(futureCompleted, clock.date), null);
  assert.equal(reminderItems([planned, futureCompleted]).length, 1);

  const completedToday = { ...futureCompleted, administeredDate: clock.date, completedDate: clock.date };
  assert.equal(completedVaccineReminderKey(completedToday, clock.date), "vac_test_product-2");
  assert.deepEqual(reminderItems([planned, completedToday]), []);
  assert.equal(completedVaccineReminderKey({ ...completedToday, doseNumber: null, legacyDose: null }, clock.date), null);

  const ledgerUnknown = recordBase("test_plan_structured_unknown", {
    recordStatus: "planned", isCompleted: false, doseNumber: null,
    legacyDose: "第2剂", dose: "第2剂", scheduledDate: "2026-09-20", completedDate: null,
  });
  const ledgerCompleted = { ...completedToday, id: "test_completed_structured_2" };
  assert.equal(plannedVaccineReminderRecord(ledgerUnknown)?.doseNumber, null,
    "an explicit ledger null must not be reconstructed from display text");
  assert.equal(reminderItems([ledgerUnknown, ledgerCompleted]).length, 1,
    "unknown structured dose must not match a completed dose 2");
});

test("vaccine entry validation never substitutes today or dose one", () => {
  assert.throws(
    () => parseVaccineRecordInput({ name: "test_疫苗本", recordStatus: "completed" }, "2026-09-19"),
    /实际接种日期/,
  );
  assert.throws(
    () => parseVaccineRecordInput({ name: "test_疫苗本", recordStatus: "planned" }, "2026-09-19"),
    /预约日期/,
  );

  const review = parseVaccineRecordInput({
    name: "test_疫苗本原文",
    recordStatus: "needs_review",
    doseNumber: null,
    sourceText: "test_不完整日期与剂次",
  }, "2026-09-19");
  assert.equal(review.recordStatus, "needs_review");
  assert.equal(review.doseNumber, null);
  assert.equal(review.administeredDate, null);
  assert.equal(review.scheduledDate, null);

  const catalog = [{ vaccineId: "vac_test_pentavalent", name: "test_PENTAXIM", shortName: "test_PENTAXIM" }];
  assert.equal(matchVaccineProduct("test_PENTAXIM", catalog)?.vaccineId, "vac_test_pentavalent");
  assert.equal(matchVaccineProduct("test_PENTA", catalog), null, "partial product names must not select a product");
});

test("snapshot restoration preserves vaccine product, status, dates, and booklet metadata", () => {
  const original = {
    id: "test_vaccine_record_snapshot",
    name: "test_实际产品",
    vaccineId: "vac_test_product",
    dose: "第3剂",
    doseNumber: 3,
    recordStatus: "completed",
    administeredDate: "2026-09-10",
    scheduledDate: null,
    completedDate: "2026-09-10",
    isCompleted: true,
    manufacturer: "test_厂家",
    clinic: "test_接种门诊",
    batchNumber: "TEST-LOT-003",
    traceCode: "test_trace_0003",
    administrationRoute: "口服",
    injectionSite: null,
    sourceText: "test_疫苗本原文",
    notes: "test_备注",
  };

  assert.deepEqual(vaccineSnapshotRestoreData(original), { ...original, version: 1 });
  assert.equal(vaccineSnapshotRestoreData({ ...original, version: 4 }).version, 5,
    "restoring the same id must invalidate a stale editor's version");

  const oldSnapshot = vaccineSnapshotRestoreData({
    id: "test_legacy_snapshot",
    name: "test_旧记录",
    dose: "",
    isCompleted: false,
  });
  assert.equal(oldSnapshot.recordStatus, null);
  assert.equal(oldSnapshot.administeredDate, null);
  assert.equal(oldSnapshot.scheduledDate, null);
  assert.equal(oldSnapshot.completedDate, null);
  assert.equal(oldSnapshot.doseNumber, null);
});
