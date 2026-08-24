import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { isValidDateStr } from "@/lib/date";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const requestedBabyId = searchParams.get("babyId");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const where: any = { babyId };
    if (date) {
      if (!isValidDateStr(date)) {
        return NextResponse.json({ error: "Invalid date format, expected YYYY-MM-DD" }, { status: 400 });
      }
      where.date = date;
    }


    const records = await prisma.foodLogRecord.findMany({
      where,
      orderBy: [{ date: "desc" }, { time: "desc" }],
    });

    const parsed = records.map((r) => ({
      ...r,
      foods: safeJsonParse(r.foods, []),
    }));

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("GET /api/food/logs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch food log records" },
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
      time,
      foods,
      portion,
      acceptance,
      babyState,
      hasAbnormal,
      abnormalNotes,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const babyId = babyResult.baby.id;

    const clientId =
      typeof body.clientId === "string" && body.clientId.length > 0 && body.clientId.length <= 64
        ? body.clientId
        : null;
    const data = {
      recordedById: user.id,
      date: date || new Date().toISOString().slice(0, 10),
      time: time || new Date().toTimeString().slice(0, 5),
      foods: Array.isArray(foods) ? JSON.stringify(foods) : String(foods || "[]"),
      portion: portion || "most",
      acceptance: typeof acceptance === "number" ? acceptance : 3,
      babyState: babyState || "happy",
      hasAbnormal: hasAbnormal ?? false,
      abnormalNotes: abnormalNotes ?? null,
    };
    const record = clientId
      ? await prisma.foodLogRecord.upsert({
          where: { babyId_clientId: { babyId, clientId } },
          create: { ...data, babyId, clientId },
          update: {},
        })
      : await prisma.foodLogRecord.create({ data: { ...data, babyId } });

    return NextResponse.json(
      {
        ...record,
        foods: safeJsonParse(record.foods, []),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/food/logs error:", error);
    return NextResponse.json(
      { error: "Failed to create food log record" },
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
      return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
    }

    const record = await prisma.foodLogRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "未找到指定的辅食记录" }, { status: 404 });
    }
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.foodLogRecord.delete({ where: { id } });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("DELETE /api/food/logs error:", error);
    return NextResponse.json({ error: "Failed to delete food log" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const id = body?.id;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
    }

    const record = await prisma.foodLogRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "未找到指定的辅食记录" }, { status: 404 });
    }
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    const merged = {
      date: body.date ?? record.date,
      time: body.time ?? record.time,
      foods: body.foods !== undefined
        ? (Array.isArray(body.foods) ? JSON.stringify(body.foods) : String(body.foods || "[]"))
        : record.foods,
      portion: body.portion ?? record.portion,
      acceptance: body.acceptance !== undefined ? body.acceptance : record.acceptance,
      babyState: body.babyState ?? record.babyState,
      hasAbnormal: body.hasAbnormal !== undefined ? body.hasAbnormal === true : record.hasAbnormal,
      abnormalNotes: body.abnormalNotes !== undefined
        ? (body.abnormalNotes ? String(body.abnormalNotes).trim() : null)
        : record.abnormalNotes,
    };

    if (!isValidDateStr(merged.date)) {
      return NextResponse.json({ error: "date 必须为有效的 YYYY-MM-DD" }, { status: 400 });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(merged.time))) {
      return NextResponse.json({ error: "time 必须为 HH:MM 格式" }, { status: 400 });
    }
    const acc = Number(merged.acceptance);
    if (!Number.isInteger(acc) || acc < 1 || acc > 5) {
      return NextResponse.json({ error: "acceptance 必须为 1-5 的整数" }, { status: 400 });
    }

    const updated = await prisma.foodLogRecord.update({
      where: { id },
      data: {
        date: merged.date,
        time: String(merged.time),
        foods: merged.foods,
        portion: String(merged.portion),
        acceptance: acc,
        babyState: String(merged.babyState),
        hasAbnormal: merged.hasAbnormal,
        abnormalNotes: merged.abnormalNotes,
      },
    });

    return NextResponse.json({
      ...updated,
      foods: safeJsonParse(updated.foods, []),
    });
  } catch (error) {
    console.error("PUT /api/food/logs error:", error);
    return NextResponse.json({ error: "Failed to update food log" }, { status: 500 });
  }
}
