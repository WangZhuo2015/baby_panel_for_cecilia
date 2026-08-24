import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { estimatePercentile } from "@/lib/who-growth-standards";
import { calculateAgeDetail } from "@/lib/age";
import { isValidDateStr, getLocalDateStr, addDays } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const measurements = await prisma.growthMeasurement.findMany({
      where: { babyId: babyResult.baby.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(measurements);
  } catch (error) {
    console.error("GET /api/growth error:", error);
    return NextResponse.json(
      { error: "Failed to fetch growth measurements" },
      { status: 500 }
    );
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
      date,
      weightKg,
      heightCm,
      headCircumferenceCm,
      imageUrl,
    } = body;


    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    if (!date || typeof date !== "string" || !isValidDateStr(date.trim())) {
      return NextResponse.json(
        { error: "date 必填且必须为有效的 YYYY-MM-DD 日期" },
        { status: 400 }
      );
    }

    // 日期边界：不得晚于今天（+1 天补录容差），不得早于出生日期
    const today = getLocalDateStr();
    const dateVal = date.trim();
    if (dateVal > addDays(today, 1)) {
      return NextResponse.json({ error: "测量日期不能是未来" }, { status: 400 });
    }
    if (baby.birthDate && dateVal < baby.birthDate) {
      return NextResponse.json({ error: "测量日期不能早于宝宝出生日期" }, { status: 400 });
    }

    let parsedWeight: number | null = null;
    if (weightKg !== undefined && weightKg !== null && weightKg !== "") {
      parsedWeight = Number(weightKg);
      if (Number.isNaN(parsedWeight) || parsedWeight < 0.5 || parsedWeight > 50) {
        return NextResponse.json(
          { error: "体重范围必须在 0.5kg 到 50kg 之间" },
          { status: 400 }
        );
      }
    }

    let parsedHeight: number | null = null;
    if (heightCm !== undefined && heightCm !== null && heightCm !== "") {
      parsedHeight = Number(heightCm);
      if (Number.isNaN(parsedHeight) || parsedHeight < 20 || parsedHeight > 150) {
        return NextResponse.json(
          { error: "身长/身高范围必须在 20cm 到 150cm 之间" },
          { status: 400 }
        );
      }
    }

    let parsedHeadCirc: number | null = null;
    if (headCircumferenceCm !== undefined && headCircumferenceCm !== null && headCircumferenceCm !== "") {
      parsedHeadCirc = Number(headCircumferenceCm);
      if (Number.isNaN(parsedHeadCirc) || parsedHeadCirc < 20 || parsedHeadCirc > 60) {
        return NextResponse.json(
          { error: "头围范围必须在 20cm 到 60cm 之间" },
          { status: 400 }
        );
      }
    }

    if (parsedWeight === null && parsedHeight === null && parsedHeadCirc === null) {
      return NextResponse.json(
        { error: "请至少提供一项测量数据（体重、身高或头围）" },
        { status: 400 }
      );
    }

    const ageDetail = calculateAgeDetail(baby.birthDate, date.trim());
    const computedAgeMonths = ageDetail.months;
    const computedAgeLabel = `${ageDetail.months}月${ageDetail.days}天`;



    // Calculate percentile (priority: weight -> height -> headCircumference)
    let calculatedPercentile: number | null = null;
    const gender = baby.gender || "female";
    if (parsedWeight !== null && computedAgeMonths !== null) {
      calculatedPercentile = estimatePercentile(gender, "weight", computedAgeMonths, parsedWeight);
    } else if (parsedHeight !== null && computedAgeMonths !== null) {
      calculatedPercentile = estimatePercentile(gender, "height", computedAgeMonths, parsedHeight);
    } else if (parsedHeadCirc !== null && computedAgeMonths !== null) {
      calculatedPercentile = estimatePercentile(gender, "headCircumference", computedAgeMonths, parsedHeadCirc);
    }

    const measurement = await prisma.growthMeasurement.create({
      data: {
        babyId: baby.id,
        recordedById: user.id,
        date: date.trim(),
        ageInMonths: computedAgeMonths,
        ageLabel: computedAgeLabel,
        weightKg: parsedWeight,
        heightCm: parsedHeight,
        headCircumferenceCm: parsedHeadCirc,
        percentile: calculatedPercentile,
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
      },
    });

    return NextResponse.json(measurement, { status: 201 });
  } catch (error) {
    console.error("POST /api/growth error:", error);
    return NextResponse.json(
      { error: "Failed to create growth measurement" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      const body = await request.json().catch(() => ({}));
      id = body?.id;
    }

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "请提供要删除的记录 ID" },
        { status: 400 }
      );
    }

    const record = await prisma.growthMeasurement.findUnique({
      where: { id },
    });

    if (!record) {
      return NextResponse.json(
        { error: "未找到指定的生长记录" },
        { status: 404 }
      );
    }

    // Verify ownership of the baby associated with the record
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.growthMeasurement.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/growth error:", error);
    return NextResponse.json(
      { error: "Failed to delete growth measurement" },
      { status: 500 }
    );
  }
}
