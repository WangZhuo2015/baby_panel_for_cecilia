import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, getLocalTimeStr, isValidDateStr, getLocalDayUtcRange } from "@/lib/date";
import { calculateAge } from "@/lib/age";
import { checkSupplementConflict } from "@/lib/nutrition/engine";
import type { SupplementRecord, SupplementProduct, FormulaProduct, NutrientsMap } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  toGrowDeskSupplementCreatePayload,
  fromGrowDeskSupplementRecord,
  type GrowDeskSupplementRecord,
} from "@/lib/growdesk/supplement-compat";
import crypto from "node:crypto";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const babyId = searchParams.get("babyId");
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      const limit = searchParams.get("limit") || "50";
      const res = await growdeskFetch<Array<GrowDeskSupplementRecord>>(
        `/api/v1/babies/${babyId}/records/supplement?limit=${limit}`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch supplement records" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      return NextResponse.json({ records: rawList.map(fromGrowDeskSupplementRecord) });
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
      const babyId = body.babyId;
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const payload = toGrowDeskSupplementCreatePayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskSupplementRecord>(
        `/api/v1/babies/${babyId}/records/supplement`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to create supplement record" },
          { status: res.status },
        );
      }

      return NextResponse.json(
        {
          success: true,
          record: fromGrowDeskSupplementRecord(res.data),
          warnings: [],
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
      const babyId = searchParams.get("babyId") || body.babyId;
      const baseVersion = searchParams.get("baseVersion") || body.baseVersion || "1";

      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const res = await growdeskFetch(
        `/api/v1/babies/${babyId}/records/supplement/${id}?baseVersion=${baseVersion}`,
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
    console.error("DELETE /api/nutrition/records error:", error);
    return NextResponse.json({ error: "删除打卡记录失败" }, { status: 500 });
  }
}
