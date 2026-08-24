import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { getLocalDayUtcRange } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");
    const date = searchParams.get("date");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const where: any = { babyId: babyResult.baby.id };
    if (date) {
      const { start, end } = getLocalDayUtcRange(date);
      if (start && end) {
        where.startTime = { lt: end };
        where.endTime = { gt: start };
      }
    }

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
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      startTime,
      endTime,
      type,
      nightWakingCount,
      notes,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    if (!startTime || typeof startTime !== "string" || !endTime || typeof endTime !== "string") {
      return NextResponse.json(
        { error: "startTime 和 endTime 必填且必须为有效时间字符串" },
        { status: 400 }
      );
    }

    const sleepType = type === "night" ? "night" : "day";
    const wakingCount = typeof nightWakingCount === "number" && nightWakingCount >= 0
      ? Math.floor(nightWakingCount)
      : 0;

    const record = await prisma.sleepRecord.create({
      data: {
        babyId: babyResult.baby.id,
        recordedById: user.id,
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        type: sleepType,
        nightWakingCount: wakingCount,
        notes: notes ? String(notes).trim() : null,
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

    const record = await prisma.sleepRecord.findUnique({
      where: { id },
    });

    if (!record) {
      return NextResponse.json(
        { error: "未找到指定的睡眠记录" },
        { status: 404 }
      );
    }

    // Verify ownership of the baby associated with the record
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.sleepRecord.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/records/sleep error:", error);
    return NextResponse.json(
      { error: "Failed to delete sleep record" },
      { status: 500 }
    );
  }
}
