import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { calculateAge } from "@/lib/age";

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

    if (!title || !date) {
      return NextResponse.json({ error: "请填写报告标题和日期" }, { status: 400 });
    }

    const itemsJson = JSON.stringify(Array.isArray(items) ? items : []);

    const createdReport = await prisma.medicalReport.create({
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

    // If growth measurements are included in the report, validate ranges and save to GrowthMeasurement
    if (growthData && typeof growthData === "object") {
      try {
        let weightKg: number | null = null;
        let heightCm: number | null = null;
        let headCircumferenceCm: number | null = null;

        if (growthData.weightKg != null && growthData.weightKg !== "") {
          const w = Number(growthData.weightKg);
          if (!Number.isNaN(w) && w >= 0.5 && w <= 50.0) weightKg = w;
        }
        if (growthData.heightCm != null && growthData.heightCm !== "") {
          const h = Number(growthData.heightCm);
          if (!Number.isNaN(h) && h >= 20.0 && h <= 150.0) heightCm = h;
        }
        if (growthData.headCircumferenceCm != null && growthData.headCircumferenceCm !== "") {
          const hc = Number(growthData.headCircumferenceCm);
          if (!Number.isNaN(hc) && hc >= 20.0 && hc <= 60.0) headCircumferenceCm = hc;
        }

        if (weightKg != null || heightCm != null || headCircumferenceCm != null) {
          const { months, label } = calculateAge(baby.birthDate, date);

          await prisma.growthMeasurement.create({
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
      } catch (e) {
        console.error("Failed to sync growth measurement from medical report:", e);
      }
    }


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
