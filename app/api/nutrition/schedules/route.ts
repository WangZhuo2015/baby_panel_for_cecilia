import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getLocalDateStr, isValidDateStr } from "@/lib/date";
import type { SupplementSchedule, SupplementProduct, NutrientsMap } from "@/types/nutrition";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user.id, searchParams.get("babyId"));
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

    return NextResponse.json({ schedules });
  } catch (error: any) {
    console.error("GET /api/nutrition/schedules error:", error);
    return NextResponse.json({ error: "获取补剂计划失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await request.json().catch(() => ({}));
    const babyResult = await requireBaby(auth.user.id, body.babyId);
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
