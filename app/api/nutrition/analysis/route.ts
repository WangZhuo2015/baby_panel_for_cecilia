import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr, getLocalDayUtcRange, addDays } from "@/lib/date";
import { calculateAge } from "@/lib/age";
import { calculateDailyNutrition, calculateMultiDayNutritionTrend } from "@/lib/nutrition/engine";
import type { FormulaProduct, SupplementProduct, NutrientsMap, SupplementRecord } from "@/types/nutrition";
import type { FeedingRecord } from "@/types";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user.id, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const baby = babyResult.baby;
    const dateParam = searchParams.get("date");
    const date = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "1", 10)));

    const ageSummary = calculateAge(baby.birthDate);
    const babyAgeMonths = ageSummary.months;

    // 获取家庭拥有的所有奶粉和补剂产品
    const [familyFormulas, familySupplements] = await Promise.all([
      prisma.formulaProduct.findMany({ where: { familyId: baby.familyId } }),
      prisma.supplementProduct.findMany({ where: { familyId: baby.familyId } }),
    ]);

    const formulaProductsMap: Record<string, FormulaProduct> = {};
    for (const f of familyFormulas) {
      formulaProductsMap[f.id] = {
        id: f.id,
        familyId: f.familyId,
        name: f.name,
        brand: f.brand,
        stage: f.stage,
        scoopWeightG: f.scoopWeightG,
        waterPerScoopMl: f.waterPerScoopMl,
        reconstitutionRatio: f.reconstitutionRatio,
        servingSizeUnit: f.servingSizeUnit,
        nutrients: (f.nutrientsJson ? JSON.parse(f.nutrientsJson) : {}) as NutrientsMap,
        notes: f.notes,
        isActive: f.isActive,
      };
    }

    const supplementProductsMap: Record<string, SupplementProduct> = {};
    for (const s of familySupplements) {
      supplementProductsMap[s.id] = {
        id: s.id,
        familyId: s.familyId,
        name: s.name,
        brand: s.brand,
        dosageForm: s.dosageForm,
        unitName: s.unitName,
        defaultDose: s.defaultDose,
        nutrients: (s.nutrientsJson ? JSON.parse(s.nutrientsJson) : {}) as NutrientsMap,
        notes: s.notes,
        isActive: s.isActive,
      };
    }

    if (days === 1) {
      // 单日分析
      const { start, end } = getLocalDayUtcRange(date);
      const [feedings, supplements, foodLogs] = await Promise.all([
        prisma.feedingRecord.findMany({
          where: { babyId: baby.id, timestamp: { gte: start, lt: end } },
          orderBy: { timestamp: "asc" },
        }),
        prisma.supplementRecord.findMany({
          where: { babyId: baby.id, date },
          include: { product: true },
          orderBy: { time: "asc" },
        }),
        prisma.foodLogRecord.findMany({
          where: { babyId: baby.id, date },
          orderBy: { time: "asc" },
        }),
      ]);

      const adaptedSupplements: SupplementRecord[] = supplements.map((s) => ({
        id: s.id,
        babyId: s.babyId,
        productId: s.productId,
        product: supplementProductsMap[s.productId],
        date: s.date,
        time: s.time,
        dose: s.dose,
        unitName: s.unitName,
        notes: s.notes,
      }));

      const adaptedFeedings: FeedingRecord[] = feedings.map((f) => ({
        id: f.id,
        timestamp: f.timestamp,
        type: f.type as any,
        amountMl: f.amountMl,
        leftMinutes: f.leftMinutes,
        rightMinutes: f.rightMinutes,
        spitUp: f.spitUp,
        notes: f.notes || undefined,
        formulaProductId: f.formulaProductId,
      }));

      const adaptedFoodLogs = foodLogs.map((fl) => ({
        id: fl.id,
        date: fl.date,
        time: fl.time,
        foods: fl.foods,
        portion: fl.portion,
        acceptance: fl.acceptance,
        babyState: fl.babyState,
      }));

      const analysis = calculateDailyNutrition({
        date,
        babyAgeMonths,
        feedings: adaptedFeedings,
        supplements: adaptedSupplements,
        foodLogs: adaptedFoodLogs,
        formulaProductsMap,
        supplementProductsMap,
      });

      return NextResponse.json({
        type: "daily",
        date,
        babyAgeMonths,
        analysis,
      });
    } else {
      // 多日周期趋势 (7d, 30d)
      const startDate = addDays(date, -(days - 1));
      const rangeStartUtc = getLocalDayUtcRange(startDate).start;
      const rangeEndUtc = getLocalDayUtcRange(date).end;

      const [feedings, supplements, foodLogs] = await Promise.all([
        prisma.feedingRecord.findMany({
          where: { babyId: baby.id, timestamp: { gte: rangeStartUtc, lt: rangeEndUtc } },
          orderBy: { timestamp: "asc" },
        }),
        prisma.supplementRecord.findMany({
          where: { babyId: baby.id, date: { gte: startDate, lte: date } },
          include: { product: true },
          orderBy: { date: "asc" },
        }),
        prisma.foodLogRecord.findMany({
          where: { babyId: baby.id, date: { gte: startDate, lte: date } },
          orderBy: [{ date: "asc" }, { time: "asc" }],
        }),
      ]);

      // 按日期分组
      const dateList: string[] = [];
      for (let i = 0; i < days; i++) {
        dateList.push(addDays(startDate, i));
      }

      const dailyDataList = dateList.map((d) => {
        const { start: dStart, end: dEnd } = getLocalDayUtcRange(d);
        const dayFeedings = feedings
          .filter((f) => f.timestamp >= dStart && f.timestamp < dEnd)
          .map((f) => ({
            id: f.id,
            timestamp: f.timestamp,
            type: f.type as any,
            amountMl: f.amountMl,
            leftMinutes: f.leftMinutes,
            rightMinutes: f.rightMinutes,
            spitUp: f.spitUp,
            notes: f.notes || undefined,
            formulaProductId: f.formulaProductId,
          }));

        const daySupplements = supplements
          .filter((s) => s.date === d)
          .map((s) => ({
            id: s.id,
            babyId: s.babyId,
            productId: s.productId,
            product: supplementProductsMap[s.productId],
            date: s.date,
            time: s.time,
            dose: s.dose,
            unitName: s.unitName,
            notes: s.notes,
          }));

        const dayFoodLogs = foodLogs
          .filter((fl) => fl.date === d)
          .map((fl) => ({
            id: fl.id,
            date: fl.date,
            time: fl.time,
            foods: fl.foods,
            portion: fl.portion,
            acceptance: fl.acceptance,
            babyState: fl.babyState,
          }));

        return {
          date: d,
          feedings: dayFeedings,
          supplements: daySupplements,
          foodLogs: dayFoodLogs,
        };
      });

      const summary = calculateMultiDayNutritionTrend({
        babyAgeMonths,
        dailyDataList,
        formulaProductsMap,
        supplementProductsMap,
      });

      // 计算今日分析
      const todayDailyData = dailyDataList.find((d) => d.date === date) || {
        date,
        feedings: [],
        supplements: [],
        foodLogs: [],
      };
      const todayAnalysis = calculateDailyNutrition({
        date,
        babyAgeMonths,
        feedings: todayDailyData.feedings,
        supplements: todayDailyData.supplements,
        foodLogs: todayDailyData.foodLogs,
        formulaProductsMap,
        supplementProductsMap,
      });

      return NextResponse.json({
        type: "multiday",
        daysCount: days,
        startDate,
        endDate: date,
        babyAgeMonths,
        summary,
        todayAnalysis,
      });
    }
  } catch (error: any) {
    console.error("GET /api/nutrition/analysis error:", error);
    return NextResponse.json({ error: "获取营养分析数据失败" }, { status: 500 });
  }
}
