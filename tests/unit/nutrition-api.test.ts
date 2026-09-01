import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "@/lib/prisma";
import { signAuthToken } from "@/lib/auth";
import { getLocalDateStr } from "@/lib/date";
import * as productsRoute from "@/app/api/nutrition/products/route";
import * as schedulesRoute from "@/app/api/nutrition/schedules/route";
import * as recordsRoute from "@/app/api/nutrition/records/route";
import * as analysisRoute from "@/app/api/nutrition/analysis/route";

test("API: Nutrition Products, Schedules, Records, and Analysis Domain", async () => {
  const user = await prisma.user.findFirst();
  const baby = await prisma.baby.findFirst();
  assert.ok(user && baby, "User and Baby must exist in DB");

  const token = await signAuthToken({ userId: user.id, username: user.username });
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const today = getLocalDateStr();

  // 1. Test Products API
  console.log("-> Testing Nutrition Products API...");
  // POST Formula
  const createFormulaReq = new Request("http://localhost:3000/api/nutrition/products", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      type: "formula",
      name: "测试爱他美奶粉",
      brand: "爱他美",
      stage: 1,
      scoopWeightG: 4.3,
      waterPerScoopMl: 30.0,
      reconstitutionRatio: 0.135,
      nutrients: {
        vitamin_d: { amount: 380, unit: "IU" },
        calcium: { amount: 340, unit: "mg" },
        iron: { amount: 5.2, unit: "mg" },
      },
    }),
  });
  const createFormulaRes = await productsRoute.POST(createFormulaReq);
  assert.equal(createFormulaRes.status, 201);
  const createdFormula = await createFormulaRes.json();
  assert.ok(createdFormula.id);

  // POST Supplement (Compound: Calcium + D3)
  const createSuppReq = new Request("http://localhost:3000/api/nutrition/products", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      type: "supplement",
      name: "测试复合液体乳钙",
      brand: "Ostelin",
      dosageForm: "liquid_ml",
      unitName: "ml",
      defaultDose: 1.0,
      nutrients: {
        calcium: { amount: 100, unit: "mg" },
        vitamin_d: { amount: 200, unit: "IU" },
        vitamin_k: { amount: 5, unit: "mcg" },
      },
    }),
  });
  const createSuppRes = await productsRoute.POST(createSuppReq);
  assert.equal(createSuppRes.status, 201);
  const createdSupp = await createSuppRes.json();
  assert.ok(createdSupp.id);

  // GET Products
  const getProductsReq = new Request("http://localhost:3000/api/nutrition/products", {
    method: "GET",
    headers: authHeaders,
  });
  const getProductsRes = await productsRoute.GET(getProductsReq);
  assert.equal(getProductsRes.status, 200);
  const productsData = await getProductsRes.json();
  assert.ok(productsData.formulas.some((f: any) => f.id === createdFormula.id));
  assert.ok(productsData.supplements.some((s: any) => s.id === createdSupp.id));

  // 2. Test Schedules API
  console.log("-> Testing Nutrition Schedules API...");
  const createScheduleReq = new Request("http://localhost:3000/api/nutrition/schedules", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      babyId: baby.id,
      productId: createdSupp.id,
      frequency: "daily",
      targetDose: 1.0,
      reminderTime: "09:00",
    }),
  });
  const createScheduleRes = await schedulesRoute.POST(createScheduleReq);
  assert.equal(createScheduleRes.status, 201);
  const createdSchedule = await createScheduleRes.json();
  assert.ok(createdSchedule.id);

  const getSchedulesReq = new Request(`http://localhost:3000/api/nutrition/schedules?babyId=${baby.id}`, {
    method: "GET",
    headers: authHeaders,
  });
  const getSchedulesRes = await schedulesRoute.GET(getSchedulesReq);
  assert.equal(getSchedulesRes.status, 200);
  const schedulesData = await getSchedulesRes.json();
  assert.ok(schedulesData.schedules.some((s: any) => s.id === createdSchedule.id));

  // 3. Test Records API (with Check-in & Conflict Guard)
  console.log("-> Testing Nutrition Records API...");
  const yesterday = "2026-08-31";
  const createRecordReq = new Request("http://localhost:3000/api/nutrition/records", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      babyId: baby.id,
      productId: createdSupp.id,
      date: today,
      time: "09:15",
      dose: 1.0,
      notes: "早起随餐服用",
    }),
  });
  const createRecordRes = await recordsRoute.POST(createRecordReq);
  assert.equal(createRecordRes.status, 201);
  const recordData = await createRecordRes.json();
  assert.ok(recordData.record.id);

  // Verify schedule status for today is completed, while yesterday is not completed
  const getTodaySchedulesReq = new Request(`http://localhost:3000/api/nutrition/schedules?babyId=${baby.id}&date=${today}`, {
    method: "GET",
    headers: authHeaders,
  });
  const todaySchedulesRes = await schedulesRoute.GET(getTodaySchedulesReq);
  const todaySchedulesData = await todaySchedulesRes.json();
  const todayTargetSched = todaySchedulesData.schedules.find((s: any) => s.id === createdSchedule.id);
  assert.equal(todayTargetSched?.isCompletedToday, true);

  const getYesterdaySchedulesReq = new Request(`http://localhost:3000/api/nutrition/schedules?babyId=${baby.id}&date=${yesterday}`, {
    method: "GET",
    headers: authHeaders,
  });
  const yestSchedulesRes = await schedulesRoute.GET(getYesterdaySchedulesReq);
  const yestSchedulesData = await yestSchedulesRes.json();
  const yestTargetSched = yestSchedulesData.schedules.find((s: any) => s.id === createdSchedule.id);
  assert.equal(yestTargetSched?.isCompletedToday, false);

  // Duplicate Check-in warning test
  const dupRecordReq = new Request("http://localhost:3000/api/nutrition/records", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      babyId: baby.id,
      productId: createdSupp.id,
      date: today,
      time: "10:00",
      dose: 1.0,
      forceOverride: false,
    }),
  });
  const dupRecordRes = await recordsRoute.POST(dupRecordReq);
  // May succeed with warning or return 409 if conflict
  assert.ok([201, 409].includes(dupRecordRes.status));

  // GET Records
  const getRecordsReq = new Request(`http://localhost:3000/api/nutrition/records?babyId=${baby.id}&date=${today}`, {
    method: "GET",
    headers: authHeaders,
  });
  const getRecordsRes = await recordsRoute.GET(getRecordsReq);
  assert.equal(getRecordsRes.status, 200);
  const recordsData = await getRecordsRes.json();
  assert.ok(recordsData.records.length >= 1);

  // 4. Test Nutrition Analysis API
  console.log("-> Testing Nutrition Analysis API...");
  const getAnalysisReq = new Request(`http://localhost:3000/api/nutrition/analysis?babyId=${baby.id}&date=${today}&days=1`, {
    method: "GET",
    headers: authHeaders,
  });
  const getAnalysisRes = await analysisRoute.GET(getAnalysisReq);
  assert.equal(getAnalysisRes.status, 200);
  const analysisData = await getAnalysisRes.json();
  assert.equal(analysisData.type, "daily");
  assert.ok(analysisData.analysis.coreMetrics.vitaminD);
  assert.ok(analysisData.analysis.coreMetrics.calcium);
  // Verified compound supplement contributed 200 IU Vit D and 100 mg Calcium
  assert.ok(analysisData.analysis.coreMetrics.vitaminD.totalAmount >= 200);
  assert.ok(analysisData.analysis.coreMetrics.calcium.totalAmount >= 100);

  // 7-day trend test
  const get7dReq = new Request(`http://localhost:3000/api/nutrition/analysis?babyId=${baby.id}&date=${today}&days=7`, {
    method: "GET",
    headers: authHeaders,
  });
  const get7dRes = await analysisRoute.GET(get7dReq);
  assert.equal(get7dRes.status, 200);
  const trendData = await get7dRes.json();
  assert.equal(trendData.type, "multiday");
  assert.equal(trendData.daysCount, 7);
  assert.equal(trendData.summary.dailyTrends.length, 7);

  // Clean up test entities
  await prisma.supplementRecord.deleteMany({ where: { id: recordData.record.id } });
  await prisma.supplementSchedule.deleteMany({ where: { id: createdSchedule.id } });
  await prisma.supplementProduct.deleteMany({ where: { id: createdSupp.id } });
  await prisma.formulaProduct.deleteMany({ where: { id: createdFormula.id } });
});
