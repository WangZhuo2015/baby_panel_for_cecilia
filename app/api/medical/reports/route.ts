import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    const activeBabyInfo = user ? await getActiveBabyForUser(user.id) : null;
    const baby = activeBabyInfo?.baby || (await prisma.baby.findFirst());

    if (!baby) {
      return NextResponse.json({ error: "未找到宝宝档案" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");

    const whereClause: any = { babyId: baby.id };
    if (category && category !== "all") {
      whereClause.category = category;
    }

    const reports = await prisma.medicalReport.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
    });

    const formatted = reports.map((r: any) => ({
      ...r,
      items: JSON.parse(r.itemsJson || "[]"),
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("GET /api/medical/reports error:", error);
    return NextResponse.json({ error: "获取健康单据失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    const activeBabyInfo = user ? await getActiveBabyForUser(user.id) : null;
    const baby = activeBabyInfo?.baby || (await prisma.baby.findFirst());

    if (!baby) {
      return NextResponse.json({ error: "未找到宝宝档案" }, { status: 404 });
    }

    const body = await request.json();
    const {
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

    if (!title || !date) {
      return NextResponse.json({ error: "请填写报告标题和日期" }, { status: 400 });
    }

    const itemsJson = JSON.stringify(Array.isArray(items) ? items : []);

    const createdReport = await prisma.medicalReport.create({
      data: {
        babyId: baby.id,
        recordedById: user?.id ?? null,
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

    // If growth measurements are included in the report, also save to GrowthMeasurement
    if (growthData && (growthData.weightKg || growthData.heightCm || growthData.headCircumferenceCm)) {
      try {
        const birthDate = new Date(baby.birthDate);
        const measureDate = new Date(date);
        const diffMs = measureDate.getTime() - birthDate.getTime();
        const months = Math.max(0, diffMs / (1000 * 60 * 60 * 24 * 30.44));
        const days = Math.round((months % 1) * 30.44);

        await prisma.growthMeasurement.create({
          data: {
            babyId: baby.id,
            recordedById: user?.id ?? null,
            date: String(date).trim(),
            ageInMonths: Math.floor(months),
            ageLabel: `${Math.floor(months)}月${days}天`,
            weightKg: growthData.weightKg ? Number(growthData.weightKg) : null,
            heightCm: growthData.heightCm ? Number(growthData.heightCm) : null,
            headCircumferenceCm: growthData.headCircumferenceCm ? Number(growthData.headCircumferenceCm) : null,
            imageUrl: imageUrl || null,
          },
        });
      } catch (e) {
        console.error("Failed to sync growth measurement from medical report:", e);
      }
    }

    return NextResponse.json({
      ...createdReport,
      items: JSON.parse(createdReport.itemsJson),
    });
  } catch (error: any) {
    console.error("POST /api/medical/reports error:", error);
    return NextResponse.json({ error: "保存报告失败，请重试" }, { status: 500 });
  }
}
