import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import {
  toGrowDeskDiaperCreatePayload,
  toGrowDeskDiaperUpdatePayload,
  fromGrowDeskDiaperRecord,
} from "../../lib/growdesk/diaper-compat";
import {
  toGrowDeskSleepCreatePayload,
  toGrowDeskSleepUpdatePayload,
  fromGrowDeskSleepRecord,
} from "../../lib/growdesk/sleep-compat";
import {
  toGrowDeskFoodCreatePayload,
  toGrowDeskFoodUpdatePayload,
  fromGrowDeskFoodRecord,
} from "../../lib/growdesk/food-compat";
import {
  toGrowDeskSupplementCreatePayload,
  toGrowDeskSupplementUpdatePayload,
  fromGrowDeskSupplementRecord,
} from "../../lib/growdesk/supplement-compat";
import {
  toGrowDeskGrowthCreatePayload,
  toGrowDeskGrowthUpdatePayload,
  fromGrowDeskGrowthRecord,
} from "../../lib/growdesk/growth-compat";
import {
  toGrowDeskMedicalCreatePayload,
  toGrowDeskMedicalUpdatePayload,
  fromGrowDeskMedicalRecord,
} from "../../lib/growdesk/medical-compat";
import {
  toGrowDeskVaccineRecordPayload,
  fromGrowDeskVaccineRecord,
} from "../../lib/growdesk/vaccine-compat";
import {
  fromGrowDeskTimelineEntry,
  fromGrowDeskTimelineResponse,
} from "../../lib/growdesk/timeline-compat";
import { checkScope, createMcpServer } from "../../lib/mcp/server";
import type { UserPrincipal } from "../../lib/oauth/types";

import { POST as DiaperPOST, PUT as DiaperPUT, DELETE as DiaperDELETE } from "../../app/api/records/diaper/route";
import { POST as SleepPOST, PUT as SleepPUT, DELETE as SleepDELETE } from "../../app/api/records/sleep/route";
import { POST as FoodLogsPOST, PUT as FoodLogsPUT, DELETE as FoodLogsDELETE } from "../../app/api/food/logs/route";
import { POST as FoodItemsPOST } from "../../app/api/food/items/route";
import { POST as FoodPlansPOST } from "../../app/api/food/plans/route";
import { POST as NutritionPOST, DELETE as NutritionDELETE } from "../../app/api/nutrition/records/route";
import { POST as ProductsPOST, PUT as ProductsPUT, DELETE as ProductsDELETE } from "../../app/api/nutrition/products/route";
import { POST as SchedulesPOST, DELETE as SchedulesDELETE } from "../../app/api/nutrition/schedules/route";
import { POST as GrowthPOST, PUT as GrowthPUT, PATCH as GrowthPATCH, DELETE as GrowthDELETE } from "../../app/api/growth/route";
import { POST as GrowthOcrPOST } from "../../app/api/growth/ocr/route";
import { POST as MedicalPOST } from "../../app/api/medical/reports/route";
import { POST as MedicalOcrPOST } from "../../app/api/medical/ocr/route";
import { POST as VaccinePOST, DELETE as VaccineDELETE } from "../../app/api/vaccines/route";
import { GET as VaccineSelectionsGET, PUT as VaccineSelectionsPUT } from "../../app/api/vaccines/selections/route";
import { POST as PushPOST } from "../../app/api/push/subscribe/route";

test("SH-08: Diaper Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskDiaperCreatePayload: normalizes legacy wet/dirty to pee/poop", () => {
    const timestamp = "2026-09-12T10:00:00.000Z";
    const p1 = toGrowDeskDiaperCreatePayload({ type: "wet", notes: "Heavy", timestamp });
    assert.equal(p1.diaperType, "pee");
    assert.equal(p1.notes, "Heavy");
    assert.equal(p1.occurredAt, timestamp);

    const p2 = toGrowDeskDiaperCreatePayload({ type: "dirty", poopColor: "yellow", poopConsistency: "soft", timestamp });
    assert.equal(p2.diaperType, "poop");
    assert.equal(p2.poopColor, "yellow");
    assert.equal(p2.poopConsistency, "soft");

    const p3 = toGrowDeskDiaperCreatePayload({ type: "both", timestamp });
    assert.equal(p3.diaperType, "both");
  });

  await t.test("toGrowDeskDiaperUpdatePayload: preserves baseVersion and updates fields", () => {
    const p = toGrowDeskDiaperUpdatePayload({
      version: 2,
      type: "dirty",
      notes: "Updated note",
    });
    assert.equal(p.baseVersion, "2");
    assert.equal(p.diaperType, "poop");
    assert.equal(p.notes, "Updated note");
  });

  await t.test("fromGrowDeskDiaperRecord: transforms canonical record to frontend shape", () => {
    const rec = fromGrowDeskDiaperRecord({
      id: "diaper-123",
      babyId: "baby-1",
      familyId: "family-1",
      diaperType: "poop",
      occurredAt: "2026-09-12T10:00:00.000Z",
      poopColor: "brown",
      poopConsistency: "normal",
      notes: "Quick change",
      source: "ui_manual",
      sourceAgent: null,
      version: "4",
      createdAt: "2026-09-12T10:05:00.000Z",
      updatedAt: "2026-09-12T10:05:00.000Z",
    });

    assert.equal(rec.id, "diaper-123");
    assert.equal(rec.babyId, "baby-1");
    assert.equal(rec.type, "poop");
    assert.equal(rec.timestamp, "2026-09-12T10:00:00.000Z");
    assert.equal(rec.poopColor, "brown");
    assert.equal(rec.clientId, null);
    assert.equal(rec.version, "4");
    assert.equal(rec.baseVersion, "4");
  });
});

test("SH-08: Sleep Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskSleepCreatePayload: handles startTime/endTime and sleepType", () => {
    const p = toGrowDeskSleepCreatePayload({
      type: "nap",
      startTime: "2026-09-12T13:00:00.000Z",
      endTime: "2026-09-12T14:30:00.000Z",
      notes: "Afternoon nap",
      nightWakingCount: 0,
    });
    assert.equal(p.sleepType, "nap");
    assert.equal(p.startedAt, "2026-09-12T13:00:00.000Z");
    assert.equal(p.endedAt, "2026-09-12T14:30:00.000Z");
    assert.equal(p.nightWakingCount, 0);
  });

  await t.test("toGrowDeskSleepUpdatePayload: handles endedAt nullification and baseVersion", () => {
    const p = toGrowDeskSleepUpdatePayload({
      baseVersion: 5,
      sleepType: "night",
      endedAt: null,
      nightWakingCount: 2,
    });
    assert.equal(p.baseVersion, "5");
    assert.equal(p.sleepType, "night");
    assert.equal(p.endedAt, null);
    assert.equal(p.nightWakingCount, 2);
  });

  await t.test("fromGrowDeskSleepRecord: provides dual startedAt/startTime and endedAt/endTime", () => {
    const rec = fromGrowDeskSleepRecord({
      id: "sleep-123",
      babyId: "baby-1",
      familyId: "family-1",
      sleepType: "night",
      startedAt: "2026-09-12T20:00:00.000Z",
      endedAt: "2026-09-13T06:00:00.000Z",
      nightWakingCount: 1,
      notes: "Slept well",
      source: "ui_manual",
      sourceAgent: null,
      version: "3",
      createdAt: "2026-09-13T06:05:00.000Z",
      updatedAt: "2026-09-13T06:05:00.000Z",
    });

    assert.equal(rec.id, "sleep-123");
    assert.equal(rec.type, "night");
    assert.equal(rec.sleepType, "night");
    assert.equal(rec.startTime, "2026-09-12T20:00:00.000Z");
    assert.equal(rec.startedAt, "2026-09-12T20:00:00.000Z");
    assert.equal(rec.endTime, "2026-09-13T06:00:00.000Z");
    assert.equal(rec.endedAt, "2026-09-13T06:00:00.000Z");
    assert.equal(rec.clientId, null);
    assert.equal(rec.version, "3");
  });
});

test("SH-08: Food Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskFoodCreatePayload: converts date, time, mealType, food items", () => {
    const p = toGrowDeskFoodCreatePayload({
      date: "2026-09-12",
      time: "12:30",
      mealType: "lunch",
      foods: [{ id: "food-carrot", name: "Carrot" }, "food-apple"],
      portion: "half bowl",
      reaction: "like",
    });

    assert.equal(p.recordDate, "2026-09-12");
    // F4 fix: legacy wall clock is interpreted in the family zone (Asia/Shanghai), not UTC.
    assert.equal(p.occurredAt, "2026-09-12T04:30:00.000Z");
    assert.equal(p.mealType, "lunch");
    assert.deepEqual(p.foodItemIds, ["food-carrot", "food-apple"]);
    assert.equal(p.portionDescription, "half bowl");
    assert.equal(p.reaction, "like");
  });

  await t.test("fromGrowDeskFoodRecord: extracts HH:mm time and foodNames", () => {
    const rec = fromGrowDeskFoodRecord({
      id: "food-rec-1",
      babyId: "baby-1",
      familyId: "family-1",
      recordDate: "2026-09-12",
      mealType: "dinner",
      occurredAt: "2026-09-12T18:45:00.000Z",
      foodItemIds: ["pumpkin", "oatmeal"],
      portionDescription: "100g",
      reaction: "normal",
      notes: "Good appetite",
      version: "1",
      createdAt: "2026-09-12T19:00:00.000Z",
      updatedAt: "2026-09-12T19:00:00.000Z",
    });

    assert.equal(rec.id, "food-rec-1");
    assert.equal(rec.date, "2026-09-12");
    // F4 fix: HH:mm is rendered in the family zone (Asia/Shanghai): 18:45Z = 02:45 +08.
    assert.equal(rec.time, "02:45");
    assert.equal(rec.mealType, "dinner");
    assert.deepEqual(rec.foods, ["pumpkin", "oatmeal"]);
    assert.deepEqual(rec.foodNames, ["pumpkin", "oatmeal"]);
  });
});

test("SH-08: Supplement Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskSupplementCreatePayload: maps name, amount, timestamp", () => {
    const p = toGrowDeskSupplementCreatePayload({
      name: "Vitamin D3",
      amount: "400 IU",
      timestamp: "2026-09-12T09:00:00.000Z",
      notes: "Daily drop",
    });

    assert.equal(p.supplementName, "Vitamin D3");
    assert.equal(p.amount, "400 IU");
    assert.equal(p.occurredAt, "2026-09-12T09:00:00.000Z");
    assert.equal(p.notes, "Daily drop");
  });

  await t.test("fromGrowDeskSupplementRecord: exposes legacy name and timestamp", () => {
    const rec = fromGrowDeskSupplementRecord({
      id: "supp-1",
      babyId: "baby-1",
      familyId: "family-1",
      supplementName: "DHA",
      occurredAt: "2026-09-12T08:00:00.000Z",
      amount: "1 capsule",
      notes: null,
      version: "2",
      createdAt: "2026-09-12T08:00:00.000Z",
      updatedAt: "2026-09-12T08:00:00.000Z",
    });

    assert.equal(rec.id, "supp-1");
    assert.equal(rec.name, "DHA");
    assert.equal(rec.supplementName, "DHA");
    assert.equal(rec.timestamp, "2026-09-12T08:00:00.000Z");
    assert.equal(rec.occurredAt, "2026-09-12T08:00:00.000Z");
    assert.equal(rec.version, 2);
  });
});

test("SH-08: Growth Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskGrowthCreatePayload: formats decimal strings with proper precision", () => {
    const p = toGrowDeskGrowthCreatePayload({
      date: "2026-09-12",
      weightKg: 8.456,
      heightCm: 71.24,
      headCircumferenceCm: 44.1,
    });

    assert.equal(p.measurementDate, "2026-09-12");
    assert.equal(p.weightKg, "8.46"); // 2 decimals
    assert.equal(p.heightCm, "71.2"); // 1 decimal
    assert.equal(p.headCircumferenceCm, "44.1"); // 1 decimal
  });

  await t.test("fromGrowDeskGrowthRecord: parses decimal strings to numbers for charts", () => {
    const rec = fromGrowDeskGrowthRecord({
      id: "growth-1",
      babyId: "baby-1",
      familyId: "family-1",
      measurementDate: "2026-09-12",
      weightKg: "8.50",
      heightCm: "71.5",
      headCircumferenceCm: "44.2",
      attachmentId: null,
      notes: "Routine checkup",
      version: "1",
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    });

    assert.equal(rec.weight, 8.5);
    assert.equal(rec.weightKg, 8.5);
    assert.equal(rec.height, 71.5);
    assert.equal(rec.heightCm, 71.5);
    assert.equal(rec.headCircumference, 44.2);
    assert.equal(rec.headCircumferenceCm, 44.2);
  });
});

test("SH-08: Medical Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskMedicalCreatePayload: maps hospital, department, diagnosis, attachmentIds", () => {
    const p = toGrowDeskMedicalCreatePayload({
      title: "Pediatric Wellness Exam",
      date: "2026-09-10",
      hospital: "Children's Hospital",
      category: "pediatrics",
      doctorNotes: "Healthy development",
      aiSummary: "All normal",
      imageUrl: "https://example.com/uploads/medical/report1.jpg",
    });

    assert.equal(p.title, "Pediatric Wellness Exam");
    assert.equal(p.reportDate, "2026-09-10");
    assert.equal(p.hospital, "Children's Hospital");
    assert.equal(p.department, "pediatrics");
    assert.equal(p.diagnosis, "Healthy development");
    assert.equal(p.notes, "All normal");
    assert.deepEqual(p.attachmentIds, ["https://example.com/uploads/medical/report1.jpg"]);
  });

  await t.test("fromGrowDeskMedicalRecord: provides backwards compatible report shape", () => {
    const rec = fromGrowDeskMedicalRecord({
      id: "med-1",
      babyId: "baby-1",
      familyId: "family-1",
      reportDate: "2026-09-10",
      title: "Checkup",
      hospital: "City Hospital",
      department: "Pediatrics",
      diagnosis: "Common cold",
      attachmentIds: ["https://example.com/uploads/medical/file.png"],
      notes: "Rest and fluids",
      version: "1",
      createdAt: "2026-09-10T12:00:00.000Z",
      updatedAt: "2026-09-10T12:00:00.000Z",
    });

    assert.equal(rec.id, "med-1");
    assert.equal(rec.category, "Pediatrics");
    assert.equal(rec.doctorNotes, "Common cold");
    assert.equal(rec.aiSummary, "Rest and fluids");
    assert.equal(rec.imageUrl, "https://example.com/uploads/medical/file.png");
    assert.equal(rec.recordedById, null);
    assert.equal(rec.source, "ui_manual");
    assert.equal(rec.sourceAgent, null);
  });
});

test("SH-08: Vaccine Compat DTO Layer", async (t) => {
  await t.test("toGrowDeskVaccineRecordPayload: extracts vaccineCode and dose note", () => {
    const p = toGrowDeskVaccineRecordPayload({
      vaccineId: "hep-b",
      dose: "1",
      scheduledDate: "2026-09-12",
      clinic: "Community Clinic",
      notes: "Left arm",
    });

    assert.equal(p.vaccineCode, "hep-b");
    assert.equal(p.administeredDate, "2026-09-12");
    assert.equal(p.clinic, "Community Clinic");
    assert.ok(p.notes?.includes("剂次: 1"));
  });

  await t.test("fromGrowDeskVaccineRecord: parses dose from notes and marks completed", () => {
    const rec = fromGrowDeskVaccineRecord({
      id: "vac-1",
      babyId: "baby-1",
      familyId: "family-1",
      vaccineCode: "BCG",
      administeredDate: "2026-09-12",
      clinic: "Hospital",
      batchNumber: "B12345",
      notes: "第 2 剂接种顺利",
      version: "1",
      createdAt: "2026-09-12T09:00:00.000Z",
      updatedAt: "2026-09-12T09:00:00.000Z",
    });

    assert.equal(rec.vaccineId, "BCG");
    assert.equal(rec.dose, "第2剂");
    assert.equal(rec.isCompleted, true);
    assert.equal(rec.completedDate, "2026-09-12");
  });
});

test("SH-08: Timeline Compat DTO Layer", async (t) => {
  await t.test("fromGrowDeskTimelineEntry: restores numeric supplement dose from Decimal wire strings", () => {
    const item = fromGrowDeskTimelineEntry({
      id: "timeline-supplement-1",
      babyId: "baby-1",
      entityType: "supplement",
      entityId: "supplement-1",
      occurredAt: "2026-09-19T01:00:00.000Z",
      summary: "Supplement",
      version: "1",
    }, {
      supplements: new Map([["supplement-1", {
        id: "supplement-1",
        babyId: "baby-1",
        supplementName: "Vitamin D",
        dose: "1.5",
        unitName: "滴",
        notes: "[productId:test_product] test_note",
      }]]),
    });

    assert.equal(item.rawRecord?.dose, 1.5);
    assert.equal(item.rawRecord?.notes, "test_note");
    assert.equal(item.detail, "Vitamin D 1.5 滴 · test_note");
  });

  await t.test("fromGrowDeskTimelineResponse: converts list and sets correct icons and labels", () => {
    const items = fromGrowDeskTimelineResponse([
      {
        id: "tl-1",
        babyId: "baby-1",
        entityType: "feeding",
        entityId: "feed-10",
        occurredAt: "2026-09-12T12:00:00.000Z",
        summary: "配方奶 150ml",
        version: "1",
      },
      {
        id: "tl-2",
        babyId: "baby-1",
        entityType: "diaper",
        entityId: "diaper-20",
        occurredAt: "2026-09-12T12:30:00.000Z",
        summary: "便便 正常",
        version: "1",
      },
    ]);

    assert.equal(items.length, 2);
    assert.deepEqual(items.map(item => item.id), ["diaper-20", "feed-10"], "legacy timeline is newest first");
    assert.equal(items[1].title, "喂奶");
    assert.equal(items[1].icon, "🍼");
    assert.equal(items[0].title, "尿布");
    assert.equal(items[0].icon, "🧷");
  });

  await t.test("fromGrowDeskTimelineResponse: enriches feeding with formula product and rawRecord", () => {
    const feedings = new Map([
      [
        "feed-10",
        {
          id: "feed-10",
          babyId: "baby-1",
          type: "formula",
          occurredAt: "2026-09-12T12:00:00.000Z",
          amountMl: 140,
          formulaProductId: "fp-aptamil",
          recordedByUserId: "user-dad",
          version: 1,
        },
      ],
    ]);
    const formulaProducts = new Map([
      ["fp-aptamil", { id: "fp-aptamil", name: "澳洲爱他美白金版 Profutura 1段 (0-6个月)", brand: "Aptamil" }],
    ]);
    const memberNames = new Map([["user-dad", "爸爸"]]);

    const items = fromGrowDeskTimelineResponse(
      [
        {
          id: "tl-1",
          babyId: "baby-1",
          entityType: "feeding",
          entityId: "feed-10",
          occurredAt: "2026-09-12T12:00:00.000Z",
          summary: "配方奶 140ml",
          version: "1",
        },
      ],
      { feedings, formulaProducts, memberNames },
    );

    assert.equal(items.length, 1);
    assert.equal(items[0].id, "feed-10");
    assert.equal(items[0].title, "配方奶");
    assert.equal(items[0].formulaProductId, "fp-aptamil");
    assert.equal(items[0].formulaProductName, "澳洲爱他美白金版 Profutura 1段 (0-6个月)");
    assert.equal(items[0].detail, "配方140ml (澳洲爱他美白金版 Profutura 1段 (0-6个月))");
    assert.equal(items[0].recorderName, "爸爸");
    assert.ok(items[0].rawRecord, "rawRecord should be populated");
    assert.equal(items[0].rawRecord.amountMl, 140);
    assert.equal(items[0].rawRecord.formulaProductId, "fp-aptamil");
  });
});

test("SH-08: Dual-Mode Web Route Handlers Under BFF Mode (Security Rejections)", async (t) => {
  const origEnv = process.env.GROWDESK_ENABLED;
  process.env.GROWDESK_ENABLED = "true";

  t.after(() => {
    process.env.GROWDESK_ENABLED = origEnv;
  });

  const routes = [
    { name: "Diaper POST", fn: () => DiaperPOST(makeReq("http://127.0.0.1:3000/api/records/diaper", "POST")) },
    { name: "Diaper PUT", fn: () => DiaperPUT(makeReq("http://127.0.0.1:3000/api/records/diaper", "PUT")) },
    { name: "Diaper DELETE", fn: () => DiaperDELETE(makeReq("http://127.0.0.1:3000/api/records/diaper", "DELETE")) },
    { name: "Sleep POST", fn: () => SleepPOST(makeReq("http://127.0.0.1:3000/api/records/sleep", "POST")) },
    { name: "Sleep PUT", fn: () => SleepPUT(makeReq("http://127.0.0.1:3000/api/records/sleep", "PUT")) },
    { name: "Sleep DELETE", fn: () => SleepDELETE(makeReq("http://127.0.0.1:3000/api/records/sleep", "DELETE")) },
    { name: "Food Logs POST", fn: () => FoodLogsPOST(makeReq("http://127.0.0.1:3000/api/food/logs", "POST")) },
    { name: "Food Logs PUT", fn: () => FoodLogsPUT(makeReq("http://127.0.0.1:3000/api/food/logs", "PUT")) },
    { name: "Food Logs DELETE", fn: () => FoodLogsDELETE(makeReq("http://127.0.0.1:3000/api/food/logs", "DELETE")) },
    { name: "Food Items POST", fn: () => FoodItemsPOST(makeReq("http://127.0.0.1:3000/api/food/items", "POST")) },
    { name: "Food Plans POST", fn: () => FoodPlansPOST(makeReq("http://127.0.0.1:3000/api/food/plans", "POST")) },
    { name: "Nutrition Records POST", fn: () => NutritionPOST(makeReq("http://127.0.0.1:3000/api/nutrition/records", "POST")) },
    { name: "Nutrition Records DELETE", fn: () => NutritionDELETE(makeReq("http://127.0.0.1:3000/api/nutrition/records", "DELETE")) },
    { name: "Nutrition Products POST", fn: () => ProductsPOST(makeReq("http://127.0.0.1:3000/api/nutrition/products", "POST")) },
    { name: "Nutrition Products PUT", fn: () => ProductsPUT(makeReq("http://127.0.0.1:3000/api/nutrition/products", "PUT")) },
    { name: "Nutrition Products DELETE", fn: () => ProductsDELETE(makeReq("http://127.0.0.1:3000/api/nutrition/products", "DELETE")) },
    { name: "Nutrition Schedules POST", fn: () => SchedulesPOST(makeReq("http://127.0.0.1:3000/api/nutrition/schedules", "POST")) },
    { name: "Nutrition Schedules DELETE", fn: () => SchedulesDELETE(makeReq("http://127.0.0.1:3000/api/nutrition/schedules", "DELETE")) },
    { name: "Growth POST", fn: () => GrowthPOST(makeReq("http://127.0.0.1:3000/api/growth", "POST")) },
    { name: "Growth PUT", fn: () => GrowthPUT(makeReq("http://127.0.0.1:3000/api/growth", "PUT")) },
    { name: "Growth PATCH", fn: () => GrowthPATCH(makeReq("http://127.0.0.1:3000/api/growth", "PATCH")) },
    { name: "Growth DELETE", fn: () => GrowthDELETE(makeReq("http://127.0.0.1:3000/api/growth", "DELETE")) },
    { name: "Growth OCR POST", fn: () => GrowthOcrPOST(makeReq("http://127.0.0.1:3000/api/growth/ocr", "POST")) },
    { name: "Medical POST", fn: () => MedicalPOST(makeReq("http://127.0.0.1:3000/api/medical/reports", "POST")) },
    { name: "Medical OCR POST", fn: () => MedicalOcrPOST(makeReq("http://127.0.0.1:3000/api/medical/ocr", "POST")) },
    { name: "Vaccine POST", fn: () => VaccinePOST(makeReq("http://127.0.0.1:3000/api/vaccines", "POST")) },
    { name: "Vaccine DELETE", fn: () => VaccineDELETE(makeReq("http://127.0.0.1:3000/api/vaccines", "DELETE")) },
    { name: "Vaccine Selections GET", fn: () => VaccineSelectionsGET(makeReq("http://127.0.0.1:3000/api/vaccines/selections", "GET")) },
    { name: "Vaccine Selections PUT", fn: () => VaccineSelectionsPUT(makeReq("http://127.0.0.1:3000/api/vaccines/selections", "PUT")) },
    { name: "Push POST", fn: () => PushPOST(makeReq("http://127.0.0.1:3000/api/push/subscribe", "POST")) },
  ];

  for (const { name, fn } of routes) {
    await t.test(`${name}: returns 403 or 401 when untrusted/unauthenticated under BFF mode`, async () => {
      const res = await fn();
      assert.ok([401, 403].includes(res.status), `Expected 401 or 403, got ${res.status} for ${name}`);
    });
  }
});

function makeReq(url: string, method: string) {
  const isBodyAllowed = method !== "GET" && method !== "HEAD";
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://untrusted-attacker.com",
    },
    ...(isBodyAllowed ? { body: JSON.stringify({ babyId: "baby-test-1", id: "item-1" }) } : {}),
  });
}

test("SH-08: Remote MCP Server Dual-Mode & Scopes", async (t) => {
  const dummyPrincipal: UserPrincipal = {
    userId: "usr-1",
    username: "tester",
    displayName: "Tester",
    babyId: "baby-1",
    scopes: new Set(["baby:read"]),
    clientId: "client-1",
    sourceAgent: "Test Agent",
    baby: {
      id: "baby-1",
      nickname: "Baby",
      gender: "female",
      birthDate: "2026-01-01",
      familyId: "fam-1",
    },
  };

  await t.test("checkScope: validates read and write scopes accurately", () => {
    assert.equal(checkScope(dummyPrincipal, "read"), true);
    assert.equal(checkScope(dummyPrincipal, "write"), false);

    const writePrincipal: UserPrincipal = {
      ...dummyPrincipal,
      scopes: new Set(["baby:write"]),
    };
    assert.equal(checkScope(writePrincipal, "read"), true);
    assert.equal(checkScope(writePrincipal, "write"), true);

    const appWritePrincipal: UserPrincipal = {
      ...dummyPrincipal,
      scopes: new Set(["app:write"]),
    };
    assert.equal(checkScope(appWritePrincipal, "read"), true);
    assert.equal(checkScope(appWritePrincipal, "write"), true);

    const noScopePrincipal: UserPrincipal = {
      ...dummyPrincipal,
      scopes: new Set(),
    };
    assert.equal(checkScope(noScopePrincipal, "read"), false);
    assert.equal(checkScope(noScopePrincipal, "write"), false);
  });

  await t.test("createMcpServer: initializes server with accessToken option", () => {
    const server = createMcpServer(dummyPrincipal, { accessToken: "mcp-bearer-token-123" });
    assert.ok(server, "Server should be instantiated");
  });
});
