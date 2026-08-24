import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { calculateAge } from "@/lib/age";
import { isValidDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");
    const category = searchParams.get("category");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    const whereClause: any = { babyId: baby.id };
    if (category && category !== "all") {
      whereClause.category = category;
    }

    const reports = await prisma.medicalReport.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
    });

    const formatted = reports.map((r) => ({
      ...r,
      items: safeJsonParse(r.itemsJson, []),
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("GET /api/medical/reports error:", error);
    return NextResponse.json({ error: "获取健康单据失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      title,
      category,
      date,
      hospital,
      doctorNotes,
      aiSummary,
      items,
      imageUrl,
      growthData,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    if (!title || !date || typeof date !== "string" || !isValidDateStr(date.trim())) {
      return NextResponse.json(
        { error: "请填写报告标题和有效的日期（YYYY-MM-DD）" },
        { status: 400 }
      );
    }

    const itemsJson = JSON.stringify(Array.isArray(items) ? items : []);

    // 校验必须先于任何写入：越界直接 400，避免孤儿报告
    let weightKg: number | null = null;
    let heightCm: number | null = null;
    let headCircumferenceCm: number | null = null;
    if (growthData && typeof growthData === "object") {
      // 与 /api/growth 一致的范围校验；空白串视为未填，越界抛错
      const numericInRange = (
        raw: unknown,
        min: number,
        max: number,
        label: string
      ): number | null => {
        if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
        const v = Number(raw);
        if (Number.isNaN(v) || v < min || v > max) {
          throw new RangeError(`${label} 必须在 ${min}-${max} 之间`);
        }
        return v;
      };

      try {
        weightKg = numericInRange(growthData.weightKg, 0.5, 50.0, "体重(kg)");
        heightCm = numericInRange(growthData.heightCm, 20.0, 150.0, "身高(cm)");
        headCircumferenceCm = numericInRange(growthData.headCircumferenceCm, 20.0, 60.0, "头围(cm)");
      } catch (error: any) {
        if (error instanceof RangeError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    // 报告与测量原子化写入
    const createdReport = await prisma.$transaction(async (tx) => {
      const report = await tx.medicalReport.create({
        data: {
          babyId: baby.id,
          recordedById: user.id,
          title: String(title).trim(),
          category: category || "general",
          date: String(date).trim(),
          hospital: hospital ? String(hospital).trim() : null,
          doctorNotes: doctorNotes ? String(doctorNotes).trim() : null,
          aiSummary: aiSummary ? String(aiSummary).trim() : null,
          itemsJson,
          imageUrl: imageUrl ? String(imageUrl).trim() : null,
        },
      });

      if (weightKg != null || heightCm != null || headCircumferenceCm != null) {
        const { months, label } = calculateAge(baby.birthDate, date);

        await tx.growthMeasurement.create({
          data: {
            babyId: baby.id,
            recordedById: user.id,
            date: String(date).trim(),
            ageInMonths: months,
            ageLabel: label,
            weightKg,
            heightCm,
            headCircumferenceCm,
            imageUrl: imageUrl ? String(imageUrl).trim() : null,
          },
        });
      }

      return report;
    });

    return NextResponse.json(
      {
        ...createdReport,
        items: safeJsonParse(createdReport.itemsJson, []),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST /api/medical/reports error:", error);
    return NextResponse.json({ error: "保存报告失败，请重试" }, { status: 500 });
  }
}
