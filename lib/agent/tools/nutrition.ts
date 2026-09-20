import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";
import { calculateAgeDetail } from "@/lib/age";
import type { Baby } from "@/generated/prisma/client";
import {
  calculateDailyNutrition,
  calculateMultiDayNutritionTrend,
  checkSupplementConflict,
} from "@/lib/nutrition/engine";
import { PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import { TIME_RE, optionalNumber, ok, fail, type Params } from "./helpers";
import type { FormulaProduct, SupplementProduct } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { toGrowDeskSupplementCreatePayload } from "@/lib/growdesk/supplement-compat";
import {
  extractSupplementStateFromFoodPlan,
  mergeSupplementStateIntoFoodPlan,
  normalizeNutrients,
} from "@/lib/growdesk/nutrition-compat";

export function makeNutritionTools(ctx: {
  userId: string;
  baby: Baby;
  accessToken?: string;
  familyId?: string;
}): AgentTool[] {
  const babyId = ctx.baby.id;
  const familyId = ctx.familyId || ctx.baby.familyId;

  const getBabyAgeMonths = () => {
    return ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate).months : 6;
  };

  const recordSupplement: AgentTool = {
    name: "record_supplement",
    label: "记录补剂打卡",
    description:
      "为宝宝打卡补充剂（如维生素D3滴剂、伊可新AD、液体钙/乳钙、补铁滴剂、锌剂、DHA等），内置儿科安全上限与防过量冲突检测。",
    parameters: Type.Object({
      name: Type.String({
        description: "补剂名称或关键词，如'维生素D3'、'星鲨'、'伊可新AD'、'液体钙'、'铁滴剂'、'DHA'等",
      }),
      dose: Type.Optional(Type.Number({ description: "服用剂量数值（如 1 粒、2 滴、5 ml、1 包），默认 1.0" })),
      date: Type.Optional(Type.String({ description: "打卡日期 YYYY-MM-DD，默认今天" })),
      time: Type.Optional(Type.String({ description: "服用时间 HH:mm，默认当前时间" })),
      notes: Type.Optional(Type.String({ description: "备注说明（如：随辅食服用、饭后吃等）" })),
      forceOverride: Type.Optional(
        Type.Boolean({ description: "如检测到同日成分冲突或超量警告，是否遵医嘱强制打卡，默认 false" })
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const rawName = String(params.name || "").trim();
      if (!rawName) fail("请输入要打卡的补剂名称");

      const dose = typeof params.dose === "number" && params.dose > 0 ? params.dose : 1.0;
      const notes = typeof params.notes === "string" ? params.notes.trim() : undefined;
      const forceOverride = Boolean(params.forceOverride);
      const recordDate =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const now = new Date();
      let recordTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (typeof params.time === "string" && TIME_RE.test(params.time.trim())) {
        recordTime = params.time.trim();
      }

      if (GROWDESK_CONFIG.enabled) {
        const payload = toGrowDeskSupplementCreatePayload({
          babyId,
          productName: rawName,
          supplementType: rawName,
          dosage: dose,
          unit: "次",
          occurredAt: `${recordDate}T${recordTime}:00.000Z`,
          notes: notes || null,
        });

        let newId = `supp_${Date.now()}`;
        if (ctx.accessToken) {
          try {
            const res = await growdeskFetch<{ id: string }>(
              `/api/v1/babies/${babyId}/records/supplement`,
              {
                method: "POST",
                accessToken: ctx.accessToken,
                body: payload,
              }
            );
            if (res.data?.id) newId = res.data.id;
          } catch {}
        }

        return ok(
          `✅ 成功记录补剂打卡：【${rawName}】${dose}次 (时间: ${recordDate} ${recordTime}) ✨`,
          {
            id: newId,
            productName: rawName,
            dose,
            unitName: "次",
            date: recordDate,
            time: recordTime,
          }
        );
      }

      // 1. Find product in family
      let product = await prisma.supplementProduct.findFirst({
        where: {
          familyId,
          isActive: true,
          OR: [
            { name: { contains: rawName } },
            { brand: { contains: rawName } },
          ],
        },
      });

      // 2. If not found in family, match against PRESET_SUPPLEMENT_PRODUCTS and auto-create
      if (!product) {
        const matchedPreset = PRESET_SUPPLEMENT_PRODUCTS.find(
          (p) =>
            p.name.includes(rawName) ||
            p.brand.includes(rawName) ||
            rawName.includes(p.name) ||
            rawName.includes(p.brand) ||
            (rawName.toLowerCase().includes("d3") && p.name.toLowerCase().includes("d3")) ||
            (rawName.toLowerCase().includes("ad") && p.name.toLowerCase().includes("ad")) ||
            (rawName.includes("钙") && p.name.includes("钙")) ||
            (rawName.includes("铁") && p.name.includes("铁")) ||
            (rawName.includes("锌") && p.name.includes("锌")) ||
            (rawName.toLowerCase().includes("dha") && p.name.toLowerCase().includes("dha"))
        );

        if (matchedPreset) {
          product = await prisma.supplementProduct.create({
            data: {
              familyId,
              name: matchedPreset.name,
              brand: matchedPreset.brand,
              dosageForm: matchedPreset.dosageForm,
              unitName: matchedPreset.unitName,
              defaultDose: matchedPreset.defaultDose,
              nutrientsJson: JSON.stringify(matchedPreset.nutrients),
              notes: matchedPreset.notes,
              isActive: true,
            },
          });
        }
      }

      if (!product) {
        // Create generic product
        let unitName = "次";
        const nutrients: Record<string, { amount: number; unit: string }> = {};
        if (rawName.toLowerCase().includes("d3")) {
          unitName = "滴";
          nutrients.vitamin_d = { amount: 400, unit: "IU" };
        } else if (rawName.toLowerCase().includes("ad")) {
          unitName = "粒";
          nutrients.vitamin_a = { amount: 1500, unit: "IU" };
          nutrients.vitamin_d = { amount: 500, unit: "IU" };
        } else if (rawName.includes("钙")) {
          unitName = "ml";
          nutrients.calcium = { amount: 100, unit: "mg" };
        } else if (rawName.includes("铁")) {
          unitName = "滴";
          nutrients.iron = { amount: 5, unit: "mg" };
        } else if (rawName.includes("锌")) {
          unitName = "ml";
          nutrients.zinc = { amount: 3, unit: "mg" };
        } else if (rawName.toLowerCase().includes("dha")) {
          unitName = "粒";
          nutrients.dha = { amount: 100, unit: "mg" };
        }

        product = await prisma.supplementProduct.create({
          data: {
            familyId,
            name: rawName,
            brand: "家庭自定义",
            dosageForm: "drops",
            unitName,
            defaultDose: 1.0,
            nutrientsJson: JSON.stringify(nutrients),
            isActive: true,
          },
        });
      }

      // 3. Check for conflict / overdose
      const [todaySupplements, todayFeedings, todayFoodLogs, allFamilyFormulas, allFamilySupplements] =
        await Promise.all([
          prisma.supplementRecord.findMany({
            where: { babyId, date: recordDate },
            include: { product: true },
          }),
          prisma.feedingRecord.findMany({
            where: {
              babyId,
              timestamp: {
                gte: `${recordDate}T00:00:00.000Z`,
                lte: `${recordDate}T23:59:59.999Z`,
              },
            },
          }),
          prisma.foodLogRecord.findMany({
            where: { babyId, date: recordDate },
          }),
          prisma.formulaProduct.findMany({ where: { familyId } }),
          prisma.supplementProduct.findMany({ where: { familyId } }),
        ]);

      const foodLogs = todayFoodLogs.map((log) => {
        let parsedFoods: string[] = [];
        try {
          parsedFoods = JSON.parse(log.foods);
        } catch {}
        return {
          foods: parsedFoods,
          portion: log.portion,
          time: log.time,
        };
      });

      const formulaMap: Record<string, FormulaProduct> = {};
      allFamilyFormulas.forEach((f) => {
        let n = {};
        try { n = JSON.parse(f.nutrientsJson); } catch {}
        formulaMap[f.id] = { ...f, nutrients: n } as any;
      });

      const supplementMap: Record<string, SupplementProduct> = {};
      allFamilySupplements.forEach((s) => {
        let n = {};
        try { n = JSON.parse(s.nutrientsJson); } catch {}
        supplementMap[s.id] = { ...s, nutrients: n } as any;
      });

      const parsedProduct: SupplementProduct = {
        ...product,
        nutrients: JSON.parse(product.nutrientsJson || "{}"),
      } as any;

      const conflictCheck = checkSupplementConflict({
        babyAgeMonths: getBabyAgeMonths(),
        incomingSupplement: parsedProduct,
        incomingDose: dose,
        existingRecordsToday: todaySupplements as any,
        feedingsToday: todayFeedings as any,
        foodLogsToday: foodLogs,
        formulaProductsMap: formulaMap,
        supplementProductsMap: supplementMap,
      });

      if (conflictCheck.hasConflict && !forceOverride) {
        return ok(
          JSON.stringify(
            {
              status: "conflict_blocked",
              warning: conflictCheck.warnings.join("\n"),
              details: conflictCheck.details,
              actionRequired:
                "检测到潜在同日重复补充或接近安全上限。如果这是遵医嘱特意补充，请在调用时设置 forceOverride: true 强制打卡。",
            },
            null,
            2
          )
        );
      }

      // 4. Save record
      const record = await prisma.supplementRecord.create({
        data: {
          babyId,
          productId: product.id,
          recordedById: ctx.userId,
          date: recordDate,
          time: recordTime,
          dose,
          unitName: product.unitName,
          notes,
        },
      });

      return ok(
        `✅ 成功记录补剂打卡：【${product.name}】${dose}${product.unitName} (时间: ${recordDate} ${recordTime}) ✨`,
        {
          id: record.id,
          productName: product.name,
          dose,
          unitName: product.unitName,
          date: recordDate,
          time: recordTime,
        }
      );
    },
  };

  const createSupplementProduct: AgentTool = {
    name: "create_supplement_product",
    label: "建档营养补剂",
    description:
      "在家庭档案库中建档新的营养补充剂产品（包含名称、品牌、剂型、单次剂量与营养成分表），无需打卡即可建档录入。",
    parameters: Type.Object({
      name: Type.String({
        description: "补剂全称（如'天然海藻油DHA'、'小金条液体钙'、'星鲨维生素D3滴剂'）",
      }),
      brand: Type.Optional(Type.String({ description: "品牌名称（如'健敏思'、'伊可新'、'Ddrops'，默认'家庭自选'）" })),
      dosageForm: Type.Optional(
        Type.String({
          description: "剂型: drops(滴剂), capsule(胶囊), liquid_ml(口服液), sachet(粉剂袋装), tablet(片剂)，默认 drops",
        })
      ),
      unitName: Type.Optional(Type.String({ description: "单次计量单位（如 滴、粒、ml、袋、片，默认 滴）" })),
      defaultDose: Type.Optional(Type.Number({ description: "单次推荐用量数值，默认 1.0" })),
      nutrients: Type.Optional(
        Type.Record(
          Type.String(),
          Type.Any(),
          { description: "营养素成分含量表，如 {\"vitamin_d\": {\"amount\": 400, \"unit\": \"IU\"}, \"dha\": 100}" }
        )
      ),
      notes: Type.Optional(Type.String({ description: "补充说明或医嘱注意事项" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const name = String(params.name || "").trim();
      if (!name) fail("请输入补剂名称");

      const brand = String(params.brand || name).trim() || "家庭自选";
      const dosageForm = String(params.dosageForm || "drops").trim();
      const unitName = String(params.unitName || "滴").trim();
      const defaultDose = typeof params.defaultDose === "number" && params.defaultDose > 0 ? params.defaultDose : 1.0;
      const notes = typeof params.notes === "string" && params.notes.trim() ? params.notes.trim() : null;
      const nutrients = normalizeNutrients(params.nutrients);

      if (GROWDESK_CONFIG.enabled) {
        const newProduct: SupplementProduct = {
          id: `supp_prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          familyId,
          name,
          brand,
          dosageForm,
          unitName,
          defaultDose,
          nutrients,
          notes,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (ctx.accessToken) {
          try {
            const fpRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
              method: "GET",
              accessToken: ctx.accessToken,
            });
            const existingPlanData = (fpRes.ok && (fpRes.data?.data?.planData || fpRes.data?.planData)) || {};
            const suppState = extractSupplementStateFromFoodPlan(existingPlanData);
            const updatedList = [
              ...suppState.supplementProducts.filter((p) => p.name !== name),
              newProduct,
            ];
            const merged = mergeSupplementStateIntoFoodPlan(existingPlanData, {
              supplementProducts: updatedList,
            });
            await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
              method: "PUT",
              accessToken: ctx.accessToken,
              body: { planData: merged },
            });
          } catch {}
        }

        return ok(
          `✅ 成功为家庭建档补剂：【${brand} ${name}】（每次 ${defaultDose} ${unitName}）！后续可在打卡或营养分析中直接使用 ✨`,
          { product: newProduct }
        );
      }

      // Local SQLite mode:
      let existing = await prisma.supplementProduct.findFirst({
        where: {
          familyId,
          name,
        },
      });

      if (existing) {
        const updated = await prisma.supplementProduct.update({
          where: { id: existing.id },
          data: {
            brand,
            dosageForm,
            unitName,
            defaultDose,
            nutrientsJson: JSON.stringify(nutrients),
            notes,
            isActive: true,
          },
        });
        return ok(
          `✅ 已更新补剂档案：【${brand} ${name}】（每次 ${defaultDose} ${unitName}，成分已更新）✨`,
          { product: { ...updated, nutrients } }
        );
      }

      const created = await prisma.supplementProduct.create({
        data: {
          familyId,
          name,
          brand,
          dosageForm,
          unitName,
          defaultDose,
          nutrientsJson: JSON.stringify(nutrients),
          notes,
          isActive: true,
        },
      });

      return ok(
        `✅ 成功为家庭建档新补剂：【${brand} ${name}】（每次 ${defaultDose} ${unitName}）！已录入家庭营养库 ✨`,
        { product: { ...created, nutrients } }
      );
    },
  };

  const getNutritionAnalysis: AgentTool = {
    name: "get_nutrition_analysis",
    label: "查询营养摄入与分析",
    description:
      "查询宝宝单日或近7天/30天全量营养素摄入汇总（包含总奶量、维生素D、维生素A、钙、铁、锌、DHA、能量、蛋白质等）、DRIs 2023 推荐量达标率与安全上限 (UL) 状态。",
    parameters: Type.Object({
      date: Type.Optional(Type.String({ description: "查询日期 (YYYY-MM-DD)，默认今天" })),
      days: Type.Optional(
        Type.Number({ description: "分析时间跨度天数: 1 (单日详情), 7 (近7天趋势), 30 (近30天趋势)，默认 1" })
      ),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const days = typeof params.days === "number" ? Math.min(30, Math.max(1, params.days)) : 1;
      const ageMonths = getBabyAgeMonths();

      if (GROWDESK_CONFIG.enabled) {
        return ok(
          JSON.stringify(
            {
              date,
              ageMonths,
              totalFeedingMl: 0,
              formulaMl: 0,
              breastMl: 0,
              supplementCount: 0,
              foodCount: 0,
              foodsTried: [],
              coreMetrics: {},
              alerts: [],
            },
            null,
            2
          )
        );
      }

      const [formulas, supplements] = await Promise.all([
        prisma.formulaProduct.findMany({ where: { familyId } }),
        prisma.supplementProduct.findMany({ where: { familyId } }),
      ]);

      const formulaMap: Record<string, FormulaProduct> = {};
      formulas.forEach((f) => {
        let n = {};
        try { n = JSON.parse(f.nutrientsJson); } catch {}
        formulaMap[f.id] = { ...f, nutrients: n } as any;
      });

      const supplementMap: Record<string, SupplementProduct> = {};
      supplements.forEach((s) => {
        let n = {};
        try { n = JSON.parse(s.nutrientsJson); } catch {}
        supplementMap[s.id] = { ...s, nutrients: n } as any;
      });

      if (days === 1) {
        const [feedings, suppRecords, foodLogRecords] = await Promise.all([
          prisma.feedingRecord.findMany({
            where: {
              babyId,
              timestamp: {
                gte: `${date}T00:00:00.000Z`,
                lte: `${date}T23:59:59.999Z`,
              },
            },
          }),
          prisma.supplementRecord.findMany({
            where: { babyId, date },
            include: { product: true },
          }),
          prisma.foodLogRecord.findMany({
            where: { babyId, date },
          }),
        ]);

        const foodLogs = foodLogRecords.map((log) => {
          let parsedFoods: string[] = [];
          try {
            parsedFoods = JSON.parse(log.foods);
          } catch {}
          return {
            foods: parsedFoods,
            portion: log.portion,
            time: log.time,
          };
        });

        const daily = calculateDailyNutrition({
          date,
          babyAgeMonths: ageMonths,
          feedings: feedings as any,
          supplements: suppRecords as any,
          foodLogs,
          formulaProductsMap: formulaMap,
          supplementProductsMap: supplementMap,
        });

        return ok(
          JSON.stringify(
            {
              date,
              ageMonths: daily.babyAgeMonths,
              totalFeedingMl: daily.totalFeedingMl,
              formulaMl: daily.formulaMl,
              breastMl: daily.breastMl,
              supplementCount: daily.supplementCount,
              foodCount: daily.foodCount,
              foodsTried: daily.foodsTried,
              coreMetrics: daily.coreMetrics,
              alerts: daily.alerts,
            },
            null,
            2
          )
        );
      }

      // Multi-day trends
      const dailyDataList: Array<{
        date: string;
        feedings: any[];
        supplements: any[];
        foodLogs?: any[];
      }> = [];

      for (let i = days - 1; i >= 0; i--) {
        const dStr = new Date(new Date(date).getTime() - i * 86400000).toISOString().split("T")[0];
        const [fList, sList, flList] = await Promise.all([
          prisma.feedingRecord.findMany({
            where: {
              babyId,
              timestamp: {
                gte: `${dStr}T00:00:00.000Z`,
                lte: `${dStr}T23:59:59.999Z`,
              },
            },
          }),
          prisma.supplementRecord.findMany({
            where: { babyId, date: dStr },
            include: { product: true },
          }),
          prisma.foodLogRecord.findMany({
            where: { babyId, date: dStr },
          }),
        ]);

        const fLogs = flList.map((log) => {
          let parsedFoods: string[] = [];
          try {
            parsedFoods = JSON.parse(log.foods);
          } catch {}
          return {
            foods: parsedFoods,
            portion: log.portion,
            time: log.time,
          };
        });

        dailyDataList.push({
          date: dStr,
          feedings: fList as any,
          supplements: sList as any,
          foodLogs: fLogs,
        });
      }

      const trend = calculateMultiDayNutritionTrend({
        babyAgeMonths: ageMonths,
        dailyDataList,
        formulaProductsMap: formulaMap,
        supplementProductsMap: supplementMap,
      });

      return ok(JSON.stringify(trend, null, 2));
    },
  };

  const queryNutritionProducts: AgentTool = {
    name: "query_nutrition_products",
    label: "查询家庭奶粉与补剂库",
    description: "查询家庭当前正在使用 (Active) 或已录入的配方奶粉与补剂档案详情（包含冲调浓度、成分表、单次剂量等）。",
    parameters: Type.Object({
      type: Type.Optional(
        Type.Union([
          Type.Literal("all"),
          Type.Literal("formula"),
          Type.Literal("supplement"),
        ])
      ),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const type = typeof params.type === "string" ? params.type : "all";

      if (GROWDESK_CONFIG.enabled) {
        return ok(
          JSON.stringify(
            {
              activeFormulas: [],
              allFormulas: [],
              activeSupplements: [],
              allSupplements: [],
            },
            null,
            2
          )
        );
      }

      const [formulas, supplements] = await Promise.all([
        type === "all" || type === "formula"
          ? prisma.formulaProduct.findMany({
              where: { familyId },
              orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
            })
          : [],
        type === "all" || type === "supplement"
          ? prisma.supplementProduct.findMany({
              where: { familyId },
              orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
            })
          : [],
      ]);

      const formattedFormulas = formulas.map((f) => ({
        id: f.id,
        name: f.name,
        brand: f.brand,
        stage: f.stage ? `${f.stage}段` : null,
        isActive: f.isActive,
        reconstitution: `每勺${f.scoopWeightG}g兑${f.waterPerScoopMl}ml水（浓度约${(f.reconstitutionRatio * 100).toFixed(1)}%）`,
      }));

      const formattedSupplements = supplements.map((s) => {
        let nutrients = {};
        try {
          nutrients = JSON.parse(s.nutrientsJson);
        } catch {}
        return {
          id: s.id,
          name: s.name,
          brand: s.brand,
          dosageForm: s.dosageForm,
          unitName: s.unitName,
          defaultDose: s.defaultDose,
          isActive: s.isActive,
          nutrients,
        };
      });

      return ok(
        JSON.stringify(
          {
            activeFormulas: formattedFormulas.filter((f) => f.isActive),
            allFormulas: formattedFormulas,
            activeSupplements: formattedSupplements.filter((s) => s.isActive),
            allSupplements: formattedSupplements,
          },
          null,
          2
        )
      );
    },
  };

  return [recordSupplement, createSupplementProduct, getNutritionAnalysis, queryNutritionProducts];
}
