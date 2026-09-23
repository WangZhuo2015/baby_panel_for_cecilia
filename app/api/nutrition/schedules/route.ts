import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";
import type { SupplementSchedule, SupplementProduct, NutrientsMap } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";
import { resolveNutritionScope } from "@/lib/growdesk/nutrition-scope";
import { BridgeError, bridgeErrorResponse, pathId, requireData } from "@/lib/growdesk/bridge-protocol";
import {
  fromGrowDeskSupplementProduct,
  type GrowDeskSupplementProduct,
} from "@/lib/growdesk/nutrition-compat";

function mapGrowDeskSchedule(raw: unknown, babyId: string, familyId: string, extended = false): SupplementSchedule {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_SCHEDULE", "GrowDesk 返回了无效的补剂计划");
  }
  const source = raw as Record<string, any>;
  const product = source.product as GrowDeskSupplementProduct | undefined;
  if (source.babyId !== babyId || source.familyId !== familyId ||
      !product || product.familyId !== familyId || product.id !== source.productId) {
    throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "补剂计划不属于当前家庭/宝宝");
  }
  const dose = Number(source.targetDose);
  if (typeof source.id !== "string" || !source.id || !Number.isFinite(dose) || dose <= 0 ||
      typeof source.isActive !== "boolean" || typeof source.isCompletedToday !== "boolean") {
    throw new BridgeError(502, "UPSTREAM_INVALID_SCHEDULE", "补剂计划字段不完整");
  }
  if (!product || typeof product.id !== "string" || product.familyId === undefined) {
    throw new BridgeError(502, "UPSTREAM_INVALID_SCHEDULE", "GrowDesk 补剂计划缺少产品信息");
  }
  return {
    id: String(source.id),
    ...(extended && Number.isSafeInteger(source.version) && source.version > 0 ? { version: source.version } : {}),
    babyId: String(source.babyId || babyId),
    productId: String(source.productId),
    product: fromGrowDeskSupplementProduct(product),
    frequency: source.frequency || "daily",
    customDays: source.customDays ?? undefined,
    targetDose: dose,
    reminderTime: source.reminderTime ?? null,
    isActive: source.isActive !== false,
    startDate: source.startDate ?? null,
    notes: source.notes ?? null,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    isCompletedToday: Boolean(source.isCompletedToday),
  };
}

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const scope = await resolveNutritionScope(growdeskFetch, bffSession.accessToken, request.url);
      if (!scope.babyId) {
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = scope.babyId;
      const dateParam = searchParams.get("date");
      if (dateParam !== null && !isValidDateStr(dateParam)) throw new BridgeError(400, "INVALID_DATE", "日期格式无效");
      const targetDate = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();

      const scheduleRes = await growdeskFetch<unknown[]>(
        `/api/v1/babies/${pathId(babyId)}/nutrition/supplement-schedules?date=${encodeURIComponent(targetDate)}`,
        { method: "GET", accessToken: bffSession.accessToken },
      );
      const rawSchedules = requireData(scheduleRes);
      if (!Array.isArray(rawSchedules)) {
        throw new BridgeError(502, "UPSTREAM_INVALID_SCHEDULE", "GrowDesk 返回了无效的补剂计划列表");
      }
      const schedules = rawSchedules
        .map((raw) => mapGrowDeskSchedule(raw, babyId, scope.familyId!, wantsExtendedRepresentation(request)))
        .filter((schedule) => schedule.isActive !== false);
      const completedProductIds = new Set(
        schedules.filter((schedule) => schedule.isCompletedToday).map((schedule) => schedule.productId),
      );

      return NextResponse.json({
        schedules,
        completedProductIds: Array.from(completedProductIds),
      });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const babyId = babyResult.baby.id;
    const dateParam = searchParams.get("date");
    const targetDate = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();

    const dbSchedules = await prisma.supplementSchedule.findMany({
      where: { babyId, isActive: true },
      include: {
        product: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // 检查指定日期的打卡状态
    const dateRecords = await prisma.supplementRecord.findMany({
      where: { babyId, date: targetDate },
    });
    const completedProductIds = new Set(dateRecords.map((r) => r.productId));

    const schedules: SupplementSchedule[] = dbSchedules.map((s) => {
      const p = s.product;
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
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };

      return {
        id: s.id,
        babyId: s.babyId,
        productId: s.productId,
        product,
        frequency: (s.frequency as any) || "daily",
        customDays: s.customDaysJson ? JSON.parse(s.customDaysJson) : undefined,
        targetDose: s.targetDose,
        reminderTime: s.reminderTime,
        isActive: s.isActive,
        startDate: s.startDate,
        notes: s.notes,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        isCompletedToday: completedProductIds.has(s.productId),
      };
    });

    return NextResponse.json({
      schedules,
      completedProductIds: Array.from(completedProductIds),
    });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("GET /api/nutrition/schedules error:", error);
    return NextResponse.json({ error: "获取补剂计划失败" }, { status: 500 });
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
      const scope = await resolveNutritionScope(growdeskFetch, bffSession.accessToken, request.url, body);
      if (!scope.babyId) {
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = scope.babyId;
      const {
        id,
        productId,
        frequency = "daily",
        customDays,
        targetDose = 1.0,
        reminderTime,
        isActive = true,
        startDate = getLocalDateStr(),
        notes,
      } = body;

      if (!productId || typeof productId !== "string") {
        return NextResponse.json({ error: "请选择补剂产品" }, { status: 400 });
      }

      const numericDose = Number(targetDose);
      if ((typeof targetDose !== "string" && typeof targetDose !== "number") ||
          !Number.isFinite(numericDose) || numericDose <= 0 || !/^\d+(\.\d+)?$/.test(String(targetDose))) {
        throw new BridgeError(400, "INVALID_DOSE", "计划剂量必须是正数");
      }
      if (typeof isActive !== "boolean") throw new BridgeError(400, "INVALID_ACTIVE_FLAG", "isActive 必须是布尔值");
      if (id) pathId(id);
      pathId(productId);
      const payload = {
        ...(id ? { id } : {}),
        ...(body.baseVersion !== undefined ? { baseVersion: body.baseVersion } : {}),
        productId,
        frequency,
        customDays: customDays ?? null,
        targetDose: String(targetDose),
        reminderTime: reminderTime ? String(reminderTime).trim() : null,
        isActive,
        startDate: startDate || null,
        notes: notes ? String(notes).trim() : null,
      };
      const response = await growdeskFetch<any>(`/api/v1/babies/${pathId(babyId)}/nutrition/supplement-schedules`, {
        method: "POST",
        accessToken: bffSession.accessToken,
        body: payload,
      });
      const saved = requireData(response);
      return NextResponse.json(mapGrowDeskSchedule(saved, babyId, scope.familyId!, wantsExtendedRepresentation(request)), { status: response.status === 201 ? 201 : 200 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await request.json().catch(() => ({}));
    const babyResult = await requireBaby(auth.user, body.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const babyId = babyResult.baby.id;
    const {
      id,
      productId,
      frequency = "daily",
      customDays,
      targetDose = 1.0,
      reminderTime,
      isActive = true,
      startDate = getLocalDateStr(),
      notes,
    } = body;

    if (!productId || typeof productId !== "string") {
      return NextResponse.json({ error: "请选择补剂产品" }, { status: 400 });
    }

    const product = await prisma.supplementProduct.findUnique({ where: { id: productId } });
    if (!product || product.familyId !== babyResult.family.id) {
      return NextResponse.json({ error: "未找到指定的补剂产品" }, { status: 404 });
    }

    if (id) {
      // Update existing schedule
      const existing = await prisma.supplementSchedule.findUnique({ where: { id } });
      if (!existing || existing.babyId !== babyId) {
        return NextResponse.json({ error: "未找到指定的计划" }, { status: 404 });
      }

      const updated = await prisma.supplementSchedule.update({
        where: { id },
        data: {
          productId,
          frequency,
          customDaysJson: customDays ? JSON.stringify(customDays) : null,
          targetDose: Number(targetDose) || 1.0,
          reminderTime: reminderTime ? String(reminderTime).trim() : null,
          isActive,
          startDate: startDate || existing.startDate,
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : existing.notes,
        },
        include: { product: true },
      });

      return NextResponse.json(updated);
    }

    // Check if baby already has a schedule record for this product
    const existingSame = await prisma.supplementSchedule.findFirst({
      where: { babyId, productId },
    });
    if (existingSame) {
      const updated = await prisma.supplementSchedule.update({
        where: { id: existingSame.id },
        data: {
          frequency,
          customDaysJson: customDays ? JSON.stringify(customDays) : null,
          targetDose: Number(targetDose) || 1.0,
          reminderTime: reminderTime ? String(reminderTime).trim() : null,
          isActive,
          startDate: startDate || existingSame.startDate,
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : existingSame.notes,
        },
        include: { product: true },
      });
      return NextResponse.json(updated);
    }

    // Create new schedule
    const created = await prisma.supplementSchedule.create({
      data: {
        babyId,
        productId,
        frequency,
        customDaysJson: customDays ? JSON.stringify(customDays) : null,
        targetDose: Number(targetDose) || 1.0,
        reminderTime: reminderTime ? String(reminderTime).trim() : null,
        isActive,
        startDate: startDate || getLocalDateStr(),
        notes: notes ? String(notes).trim() : null,
      },
      include: { product: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("POST /api/nutrition/schedules error:", error);
    return NextResponse.json({ error: "保存补剂计划失败" }, { status: 500 });
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
      const id = searchParams.get("id");

      if (!id) {
        return NextResponse.json({ error: "请提供计划 ID" }, { status: 400 });
      }

      const scope = await resolveNutritionScope(growdeskFetch, bffSession.accessToken, request.url);
      if (!scope.babyId) {
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = scope.babyId;
      const response = await growdeskFetch(`/api/v1/babies/${pathId(babyId)}/nutrition/supplement-schedules/${encodeURIComponent(id)}`, {
        method: "DELETE",
        accessToken: bffSession.accessToken,
      });

      // DELETE is the canonical operation. Keep the old BFF's idempotent
      // response for an already-archived schedule.
      if (!response.ok && response.status !== 404) {
        return NextResponse.json({ error: response.error?.message || "删除计划失败" }, { status: response.status });
      }

      return NextResponse.json({ success: true, id, ...(response.status === 404 ? { alreadyDeleted: true } : {}) });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "请提供计划 ID" }, { status: 400 });
    }

    const schedule = await prisma.supplementSchedule.findUnique({ where: { id } });
    if (!schedule) {
      return NextResponse.json({ error: "未找到指定计划" }, { status: 404 });
    }

    const babyResult = await requireBaby(auth.user.id, schedule.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    await prisma.supplementSchedule.delete({ where: { id } });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    if (error instanceof BridgeError) return bridgeErrorResponse(error);
    console.error("DELETE /api/nutrition/schedules error:", error);
    return NextResponse.json({ error: "删除计划失败" }, { status: 500 });
  }
}
