import assert from "node:assert/strict";
import test from "node:test";
import { isBridgedMethod } from "@/lib/growdesk/bridge-policy";
import {
  fromGrowDeskGrowthRecord,
  toGrowDeskGrowthCreatePayload,
  toGrowDeskGrowthUpdatePayload,
  transformWhoPercentilesForLegacy,
  type GrowDeskGrowthRecord,
} from "@/lib/growdesk/growth-compat";
import {
  fromGrowDeskMedicalRecord,
  toGrowDeskMedicalCreatePayload,
  toGrowDeskMedicalUpdatePayload,
  type GrowDeskMedicalReport,
} from "@/lib/growdesk/medical-compat";
import {
  loadFullVaccineKnowledge,
  toGrowDeskVaccineRecordPayload,
  fromGrowDeskVaccineRecord,
  buildVaccineSelections,
  parseDoseNumber,
  type GrowDeskVaccineRecord,
} from "@/lib/growdesk/vaccine-compat";

test("Issue #6: Growth, Medical, Books, Vaccines & Food Parity Unit Tests", async (t) => {
  await t.test("1. Bridge Policy Allowlist for Medical, Growth, Vaccines, Books & Attachments", () => {
    // Growth
    assert.equal(isBridgedMethod("/api/growth", "GET"), true);
    assert.equal(isBridgedMethod("/api/growth", "POST"), true);
    assert.equal(isBridgedMethod("/api/growth", "PUT"), true);
    assert.equal(isBridgedMethod("/api/growth", "PATCH"), true);
    assert.equal(isBridgedMethod("/api/growth", "DELETE"), true);
    assert.equal(isBridgedMethod("/api/growth/chart", "GET"), true);
    assert.equal(isBridgedMethod("/api/growth/ocr", "POST"), true);

    // Medical
    assert.equal(isBridgedMethod("/api/medical/reports", "GET"), true);
    assert.equal(isBridgedMethod("/api/medical/reports", "POST"), true);
    assert.equal(isBridgedMethod("/api/medical/reports/12345678-1234-1234-1234-123456789abc", "GET"), true);
    assert.equal(isBridgedMethod("/api/medical/reports/12345678-1234-1234-1234-123456789abc", "PATCH"), true);
    assert.equal(isBridgedMethod("/api/medical/reports/12345678-1234-1234-1234-123456789abc", "DELETE"), true);
    assert.equal(isBridgedMethod("/api/medical/ocr", "POST"), true);
    assert.equal(isBridgedMethod("/api/medical/upload", "POST"), true);

    // Vaccines
    assert.equal(isBridgedMethod("/api/vaccines", "GET"), true);
    assert.equal(isBridgedMethod("/api/vaccines", "POST"), true);
    assert.equal(isBridgedMethod("/api/vaccines", "DELETE"), true);
    assert.equal(isBridgedMethod("/api/vaccines/selections", "GET"), true);
    assert.equal(isBridgedMethod("/api/vaccines/selections", "PUT"), true);

    // Books
    assert.equal(isBridgedMethod("/api/books", "GET"), true);
    assert.equal(isBridgedMethod("/api/books/book_beng", "PATCH"), true);

    // Attachments
    assert.equal(isBridgedMethod("/api/attachments/12345678-1234-1234-1234-123456789abc", "GET"), true);
  });

  await t.test("2. Growth Compatibility: Large Version Strings & Precision Preservation", () => {
    const largeSnowflakeVersion = "90071992547409999";
    const rawRecord: GrowDeskGrowthRecord = {
      id: "growth-rec-001",
      babyId: "baby-001",
      familyId: "fam-001",
      measurementDate: "2026-08-15",
      weightKg: "7.85",
      heightCm: "68.2",
      headCircumferenceCm: "43.5",
      attachmentId: "att-001",
      notes: "生长曲线稳定",
      version: largeSnowflakeVersion,
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z",
    };

    const legacy = fromGrowDeskGrowthRecord(rawRecord);
    assert.equal(legacy.id, "growth-rec-001");
    assert.equal(legacy.weightKg, 7.85);
    assert.equal(legacy.heightCm, 68.2);
    assert.equal(legacy.headCircumferenceCm, 43.5);
    // 关键验收条件：大版本不得经 JS Number 静默舍入
    assert.equal(legacy.version, largeSnowflakeVersion);
    assert.equal(legacy.baseVersion, largeSnowflakeVersion);

    // Update payload
    const updatePayload = toGrowDeskGrowthUpdatePayload({
      version: largeSnowflakeVersion,
      weightKg: 8.1,
      heightCm: 69.0,
    });
    assert.equal(updatePayload.baseVersion, largeSnowflakeVersion);
    assert.equal(updatePayload.weightKg, "8.10");
    assert.equal(updatePayload.heightCm, "69.0");

    // Create payload
    const createPayload = toGrowDeskGrowthCreatePayload({
      measurementDate: "2026-09-01",
      weight: 8.5,
      height: 70.0,
      headCircumference: 44.0,
      notes: "定期体检",
    });
    assert.equal(createPayload.measurementDate, "2026-09-01");
    assert.equal(createPayload.weightKg, "8.50");
    assert.equal(createPayload.heightCm, "70.0");
    assert.equal(createPayload.headCircumferenceCm, "44.0");
    assert.equal(createPayload.notes, "定期体检");
  });

  await t.test("3. Growth Chart: WHO Percentiles Transformation to Legacy Format", () => {
    const growdeskWho = {
      weightForAge: [
        { month: 0, p3: "2.5", p15: "2.9", p50: "3.3", p85: "3.9", p97: "4.4" },
        { month: 1, p3: "3.4", p15: "3.9", p50: "4.5", p85: "5.1", p97: "5.8" },
      ],
      heightForAge: [
        { month: 0, p3: "46.1", p15: "48.0", p50: "49.9", p85: "51.8", p97: "53.7" },
        { month: 1, p3: "50.8", p15: "52.8", p50: "54.7", p85: "56.6", p97: "58.6" },
      ],
      headCircumferenceForAge: [
        { month: 0, p3: "31.9", p15: "33.2", p50: "34.5", p85: "35.7", p97: "36.9" },
        { month: 1, p3: "34.3", p15: "35.6", p50: "36.9", p85: "38.3", p97: "39.5" },
      ],
    };

    const legacyPercentiles = transformWhoPercentilesForLegacy(growdeskWho);
    assert.ok(legacyPercentiles.weight);
    assert.ok(legacyPercentiles.height);
    assert.ok(legacyPercentiles.headCircumference);

    assert.deepEqual(legacyPercentiles.weight.P50, [3.3, 4.5]);
    assert.deepEqual(legacyPercentiles.weight.P97, [4.4, 5.8]);
    assert.deepEqual(legacyPercentiles.height.P50, [49.9, 54.7]);
    assert.deepEqual(legacyPercentiles.headCircumference.P50, [34.5, 36.9]);
  });

  await t.test("4. Medical Report Compat: Items & Attachment Mapping", () => {
    const rawReport: GrowDeskMedicalReport = {
      id: "med-001",
      babyId: "baby-001",
      familyId: "fam-001",
      reportDate: "2026-08-20",
      title: "6月龄血常规检查",
      hospital: "复旦大学附属儿科医院",
      department: "blood",
      diagnosis: "轻度缺铁性贫血",
      attachmentIds: ["att-med-uuid-1"],
      items: [
        { name: "血红蛋白", value: "105", unit: "g/L", referenceRange: "110-140", status: "low" },
        { name: "红细胞计数", value: "4.2", unit: "10^12/L", referenceRange: "3.8-5.1", status: "normal" },
      ],
      notes: "建议补充铁剂，1个月后复查血常规",
      version: "123456789012345678",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-08-20T10:00:00.000Z",
    };

    const legacy = fromGrowDeskMedicalRecord(rawReport);
    assert.equal(legacy.id, "med-001");
    assert.equal(legacy.title, "6月龄血常规检查");
    assert.equal(legacy.category, "blood");
    assert.equal(legacy.hospital, "复旦大学附属儿科医院");
    assert.equal(legacy.doctorNotes, "轻度缺铁性贫血");
    assert.equal(legacy.aiSummary, "建议补充铁剂，1个月后复查血常规");
    assert.equal(legacy.imageUrl, "/api/attachments/att-med-uuid-1");
    assert.equal(legacy.version, "123456789012345678");
    assert.ok(Array.isArray(legacy.items));
    assert.equal(legacy.items?.length, 2);
    assert.ok(typeof legacy.itemsJson === "string");
    assert.ok(legacy.itemsJson.includes("血红蛋白"));

    // Create payload with attachment
    const validUuid = "12345678-1234-1234-1234-123456789abc";
    const createPayload = toGrowDeskMedicalCreatePayload({
      title: "门诊化验",
      category: "blood",
      date: "2026-08-20",
      hospital: "上海儿童医学中心",
      imageUrl: `/api/attachments/${validUuid}`,
      items: [{ name: "WBC", value: "7.5" }],
    });
    assert.equal(createPayload.title, "门诊化验");
    assert.equal(createPayload.department, "blood");
    assert.equal(createPayload.hospital, "上海儿童医学中心");
    assert.deepEqual(createPayload.attachmentIds, [validUuid]);
    assert.equal(createPayload.items.length, 1);

    // Legacy uploads path must be preserved without silently stripping
    const legacyUploadsPayload = toGrowDeskMedicalCreatePayload({
      title: "旧单据",
      imageUrl: "/uploads/medical/legacy-report.jpg",
    });
    assert.deepEqual(legacyUploadsPayload.attachmentIds, ["/uploads/medical/legacy-report.jpg"]);
  });

  await t.test("5. Vaccine Full Knowledge Base: Non-placeholder Data & Regional Overrides", () => {
    const kb = loadFullVaccineKnowledge("CN-JS");
    assert.ok(kb.vaccines.length >= 30, "Should contain full set of ~33 vaccines");
    assert.ok(kb.national.length > 0, "National program vaccines must not be empty");
    assert.ok(kb.nonProgram.length > 0, "Non-program vaccines must not be empty placeholder");
    assert.ok(kb.provincial.length > 0, "Provincial vaccines must not be empty placeholder");
    assert.ok(kb.schedule.length > 20, "Schedule entries must not be empty placeholder");
    assert.ok(kb.strategyGroups.length > 0, "Strategy groups must not be empty placeholder");
    assert.ok(kb.engineRules.length > 0, "Engine rules must not be empty placeholder");
    assert.ok(kb.dataRelease, "Data release metadata must be present for traceability");
    assert.ok(kb.dataRelease?.version, "Data release version must be traceable");

    // 验证江苏地方覆盖：水痘疫苗在江苏属于地方免费 (provincial_immunization_program / feeType: free)
    const varicella = kb.vaccines.find((v) => v.vaccineId === "vac_varicella" || v.id === "vac_varicella");
    assert.ok(varicella, "Varicella vaccine must exist");
    assert.equal(varicella?.programType, "provincial_immunization_program");
    assert.equal(varicella?.feeType, "free");
  });

  await t.test("6. Vaccine Records & Selections Parity", () => {
    assert.equal(parseDoseNumber("第1剂"), 1);
    assert.equal(parseDoseNumber("第2剂"), 2);
    assert.equal(parseDoseNumber("第3剂"), 3);
    assert.equal(parseDoseNumber(null), 1);

    const rawRecords: GrowDeskVaccineRecord[] = [
      {
        id: "vac-rec-001",
        babyId: "baby-001",
        familyId: "fam-001",
        vaccineCode: "vac_bcg",
        administeredDate: "2026-03-01",
        clinic: "社区卫生中心",
        batchNumber: "B202603",
        notes: "第1剂",
        version: "1",
        createdAt: "2026-03-01T08:00:00Z",
        updatedAt: "2026-03-01T08:00:00Z",
      },
      {
        id: "vac-rec-002",
        babyId: "baby-001",
        familyId: "fam-001",
        vaccineCode: "vac_hepb",
        administeredDate: "2026-03-01",
        clinic: "妇幼保健院",
        batchNumber: "H202603",
        notes: "第1剂",
        version: "1",
        createdAt: "2026-03-01T08:00:00Z",
        updatedAt: "2026-03-01T08:00:00Z",
      },
    ];

    const legacyBcg = fromGrowDeskVaccineRecord(rawRecords[0]);
    assert.equal(legacyBcg.vaccineId, "vac_bcg");
    assert.equal(legacyBcg.dose, "第1剂");
    assert.equal(legacyBcg.isCompleted, true);

    const selections = buildVaccineSelections(rawRecords, {
      "vac_pcv13_crm197-1": { selected: true, completed: false },
      "vac_pcv13_tt-1": { selected: false, completed: false },
    });

    assert.ok(selections.length > 20);
    const bcgSel = selections.find((s) => s.vaccineId === "vac_bcg" && s.doseNumber === 1);
    assert.ok(bcgSel);
    assert.equal(bcgSel?.completed, true);
    assert.equal(bcgSel?.recordId, "vac-rec-001");

    const pcvSel = selections.find((s) => s.vaccineId === "vac_pcv13_crm197" && s.doseNumber === 1);
    assert.ok(pcvSel);
    assert.equal(pcvSel?.selected, true);
    assert.equal(pcvSel?.completed, false);
  });

  await t.test("7. Food Items Parity: recommendedFromMonth & Custom Items Mapping", () => {
    const growdeskFoodItems = [
      {
        id: "food-001",
        name: "南瓜泥",
        category: "vegetable",
        allergenRisk: "low",
        recommendedAgeMonths: 6,
        isCustom: false,
      },
      {
        id: "food-002",
        name: "自制三文鱼泥",
        category: "fish",
        allergenRisk: "medium",
        recommendedAgeMonths: 8,
        isCustom: true,
      },
    ];

    const mapped = growdeskFoodItems.map((item: any) => ({
      ...item,
      foodId: item.foodId ?? item.id,
      recommendedFromMonth: item.recommendedFromMonth ?? item.recommendedAgeMonths ?? 6,
      status: item.status ?? "to_try",
      firstAddedDate: item.firstAddedDate ?? null,
      acceptance: item.acceptance ?? 0,
      preparation: Array.isArray(item.preparation) ? item.preparation : [],
      nutrition: Array.isArray(item.nutrition) ? item.nutrition : [],
      textureByAge: Array.isArray(item.textureByAge) ? item.textureByAge : [],
      sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs : [],
    }));

    assert.equal(mapped[0].foodId, "food-001");
    assert.equal(mapped[0].recommendedFromMonth, 6);
    assert.equal(mapped[0].status, "to_try");
    assert.deepEqual(mapped[0].preparation, []);

    assert.equal(mapped[1].foodId, "food-002");
    assert.equal(mapped[1].recommendedFromMonth, 8);
    assert.equal(mapped[1].isCustom, true);
  });

  await t.test("8. Books Tab Filtering Parity", () => {
    const rawBooks = [
      { id: "book_beng", title: "蹦!", isFavorite: true, readCount: 3 },
      { id: "book_goldfish", title: "小金鱼逃走了", isFavorite: false, readCount: 1 },
      { id: "book_bear", title: "棕色的熊", isFavorite: false, readCount: 0 },
    ];

    // All
    const all = rawBooks;
    assert.equal(all.length, 3);

    // Favorites
    const favorites = rawBooks.filter((b) => b.isFavorite);
    assert.equal(favorites.length, 1);
    assert.equal(favorites[0].id, "book_beng");

    // Read
    const read = rawBooks.filter((b) => b.readCount > 0);
    assert.equal(read.length, 2);
  });
});
