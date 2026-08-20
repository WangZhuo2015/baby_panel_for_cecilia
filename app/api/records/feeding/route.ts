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
    const date = searchParams.get("date");
    const targetBabyId = searchParams.get("babyId") || babyId;

    const where: any = {};
    if (targetBabyId) where.babyId = targetBabyId;
    if (date) where.timestamp = { startsWith: date };

    const records = await prisma.feedingRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/feeding error:", error);
    return NextResponse.json(
      { error: "Failed to fetch feeding records" },
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
    const { babyId: reqBabyId, timestamp, type, amountMl, leftMinutes, rightMinutes, spitUp, notes } = body;

    const finalBabyId = reqBabyId || babyId || (await prisma.baby.findFirst())?.id;
    if (!finalBabyId) {
      return NextResponse.json({ error: "未找到宝宝档案，请先创建宝宝信息" }, { status: 400 });
    }

    if (!type || !["breast", "formula", "mixed"].includes(type)) {
      return NextResponse.json(
        { error: "type 必填且只能为 breast、formula 或 mixed" },
        { status: 400 }
      );
    }

    const record = await prisma.feedingRecord.create({
      data: {
        babyId: finalBabyId,
        recordedById: user?.id ?? null,
        timestamp,
        type,
        amountMl: amountMl ?? null,
        leftMinutes: leftMinutes ?? null,
        rightMinutes: rightMinutes ?? null,
        spitUp: spitUp ?? false,
        notes: notes ?? null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/feeding error:", error);
    return NextResponse.json(
      { error: "Failed to create feeding record" },
      { status: 500 }
    );
  }
}
