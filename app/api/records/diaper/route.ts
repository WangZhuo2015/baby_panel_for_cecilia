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
        where.timestamp = { gte: start, lt: end };
      }
    }

    const records = await prisma.diaperRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    return NextResponse.json(records);
  } catch (error) {
    console.error("GET /api/records/diaper error:", error);
    return NextResponse.json(
      { error: "Failed to fetch diaper records" },
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
      poopColor,
      poopConsistency,
      notes,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;

    if (!type || !["pee", "poop", "both"].includes(type)) {
      return NextResponse.json(
        { error: "type 必填且只能为 pee、poop 或 both" },
        { status: 400 }
      );
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

    const record = await prisma.diaperRecord.create({
      data: {
        babyId: babyResult.baby.id,
        recordedById: user.id,
        timestamp: recordTimestamp,
        type,
        poopColor: poopColor ? String(poopColor).trim() : null,
        poopConsistency: poopConsistency ? String(poopConsistency).trim() : null,
        notes: notes ? String(notes).trim() : null,
      },
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("POST /api/records/diaper error:", error);
    return NextResponse.json(
      { error: "Failed to create diaper record" },
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

    const record = await prisma.diaperRecord.findUnique({
      where: { id },
    });

    if (!record) {
      return NextResponse.json(
        { error: "未找到指定的排便/尿布记录" },
        { status: 404 }
      );
    }

    // Verify ownership of the baby associated with the record
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.diaperRecord.delete({
      where: { id },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/records/diaper error:", error);
    return NextResponse.json(
      { error: "Failed to delete diaper record" },
      { status: 500 }
    );
  }
}
