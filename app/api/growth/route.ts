import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";
import { estimatePercentile } from "@/lib/who-growth-standards";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    let babyId: string | undefined;

    if (user) {
      const active = await getActiveBabyForUser(user.id);
      babyId = active?.baby?.id;
    }

    const { searchParams } = new URL(request.url);
    const targetBabyId = searchParams.get("babyId") || babyId;

    const measurements = targetBabyId
      ? await prisma.growthMeasurement.findMany({
          where: { babyId: targetBabyId },
          orderBy: { date: "asc" },
        })
      : await prisma.growthMeasurement.findMany({
          orderBy: { date: "asc" },
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
    const user = await getAuthSession(request);
    let babyId: string | undefined;
    let gender = "female";

    if (user) {
      const active = await getActiveBabyForUser(user.id);
      if (active?.baby) {
        babyId = active.baby.id;
        gender = active.baby.gender;
      }
    }

    const body = await request.json();
    const {
      babyId: reqBabyId,
      date,
      ageInMonths,
      ageLabel,
      weightKg,
      heightCm,
      headCircumferenceCm,
    } = body;

    let targetBabyId = reqBabyId || babyId;
    if (!targetBabyId) {
      const defaultBaby = await prisma.baby.findFirst();
      if (!defaultBaby) {
        return NextResponse.json(
          { error: "未找到宝宝档案，请先创建宝宝信息" },
          { status: 400 }
        );
      }
      targetBabyId = defaultBaby.id;
    }

    if (typeof date !== "string" || date.trim() === "") {
      return NextResponse.json(
        { error: "date 必填且不能为空" },
        { status: 400 }
      );
    }
    if (typeof ageLabel !== "string" || ageLabel.trim() === "") {
      return NextResponse.json(
        { error: "ageLabel 必填且不能为空" },
        { status: 400 }
      );
    }

    let calculatedPercentile: number | null = null;
    if (typeof ageInMonths === "number" && weightKg) {
      calculatedPercentile = estimatePercentile(gender, "weight", ageInMonths, weightKg);
    }

    const measurement = await prisma.growthMeasurement.create({
      data: {
        babyId: targetBabyId,
        recordedById: user?.id ?? null,
        date,
        ageInMonths: typeof ageInMonths === "number" ? ageInMonths : null,
        ageLabel,
        weightKg: weightKg != null ? parseFloat(weightKg) : null,
        heightCm: heightCm != null ? parseFloat(heightCm) : null,
        headCircumferenceCm: headCircumferenceCm != null ? parseFloat(headCircumferenceCm) : null,
        percentile: calculatedPercentile,
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
