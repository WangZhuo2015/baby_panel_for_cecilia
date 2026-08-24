import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import { getLocalDayUtcRange, isValidDateStr, getLocalDateStr } from "@/lib/date";

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

    const trimmedStart = startTime.trim();
    const trimmedEnd = endTime.trim();
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

    let finalStartIso: string;
    let finalEndIso: string;

    if (timeRegex.test(trimmedStart) && timeRegex.test(trimmedEnd)) {
      const targetDate = (body.date && isValidDateStr(body.date)) ? body.date : getLocalDateStr();
      const startMs = new Date(`${targetDate}T${trimmedStart.padStart(5, "0")}:00+08:00`).getTime();
      let endMs = new Date(`${targetDate}T${trimmedEnd.padStart(5, "0")}:00+08:00`).getTime();
      if (endMs <= startMs) {
        endMs += 24 * 60 * 60 * 1000; // Cross midnight
      }
      finalStartIso = new Date(startMs).toISOString();
      finalEndIso = new Date(endMs).toISOString();
    } else {
      const startMs = new Date(trimmedStart).getTime();
      const endMs = new Date(trimmedEnd).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return NextResponse.json(
          { error: "时间格式不正确，请输入 HH:MM 或标准 ISO 时间戳" },
          { status: 400 }
        );
      }
      if (endMs <= startMs) {
        return NextResponse.json(
          { error: "醒来时间必须晚于入睡时间" },
          { status: 400 }
        );
      }
      finalStartIso = new Date(startMs).toISOString();
      finalEndIso = new Date(endMs).toISOString();
    }

    // 统一守卫：拒绝零时长（会被跨天逻辑放大成 24h）；单段时长上限 20h；防未来毒化数据
    const durationMs = new Date(finalEndIso).getTime() - new Date(finalStartIso).getTime();
    if (durationMs <= 0) {
      return NextResponse.json({ error: "入睡与醒来时间不能相同" }, { status: 400 });
    }
    if (durationMs > 20 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "单次睡眠时长不能超过 20 小时" }, { status: 400 });
    }
    if (new Date(finalStartIso).getTime() > Date.now() + 48 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "睡眠开始时间不能在未来两天以后" }, { status: 400 });
    }

    const sleepType = type === "night" ? "night" : "day";
    const wakingCount = typeof nightWakingCount === "number" && nightWakingCount >= 0
      ? Math.floor(nightWakingCount)
      : 0;

    const record = await prisma.sleepRecord.create({
      data: {
        babyId: babyResult.baby.id,
        recordedById: user.id,
        startTime: finalStartIso,
        endTime: finalEndIso,
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

    const record = await prisma.sleepRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "未找到指定的睡眠记录" }, { status: 404 });
    }
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    // 编辑入口统一传 ISO 或 HH:MM+date；与 POST 相同的归一化规则
    const trimmedStart = String(body.startTime ?? record.startTime).trim();
    const trimmedEnd = String(body.endTime ?? record.endTime).trim();
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

    let finalStartIso: string;
    let finalEndIso: string;

    if (timeRegex.test(trimmedStart) && timeRegex.test(trimmedEnd)) {
      const targetDate =
        body.date && isValidDateStr(body.date)
          ? body.date
          : getLocalDateStr(new Date(record.startTime));
      const startMs = new Date(`${targetDate}T${trimmedStart.padStart(5, "0")}:00+08:00`).getTime();
      let endMs = new Date(`${targetDate}T${trimmedEnd.padStart(5, "0")}:00+08:00`).getTime();
      if (endMs <= startMs) endMs += 24 * 60 * 60 * 1000;
      finalStartIso = new Date(startMs).toISOString();
      finalEndIso = new Date(endMs).toISOString();
    } else {
      const startMs = new Date(trimmedStart).getTime();
      const endMs = new Date(trimmedEnd).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return NextResponse.json({ error: "时间格式不正确" }, { status: 400 });
      }
      finalStartIso = new Date(startMs).toISOString();
      finalEndIso = new Date(endMs).toISOString();
    }

    const durationMs = new Date(finalEndIso).getTime() - new Date(finalStartIso).getTime();
    if (durationMs <= 0) {
      return NextResponse.json({ error: "入睡与醒来时间不能相同" }, { status: 400 });
    }
    if (durationMs > 20 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "单次睡眠时长不能超过 20 小时" }, { status: 400 });
    }

    const sleepType = body.type !== undefined ? (body.type === "night" ? "night" : "day") : record.type;
    const wakingCount = body.nightWakingCount !== undefined
      ? (typeof body.nightWakingCount === "number" && body.nightWakingCount >= 0
          ? Math.floor(body.nightWakingCount)
          : 0)
      : record.nightWakingCount;
    const notes = body.notes !== undefined
      ? (body.notes ? String(body.notes).trim() : null)
      : record.notes;

    const updated = await prisma.sleepRecord.update({
      where: { id },
      data: {
        startTime: finalStartIso,
        endTime: finalEndIso,
        type: sleepType,
        nightWakingCount: wakingCount,
        notes,
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("PUT /api/records/sleep error:", error);
    return NextResponse.json({ error: "Failed to update sleep record" }, { status: 500 });
  }
}
