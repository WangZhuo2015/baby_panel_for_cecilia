import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { getLocalDayUtcRange, isValidDateStr } from "@/lib/date";

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
      if (!isValidDateStr(date)) {
        return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
      }
      const { start, end } = getLocalDayUtcRange(date);
      if (start && end) {
        where.timestamp = { gte: start, lt: end };
      }
    }


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
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      timestamp,
      type,
      amountMl,
      leftMinutes,
      rightMinutes,
      spitUp,
      notes,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    const validTypes = ["breast", "formula", "bottle_breast", "mixed", "solid"];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { error: "type 必填且只能为 breast、formula、bottle_breast、mixed 或 solid" },
        { status: 400 }
      );
    }

    let parsedAmountMl: number | null = null;
    if (amountMl !== undefined && amountMl !== null && amountMl !== "") {
      parsedAmountMl = Number(amountMl);
      if (Number.isNaN(parsedAmountMl) || parsedAmountMl < 0 || parsedAmountMl > 3000) {
        return NextResponse.json(
          { error: "amountMl 必须为 0-3000 之间的有效数值" },
          { status: 400 }
        );
      }
    }

    let parsedLeft: number | null = null;
    if (leftMinutes !== undefined && leftMinutes !== null && leftMinutes !== "") {
      parsedLeft = Number(leftMinutes);
      if (Number.isNaN(parsedLeft) || parsedLeft < 0 || parsedLeft > 180) {
        return NextResponse.json(
          { error: "leftMinutes 必须为 0-180 之间的有效数值" },
          { status: 400 }
        );
      }
    }

    let parsedRight: number | null = null;
    if (rightMinutes !== undefined && rightMinutes !== null && rightMinutes !== "") {
      parsedRight = Number(rightMinutes);
      if (Number.isNaN(parsedRight) || parsedRight < 0 || parsedRight > 180) {
        return NextResponse.json(
          { error: "rightMinutes 必须为 0-180 之间的有效数值" },
          { status: 400 }
        );
      }
    }

    let recordTimestamp = new Date().toISOString();
    if (timestamp) {
      const parsedTime = new Date(timestamp);
      if (Number.isNaN(parsedTime.getTime())) {
        return NextResponse.json(
          { error: "timestamp 格式无效" },
          { status: 400 }
        );
      }
      recordTimestamp = parsedTime.toISOString();
    }

    const record = await prisma.feedingRecord.create({
      data: {
        babyId: babyResult.baby.id,
        recordedById: user.id,
        timestamp: recordTimestamp,
        type,
        amountMl: parsedAmountMl,
        leftMinutes: parsedLeft,
        rightMinutes: parsedRight,
        spitUp: spitUp === true || spitUp === "true" || spitUp === 1,
        notes: notes ? String(notes).trim() : null,
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

    const record = await prisma.feedingRecord.findUnique({
      where: { id },
    });

    if (!record) {
      return NextResponse.json(
        { error: "未找到指定的喂养记录" },
        { status: 404 }
      );
    }

    // Verify ownership of the baby associated with the record
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.feedingRecord.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/records/feeding error:", error);
    return NextResponse.json(
      { error: "Failed to delete feeding record" },
      { status: 500 }
    );
  }
}
