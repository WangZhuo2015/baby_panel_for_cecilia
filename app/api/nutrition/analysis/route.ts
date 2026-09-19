import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr, getLocalDayUtcRange, addDays } from "@/lib/date";
import { calculateAge } from "@/lib/age";
import { calculateDailyNutrition, calculateMultiDayNutritionTrend } from "@/lib/nutrition/engine";
import type { FormulaProduct, SupplementProduct, NutrientsMap, SupplementRecord } from "@/types/nutrition";
import type { FeedingRecord } from "@/types";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import {
  fromGrowDeskFormulaProduct,
  fromGrowDeskSupplementRecordEnriched,
  extractSupplementStateFromFoodPlan,
  type GrowDeskFormulaProduct,
  type GrowDeskSupplementRecord,
} from "@/lib/growdesk/nutrition-compat";
import { fetchCompleteList } from "@/lib/growdesk/paged-list";
import { requireData, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { fromGrowDeskFeedingRecord, type GrowDeskFeedingRecord } from "@/lib/growdesk/feeding-compat";
import { fromGrowDeskFoodRecord, type GrowDeskFoodRecord } from "@/lib/growdesk/food-compat";
import { PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const requestedBabyId = searchParams.get("babyId");
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);
      if (!baby) {
        return NextResponse.json({ error: "请提供有效的 babyId" }, { status: 400 });
      }

      const babyId = baby.id;
      const familyId = baby.familyId;
      const dateParam = searchParams.get("date");
      const date = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();
      const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "1", 10)));

      const ageSummary = calculateAge(baby.birthDate);
      const babyAgeMonths = ageSummary.months;

      // Statistics require the complete history, including records beyond the first page.
      const token = bffSession.accessToken;
      const [rawFormulas, fpRes, rawFeedings, rawSupps, rawFoods] = await Promise.all([
        fetchCompleteList<GrowDeskFormulaProduct>(growdeskFetch, token, `/api/v1/families/${familyId}/nutrition/products`),
        growdeskFetch<{ planData?: unknown }>(`/api/v1/babies/${babyId}/food-plan`, { accessToken: token }),
        fetchCompleteList<GrowDeskFeedingRecord>(growdeskFetch, token, `/api/v1/babies/${babyId}/records/feeding`),
        fetchCompleteList<GrowDeskSupplementRecord>(growdeskFetch, token, `/api/v1/babies/${babyId}/records/supplement`),
        fetchCompleteList<GrowDeskFoodRecord>(growdeskFetch, token, `/api/v1/babies/${babyId}/records/food`),
      ]);
      const planData = requireData(fpRes)?.planData || {};
      const suppState = extractSupplementStateFromFoodPlan(planData);

      const allKnownSupplements: SupplementProduct[] = [
        ...suppState.supplementProducts,
        ...PRESET_SUPPLEMENT_PRODUCTS.map((p, idx) => ({
          ...p,
          id: (p as any).id || `preset_${idx}`,
          familyId,
        })),
      ];

      const supplementProductsMap: Record<string, SupplementProduct> = {};
      for (const sp of allKnownSupplements) {
        supplementProductsMap[sp.id] = sp;
      }

      const formulaProductsMap: Record<string, FormulaProduct> = {};
      for (const rawF of rawFormulas) {
        formulaProductsMap[rawF.id] = fromGrowDeskFormulaProduct(rawF, {
          defaultFormulaId: suppState.defaultFormulaId,
          customNutrients: suppState.customFormulaNutrients?.[rawF.id],
        });
      }

      const adaptedAllFeedings = rawFeedings.map(fromGrowDeskFeedingRecord)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const adaptedAllSupplements = rawSupps.map((r) =>
        fromGrowDeskSupplementRecordEnriched(r, allKnownSupplements)
      ).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

      const adaptedAllFoodLogs = rawFoods.map((raw) => {
        const food = fromGrowDeskFoodRecord(raw);
        return {
          id: food.id, date: food.date, time: food.time || "12:00",
          foods: raw.foodItemIds, portion: food.portion || "most",
          acceptance: food.acceptance ?? 5, babyState: food.babyState || "normal",
        };
      }).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

      if (days === 1) {
        const { start, end } = getLocalDayUtcRange(date);
        const dayFeedings = adaptedAllFeedings.filter(
          (f) => f.timestamp >= start && f.timestamp < end
        );
        const daySupplements = adaptedAllSupplements.filter((s) => s.date === date);
        const dayFoodLogs = adaptedAllFoodLogs.filter((fl) => fl.date === date);

        const analysis = calculateDailyNutrition({
          date,
          babyAgeMonths,
          feedings: dayFeedings,
          supplements: daySupplements,
          foodLogs: dayFoodLogs,
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
        const startDate = addDays(date, -(days - 1));
        const dateList: string[] = [];
        for (let i = 0; i < days; i++) {
          dateList.push(addDays(startDate, i));
        }

        const dailyDataList = dateList.map((d) => {
          const { start: dStart, end: dEnd } = getLocalDayUtcRange(d);
          const dayFeedings = adaptedAllFeedings.filter(
            (f) => f.timestamp >= dStart && f.timestamp < dEnd
          );
          const daySupplements = adaptedAllSupplements.filter((s) => s.date === d);
          const dayFoodLogs = adaptedAllFoodLogs.filter((fl) => fl.date === d);

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
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
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
    if (GROWDESK_CONFIG.enabled) return bridgeErrorResponse(error);
    console.error("GET /api/nutrition/analysis error:", error);
    return NextResponse.json({ error: "获取营养分析数据失败" }, { status: 500 });
  }
}
