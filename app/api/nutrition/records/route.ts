import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, getLocalTimeStr, isValidDateStr, getLocalDayUtcRange, localTimeToUtcIso } from "@/lib/date";
import { calculateAge } from "@/lib/age";
import { checkSupplementConflict } from "@/lib/nutrition/engine";
import type { SupplementRecord, SupplementProduct, FormulaProduct, NutrientsMap } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby, loadWebIdentity } from "@/lib/growdesk/bridge-identity";
import {
  fromGrowDeskSupplementRecordEnriched,
  formatSupplementAmount,
  encodeProductIdInNotes,
  findMatchingSupplementProduct,
  extractSupplementStateFromFoodPlan,
  fromGrowDeskFormulaProduct,
  type GrowDeskSupplementRecord,
  fromGrowDeskSupplementProduct,
  type GrowDeskSupplementProduct,
  type GrowDeskFormulaProduct,
} from "@/lib/growdesk/nutrition-compat";
import { PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import crypto from "node:crypto";
import { fetchCompleteList } from "@/lib/growdesk/paged-list";
import { BridgeError, bridgeErrorResponse, isoTimestamp, requireData, pathId } from "@/lib/growdesk/bridge-protocol";
import { projectLegacySupplementRecord, wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";

function requireUpstreamObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", `GrowDesk 返回了无效的${label}`);
  }
  return value as Record<string, unknown>;
}

function requireScopedFoodPlan(value: unknown, babyId: string): Record<string, unknown> {
  const plan = requireUpstreamObject(value, "辅食计划");
  if (plan.babyId !== babyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他宝宝的辅食计划");
  }
  return plan;
}

function requireScopedFormula(value: unknown, familyId: string): GrowDeskFormulaProduct {
  const product = requireUpstreamObject(value, "配方奶产品");
  if (product.familyId !== familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "GrowDesk 返回了其他家庭的配方奶产品");
  }
  return product as unknown as GrowDeskFormulaProduct;
}

function requireScopedTimedRecord(
  value: unknown,
  babyId: string,
  familyId: string,
  label: string,
): Record<string, unknown> {
  const record = requireUpstreamObject(value, label);
  if (record.babyId !== babyId || record.familyId !== familyId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", `GrowDesk 返回了其他宝宝或家庭的${label}`);
  }
  try {
    // The compatibility mapper has a legacy fallback for malformed times. A
    // canonical response must never reach that fallback or become a fabricated
    // successful record.
    isoTimestamp(record.occurredAt);
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMESTAMP", `GrowDesk 返回了无效的${label}时间`);
  }
  return record;
}

function requireScopedSupplementRecord(value: unknown, babyId: string, familyId: string): GrowDeskSupplementRecord {
  return requireScopedTimedRecord(value, babyId, familyId, "补剂记录") as unknown as GrowDeskSupplementRecord;
}

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const extended = wantsExtendedRepresentation(request);
      const requestedBabyId = searchParams.get("babyId");
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);
      if (!baby) {
        return NextResponse.json({ error: "请提供有效的 babyId" }, { status: 400 });
      }
      const babyId = baby.id;
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));
      const date = searchParams.get("date");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const productId = searchParams.get("productId");

      if (date && !isValidDateStr(date)) {
        return NextResponse.json({ error: "date 格式必须为 YYYY-MM-DD" }, { status: 400 });
      }

      if ((startDate && !isValidDateStr(startDate)) || (endDate && !isValidDateStr(endDate)) || (startDate && endDate && startDate > endDate)) {
        return NextResponse.json({ error: "日期范围无效" }, { status: 400 });
      }

      const [rawList, rawProducts] = await Promise.all([
        fetchCompleteList<GrowDeskSupplementRecord>(growdeskFetch, bffSession.accessToken, `/api/v1/babies/${pathId(babyId)}/records/supplement`),
        fetchCompleteList<GrowDeskSupplementProduct>(
          growdeskFetch,
          bffSession.accessToken,
          `/api/v1/families/${pathId(baby.familyId)}/nutrition/supplement-products?includeArchived=true`,
        ),
      ]);

      const scopedList = rawList.map((record) => requireScopedSupplementRecord(record, babyId, baby.familyId));
      const allKnownProducts: SupplementProduct[] = [
        ...rawProducts.map(fromGrowDeskSupplementProduct),
        ...PRESET_SUPPLEMENT_PRODUCTS.map((p, idx) => ({
          ...p,
          id: (p as any).id || `preset_${idx}`,
          familyId: baby.familyId,
        })),
      ];

      let records = scopedList.map((r) => fromGrowDeskSupplementRecordEnriched(r, allKnownProducts));

      if (date) {
        records = records.filter((r) => r.date === date);
      } else if (startDate && endDate) {
        records = records.filter((r) => r.date >= startDate && r.date <= endDate);
      }
      if (productId) {
        records = records.filter((r) => r.productId === productId);
      }

      const limited = records.slice(0, limit);
      return NextResponse.json({ records: extended ? limited : limited.map(projectLegacySupplementRecord) });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const babyId = babyResult.baby.id;
    const date = searchParams.get("date");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const productId = searchParams.get("productId");
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const where: any = { babyId };
    if (date) {
      if (!isValidDateStr(date)) {
        return NextResponse.json({ error: "date 格式必须为 YYYY-MM-DD" }, { status: 400 });
      }
      where.date = date;
    } else if (startDate && endDate) {
      where.date = { gte: startDate, lte: endDate };
    }
    if (productId) {
      where.productId = productId;
    }

    const dbRecords = await prisma.supplementRecord.findMany({
      where,
      include: {
        product: true,
      },
      orderBy: [{ date: "desc" }, { time: "desc" }],
      take: limit,
    });

    const records: SupplementRecord[] = dbRecords.map((r) => {
      const p = r.product;
      const product: SupplementProduct = {
        id: p.id,
        familyId: p.familyId,
        name: p.name,
        brand: p.brand,
        dosageForm: p.dosageForm,
        unitName: p.unitName,
        defaultDose: p.defaultDose,
        nutrients: (p.nutrientsJson ? JSON.parse(p.nutrientsJson) : {}) as NutrientsMap,
        notes: p.notes,
        isActive: p.isActive,
      };

      return {
        id: r.id,
        babyId: r.babyId,
        productId: r.productId,
        product,
        clientId: r.clientId,
        recordedById: r.recordedById,
        date: r.date,
        time: r.time,
        dose: r.dose,
        unitName: r.unitName,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ records });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("GET /api/nutrition/records error:", error);
    return NextResponse.json({ error: "获取补剂打卡记录失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      const requestedBabyId = body.babyId;
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);
      if (!baby) {
        return NextResponse.json({ error: "请提供有效的 babyId" }, { status: 400 });
      }
      const babyId = baby.id;
      const familyId = baby.familyId;

      const {
        productId,
        supplementName: customSuppName,
        date = getLocalDateStr(),
        time = getLocalTimeStr(),
        dose = 1.0,
        unitName,
        notes,
        clientId,
        forceOverride = false,
      } = body;

      if (!productId && !customSuppName) {
        return NextResponse.json({ error: "请选择打卡的补剂产品" }, { status: 400 });
      }

      if (!isValidDateStr(date)) {
        return NextResponse.json({ error: "date 必须为 YYYY-MM-DD 格式" }, { status: 400 });
      }

      // Food-plan still owns formula defaults/custom nutrient overrides. The
      // supplement catalog and records themselves are normalized API slices.
      const [fpRes, rawFormulas, rawFeedings, rawTodaySupps, rawProducts] = await Promise.all([
        growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
          method: "GET",
          accessToken: bffSession.accessToken,
        }),
        fetchCompleteList<GrowDeskFormulaProduct>(growdeskFetch, bffSession.accessToken, `/api/v1/families/${pathId(familyId)}/nutrition/products?includeArchived=true`),
        fetchCompleteList<any>(growdeskFetch, bffSession.accessToken, `/api/v1/babies/${pathId(babyId)}/records/feeding`),
        fetchCompleteList<GrowDeskSupplementRecord>(growdeskFetch, bffSession.accessToken, `/api/v1/babies/${pathId(babyId)}/records/supplement`),
        fetchCompleteList<GrowDeskSupplementProduct>(
          growdeskFetch,
          bffSession.accessToken,
          `/api/v1/families/${pathId(familyId)}/nutrition/supplement-products?includeArchived=true`,
        ),
      ]);

      const planData = requireScopedFoodPlan(requireData(fpRes), babyId).planData;
      const scopedFormulas = rawFormulas.map((formula) => requireScopedFormula(formula, familyId));
      const scopedFeedings = rawFeedings.map((feeding) => requireScopedTimedRecord(feeding, babyId, familyId, "喂养记录"));
      const scopedTodaySupps = rawTodaySupps.map((record) => requireScopedSupplementRecord(record, babyId, familyId));
      const suppState = extractSupplementStateFromFoodPlan(planData);
      const allKnownProducts: SupplementProduct[] = [
        ...rawProducts.map(fromGrowDeskSupplementProduct),
        ...PRESET_SUPPLEMENT_PRODUCTS.map((p, idx) => ({
          ...p,
          id: (p as any).id || `preset_${idx}`,
          familyId,
        })),
      ];

      const product =
        findMatchingSupplementProduct(customSuppName || productId, productId, allKnownProducts) || {
          id: productId || crypto.randomUUID(),
          familyId,
          name: customSuppName || "补剂",
          brand: customSuppName || "补剂",
          dosageForm: "drops",
          unitName: unitName || "剂",
          defaultDose: Number(dose) || 1.0,
          nutrients: {},
          isActive: true,
        };

      // ── 冲突与过量检测 (Conflict Guard) ──
      const ageSummary = calculateAge(baby.birthDate);
      const babyAgeMonths = ageSummary.months;

      const adaptedSuppRecords = scopedTodaySupps
        .map((r) => fromGrowDeskSupplementRecordEnriched(r, allKnownProducts))
        .filter((r) => r.date === date);

      const formulaMap: Record<string, FormulaProduct> = {};
      for (const rawF of scopedFormulas) {
        formulaMap[rawF.id] = fromGrowDeskFormulaProduct(rawF, {
          defaultFormulaId: suppState.defaultFormulaId,
          customNutrients: suppState.customFormulaNutrients?.[rawF.id],
        });
      }

      const { start: dayStart, end: dayEnd } = getLocalDayUtcRange(date);
      const adaptedFeedings = scopedFeedings
        .filter((f: any) => f.occurredAt >= dayStart && f.occurredAt < dayEnd)
        .map((f: any) => ({
          id: f.id,
          timestamp: f.occurredAt,
          type: f.feedingType,
          amountMl: f.amountMl ? Number(f.amountMl) : null,
          formulaProductId: f.formulaProductId,
          leftMinutes: f.leftMinutes,
          rightMinutes: f.rightMinutes,
        }));

      const suppMap: Record<string, SupplementProduct> = {};
      for (const p of allKnownProducts) {
        suppMap[p.id] = p;
      }

      const conflict = checkSupplementConflict({
        babyAgeMonths,
        incomingSupplement: product,
        incomingDose: Number(dose) || 1.0,
        existingRecordsToday: adaptedSuppRecords,
        feedingsToday: adaptedFeedings as any,
        formulaProductsMap: formulaMap,
        supplementProductsMap: suppMap,
      });

      if (conflict.hasConflict && !forceOverride) {
        return NextResponse.json(
          {
            hasConflict: true,
            requiresConfirmation: true,
            warnings: conflict.warnings,
            details: conflict.details,
            message: "检测到补剂重复或过量风险，请确认后继续打卡",
          },
          { status: 409 }
        );
      }

      const occurredAt = localTimeToUtcIso(time, date);
      const formattedAmount = formatSupplementAmount(Number(dose) || 1.0, unitName || product.unitName);
      const encodedNotes = encodeProductIdInNotes(product.id, notes);
      const idempotencyKey = clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskSupplementRecord>(
        `/api/v1/babies/${babyId}/records/supplement`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: {
            supplementName: product.name,
            productId: product.id,
            occurredAt,
            amount: formattedAmount,
            dose: String(Number(dose) || 1),
            unitName: unitName || product.unitName,
            notes: encodedNotes,
          },
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "记录补剂打卡失败" },
          { status: res.status },
        );
      }

      const createdEnriched = fromGrowDeskSupplementRecordEnriched(
        requireScopedSupplementRecord(res.data, babyId, familyId),
        allKnownProducts,
      );

      return NextResponse.json(
        {
          success: true,
          record: createdEnriched,
          warnings: conflict.warnings,
        },
        { status: 201 },
      );
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await request.json().catch(() => ({}));
    const babyResult = await requireBaby(auth.user, body.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const baby = babyResult.baby;
    const {
      productId,
      date = getLocalDateStr(),
      time = getLocalTimeStr(),
      dose = 1.0,
      unitName,
      notes,
      clientId,
      forceOverride = false,
    } = body;

    if (!productId || typeof productId !== "string") {
      return NextResponse.json({ error: "请选择打卡的补剂产品" }, { status: 400 });
    }

    if (!isValidDateStr(date)) {
      return NextResponse.json({ error: "date 必须为 YYYY-MM-DD 格式" }, { status: 400 });
    }

    const product = await prisma.supplementProduct.findUnique({ where: { id: productId } });
    if (!product || product.familyId !== baby.familyId) {
      return NextResponse.json({ error: "未找到指定的补剂产品" }, { status: 404 });
    }

    const parsedProduct: SupplementProduct = {
      id: product.id,
      familyId: product.familyId,
      name: product.name,
      brand: product.brand,
      dosageForm: product.dosageForm,
      unitName: product.unitName,
      defaultDose: product.defaultDose,
      nutrients: (product.nutrientsJson ? JSON.parse(product.nutrientsJson) : {}) as NutrientsMap,
      notes: product.notes,
      isActive: product.isActive,
    };

    // ── 冲突与过量检测 (Conflict Guard) ──
    const ageSummary = calculateAge(baby.birthDate);
    const babyAgeMonths = ageSummary.months;

    // 获取今日已有喂养与补剂记录
    const { start, end } = getLocalDayUtcRange(date);
    const [existingSupplements, existingFeedings, familySupplements, familyFormulas] = await Promise.all([
      prisma.supplementRecord.findMany({
        where: { babyId: baby.id, date },
        include: { product: true },
      }),
      prisma.feedingRecord.findMany({
        where: { babyId: baby.id, timestamp: { gte: start, lt: end } },
      }),
      prisma.supplementProduct.findMany({
        where: { familyId: baby.familyId },
      }),
      prisma.formulaProduct.findMany({
        where: { familyId: baby.familyId },
      }),
    ]);

    const suppMap: Record<string, SupplementProduct> = {};
    for (const sp of familySupplements) {
      suppMap[sp.id] = {
        id: sp.id,
        familyId: sp.familyId,
        name: sp.name,
        brand: sp.brand,
        dosageForm: sp.dosageForm,
        unitName: sp.unitName,
        defaultDose: sp.defaultDose,
        nutrients: (sp.nutrientsJson ? JSON.parse(sp.nutrientsJson) : {}) as NutrientsMap,
        notes: sp.notes,
        isActive: sp.isActive,
      };
    }

    const formulaMap: Record<string, FormulaProduct> = {};
    for (const fp of familyFormulas) {
      formulaMap[fp.id] = {
        id: fp.id,
        familyId: fp.familyId,
        name: fp.name,
        brand: fp.brand,
        stage: fp.stage,
        scoopWeightG: fp.scoopWeightG,
        waterPerScoopMl: fp.waterPerScoopMl,
        reconstitutionRatio: fp.reconstitutionRatio,
        servingSizeUnit: fp.servingSizeUnit,
        nutrients: (fp.nutrientsJson ? JSON.parse(fp.nutrientsJson) : {}) as NutrientsMap,
        notes: fp.notes,
        isActive: fp.isActive,
      };
    }

    const adaptedRecords: SupplementRecord[] = existingSupplements.map((r) => ({
      id: r.id,
      babyId: r.babyId,
      productId: r.productId,
      product: suppMap[r.productId],
      date: r.date,
      time: r.time,
      dose: r.dose,
      unitName: r.unitName,
      notes: r.notes,
    }));

    const conflict = checkSupplementConflict({
      babyAgeMonths,
      incomingSupplement: parsedProduct,
      incomingDose: Number(dose) || 1.0,
      existingRecordsToday: adaptedRecords,
      feedingsToday: existingFeedings as any,
      formulaProductsMap: formulaMap,
      supplementProductsMap: suppMap,
    });

    if (conflict.hasConflict && !forceOverride) {
      return NextResponse.json(
        {
          hasConflict: true,
          requiresConfirmation: true,
          warnings: conflict.warnings,
          details: conflict.details,
          message: "检测到补剂重复或过量风险，请确认后继续打卡",
        },
        { status: 409 }
      );
    }

    // 存入数据库
    const data = {
      babyId: baby.id,
      productId: product.id,
      recordedById: auth.user.id,
      date,
      time: time || getLocalTimeStr(),
      dose: Number(dose) || 1.0,
      unitName: unitName || product.unitName,
      notes: notes ? String(notes).trim() : null,
    };

    let record;
    if (clientId && typeof clientId === "string") {
      record = await prisma.supplementRecord.upsert({
        where: { babyId_clientId: { babyId: baby.id, clientId } },
        create: { ...data, clientId },
        update: {},
        include: { product: true },
      });
    } else {
      record = await prisma.supplementRecord.create({
        data,
        include: { product: true },
      });
    }

    return NextResponse.json(
      {
        success: true,
        record: {
          ...record,
          product: parsedProduct,
        },
        warnings: conflict.warnings,
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("POST /api/nutrition/records error:", error);
    return NextResponse.json({ error: "记录补剂打卡失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const body = await request.json().catch(() => ({}));
      const id = searchParams.get("id") || body.id;
      const requestedBabyId = searchParams.get("babyId") || body.babyId;
      const baseVersion = searchParams.get("baseVersion") || body.baseVersion || "1";

      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供记录 ID" }, { status: 400 });
      }

      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);
      if (!baby) {
        return NextResponse.json({ error: "请提供有效的 babyId" }, { status: 400 });
      }

      const res = await growdeskFetch(
        `/api/v1/babies/${baby.id}/records/supplement/${id}?baseVersion=${baseVersion}`,
        {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        },
      );

      if (!res.ok) {
        if (res.status === 404) {
          return NextResponse.json({ success: true, id, alreadyDeleted: true });
        }
        return NextResponse.json(
          { error: res.error?.message || "Failed to delete supplement record" },
          { status: res.status },
        );
      }

      return NextResponse.json({ success: true, id });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const id = searchParams.get("id") || body.id;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "请提供记录 ID" }, { status: 400 });
    }

    const record = await prisma.supplementRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "未找到指定记录" }, { status: 404 });
    }

    const babyResult = await requireBaby(auth.user.id, record.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    await prisma.supplementRecord.delete({ where: { id } });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("DELETE /api/nutrition/records error:", error);
    return NextResponse.json({ error: "删除打卡记录失败" }, { status: 500 });
  }
}
