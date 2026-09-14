import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";
import type { SupplementSchedule, SupplementProduct, NutrientsMap } from "@/types/nutrition";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import {
  extractSupplementStateFromFoodPlan,
  mergeSupplementStateIntoFoodPlan,
  fromGrowDeskSupplementRecordEnriched,
  findMatchingSupplementProduct,
  type GrowDeskSupplementRecord,
} from "@/lib/growdesk/nutrition-compat";
import { PRESET_SUPPLEMENT_PRODUCTS } from "@/lib/nutrition/presets";
import crypto from "node:crypto";

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
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = baby.id;
      const dateParam = searchParams.get("date");
      const targetDate = dateParam && isValidDateStr(dateParam) ? dateParam : getLocalDateStr();

      const [foodPlanRes, suppRecsRes] = await Promise.all([
        growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
          method: "GET",
          accessToken: bffSession.accessToken,
        }),
        growdeskFetch<any>(`/api/v1/babies/${babyId}/records/supplement?limit=100`, {
          method: "GET",
          accessToken: bffSession.accessToken,
        }),
      ]);

      const planData = (foodPlanRes.ok && (foodPlanRes.data?.data?.planData || foodPlanRes.data?.planData)) || {};
      const suppState = extractSupplementStateFromFoodPlan(planData);

      const allKnownProducts: SupplementProduct[] = [
        ...suppState.supplementProducts,
        ...PRESET_SUPPLEMENT_PRODUCTS.map((p, idx) => ({
          ...p,
          id: (p as any).id || `preset_${idx}`,
          familyId: baby.familyId,
        })),
      ];

      const rawRecords: GrowDeskSupplementRecord[] = suppRecsRes.ok && suppRecsRes.data
        ? Array.isArray(suppRecsRes.data)
          ? suppRecsRes.data
          : suppRecsRes.data.data || []
        : [];

      const enrichedRecords = rawRecords.map((r) =>
        fromGrowDeskSupplementRecordEnriched(r, allKnownProducts)
      );

      const dateRecords = enrichedRecords.filter((r) => r.date === targetDate);
      const completedProductIds = new Set(dateRecords.map((r) => r.productId));

      const schedules: SupplementSchedule[] = suppState.supplementSchedules
        .filter((s) => s.isActive !== false)
        .map((s) => {
          const product =
            findMatchingSupplementProduct(s.product?.name || "", s.productId, allKnownProducts) ||
            s.product || {
              id: s.productId,
              familyId: baby.familyId,
              name: "补剂",
              brand: "补剂",
              dosageForm: "drops",
              unitName: "剂",
              defaultDose: s.targetDose,
              nutrients: {},
              isActive: true,
            };

          return {
            id: s.id,
            babyId: s.babyId,
            productId: s.productId,
            product,
            frequency: s.frequency || "daily",
            customDays: s.customDays,
            targetDose: s.targetDose,
            reminderTime: s.reminderTime,
            isActive: s.isActive,
            startDate: s.startDate,
            notes: s.notes,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            isCompletedToday: completedProductIds.has(s.productId),
          };
        });

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
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, body.babyId);
      if (!baby) {
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = baby.id;
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

      const fpRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
        method: "GET",
        accessToken: bffSession.accessToken,
      });
      const existingPlanData = (fpRes.ok && (fpRes.data?.data?.planData || fpRes.data?.planData)) || {};
      const suppState = extractSupplementStateFromFoodPlan(existingPlanData);

      const allKnownProducts: SupplementProduct[] = [
        ...suppState.supplementProducts,
        ...PRESET_SUPPLEMENT_PRODUCTS.map((p, idx) => ({
          ...p,
          id: (p as any).id || `preset_${idx}`,
          familyId: baby.familyId,
        })),
      ];

      const product = findMatchingSupplementProduct(productId, productId, allKnownProducts);
      if (!product) {
        return NextResponse.json({ error: "未找到指定的补剂产品" }, { status: 404 });
      }

      const nowIso = new Date().toISOString();
      let scheduleToSave: SupplementSchedule;
      let isNew = false;

      if (id) {
        const targetIdx = suppState.supplementSchedules.findIndex((s) => s.id === id);
        if (targetIdx === -1) {
          return NextResponse.json({ error: "未找到指定的计划" }, { status: 404 });
        }
        scheduleToSave = {
          ...suppState.supplementSchedules[targetIdx],
          productId,
          product,
          frequency,
          customDays,
          targetDose: Number(targetDose) || 1.0,
          reminderTime: reminderTime ? String(reminderTime).trim() : null,
          isActive: Boolean(isActive),
          startDate: startDate || suppState.supplementSchedules[targetIdx].startDate,
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : suppState.supplementSchedules[targetIdx].notes,
          updatedAt: nowIso,
        };
        const updatedList = [...suppState.supplementSchedules];
        updatedList[targetIdx] = scheduleToSave;
        const merged = mergeSupplementStateIntoFoodPlan(existingPlanData, { supplementSchedules: updatedList });
        await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
          method: "PUT",
          accessToken: bffSession.accessToken,
          body: { planData: merged },
        });
      } else {
        const existingIdx = suppState.supplementSchedules.findIndex((s) => s.productId === productId);
        if (existingIdx !== -1) {
          scheduleToSave = {
            ...suppState.supplementSchedules[existingIdx],
            product,
            frequency,
            customDays,
            targetDose: Number(targetDose) || 1.0,
            reminderTime: reminderTime ? String(reminderTime).trim() : null,
            isActive: Boolean(isActive),
            startDate: startDate || suppState.supplementSchedules[existingIdx].startDate,
            notes: notes !== undefined ? (notes ? String(notes).trim() : null) : suppState.supplementSchedules[existingIdx].notes,
            updatedAt: nowIso,
          };
          const updatedList = [...suppState.supplementSchedules];
          updatedList[existingIdx] = scheduleToSave;
          const merged = mergeSupplementStateIntoFoodPlan(existingPlanData, { supplementSchedules: updatedList });
          await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
            method: "PUT",
            accessToken: bffSession.accessToken,
            body: { planData: merged },
          });
        } else {
          isNew = true;
          scheduleToSave = {
            id: crypto.randomUUID(),
            babyId,
            productId,
            product,
            frequency,
            customDays,
            targetDose: Number(targetDose) || 1.0,
            reminderTime: reminderTime ? String(reminderTime).trim() : null,
            isActive: Boolean(isActive),
            startDate: startDate || getLocalDateStr(),
            notes: notes ? String(notes).trim() : null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          const updatedList = [...suppState.supplementSchedules, scheduleToSave];
          const merged = mergeSupplementStateIntoFoodPlan(existingPlanData, { supplementSchedules: updatedList });
          await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
            method: "PUT",
            accessToken: bffSession.accessToken,
            body: { planData: merged },
          });
        }
      }

      return NextResponse.json(scheduleToSave, { status: isNew ? 201 : 200 });
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
          isActive: Boolean(isActive),
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
          isActive: Boolean(isActive),
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
        isActive: Boolean(isActive),
        startDate: startDate || getLocalDateStr(),
        notes: notes ? String(notes).trim() : null,
      },
      include: { product: true },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
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
      const requestedBabyId = searchParams.get("babyId");

      if (!id) {
        return NextResponse.json({ error: "请提供计划 ID" }, { status: 400 });
      }

      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, requestedBabyId);
      if (!baby) {
        return NextResponse.json({ error: "未找到指定的宝宝档案" }, { status: 404 });
      }

      const babyId = baby.id;
      const fpRes = await growdeskFetch<any>(`/api/v1/babies/${babyId}/food-plan`, {
        method: "GET",
        accessToken: bffSession.accessToken,
      });
      const existingPlanData = (fpRes.ok && (fpRes.data?.data?.planData || fpRes.data?.planData)) || {};
      const suppState = extractSupplementStateFromFoodPlan(existingPlanData);

      const updatedSchedules = suppState.supplementSchedules.filter((s) => s.id !== id);
      const merged = mergeSupplementStateIntoFoodPlan(existingPlanData, { supplementSchedules: updatedSchedules });

      await growdeskFetch(`/api/v1/babies/${babyId}/food-plan`, {
        method: "PUT",
        accessToken: bffSession.accessToken,
        body: { planData: merged },
      });

      return NextResponse.json({ success: true, id });
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
    console.error("DELETE /api/nutrition/schedules error:", error);
    return NextResponse.json({ error: "删除计划失败" }, { status: 500 });
  }
}
