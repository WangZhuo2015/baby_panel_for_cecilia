import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

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

    const where: any = {};
    if (targetBabyId) where.babyId = targetBabyId;

    const records = await prisma.sleepRecord.findMany({
      where,
      orderBy: { startTime: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/sleep error:", error);
    return NextResponse.json(
      { error: "Failed to fetch sleep records" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    let babyId: string | undefined;
    if (user) {
      const active = await getActiveBabyForUser(user.id);
      babyId = active?.baby?.id;
    }

    const body = await request.json();
    const { babyId: reqBabyId, startTime, endTime, type, nightWakingCount, notes } = body;

    const finalBabyId = reqBabyId || babyId || (await prisma.baby.findFirst())?.id;
    if (!finalBabyId) {
      return NextResponse.json({ error: "未找到宝宝档案，请先创建宝宝信息" }, { status: 400 });
    }

    if (!startTime || !endTime) {
      return NextResponse.json(
        { error: "startTime 和 endTime 必填" },
        { status: 400 }
      );
    }

    const record = await prisma.sleepRecord.create({
      data: {
        babyId: finalBabyId,
        recordedById: user?.id ?? null,
        startTime,
        endTime,
        type: type ?? "day",
        nightWakingCount: nightWakingCount ?? 0,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/sleep error:", error);
    return NextResponse.json(
      { error: "Failed to create sleep record" },
      { status: 500 }
    );
  }
}
