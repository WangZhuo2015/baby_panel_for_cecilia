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


    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const records = await prisma.feedingRecord.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: limit,
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

    if (notes !== undefined && notes !== null && String(notes).trim().length > 1000) {
      return NextResponse.json({ error: "notes 不能超过 1000 个字符" }, { status: 400 });
    }

    // 离线 outbox 幂等：携带 clientId 的重放请求不会产生第二条记录
    const clientId =
      typeof body.clientId === "string" && body.clientId.length > 0 && body.clientId.length <= 64
        ? body.clientId
        : null;
    const data = {
      recordedById: user.id,
      timestamp: recordTimestamp,
      type,
      amountMl: parsedAmountMl,
      leftMinutes: parsedLeft,
      rightMinutes: parsedRight,
      spitUp: spitUp === true || spitUp === "true" || spitUp === 1,
      notes: notes ? String(notes).trim() : null,
    };
    const record = clientId
      ? await prisma.feedingRecord.upsert({
          where: { babyId_clientId: { babyId: babyResult.baby.id, clientId } },
          create: { ...data, babyId: babyResult.baby.id, clientId },
          update: {},
        })
      : await prisma.feedingRecord.create({ data: { ...data, babyId: babyResult.baby.id } });


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

    const record = await prisma.feedingRecord.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json({ error: "未找到指定的喂养记录" }, { status: 404 });
    }
    const babyCheck = await getActiveBaby(user.id, record.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    const merged = {
      type: body.type ?? record.type,
      amountMl: body.amountMl !== undefined ? body.amountMl : record.amountMl,
      leftMinutes: body.leftMinutes !== undefined ? body.leftMinutes : record.leftMinutes,
      rightMinutes: body.rightMinutes !== undefined ? body.rightMinutes : record.rightMinutes,
      spitUp: body.spitUp !== undefined
        ? body.spitUp === true || body.spitUp === "true" || body.spitUp === 1
        : record.spitUp,
      notes: body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : record.notes,
      timestamp: body.timestamp ?? record.timestamp,
    };

    const validTypes = ["breast", "formula", "bottle_breast", "mixed", "solid"];
    if (!validTypes.includes(merged.type)) {
      return NextResponse.json(
        { error: "type 只能为 breast、formula、bottle_breast、mixed 或 solid" },
        { status: 400 }
      );
    }
    if (merged.notes !== null && merged.notes !== undefined && String(merged.notes).length > 1000) {
      return NextResponse.json({ error: "notes 不能超过 1000 个字符" }, { status: 400 });
    }

    const numOrNull = (v: unknown, min: number, max: number, label: string): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      if (Number.isNaN(n) || n < min || n > max) {
        throw new RangeError(`${label} 必须为 ${min}-${max} 之间的有效数值`);
      }
      return n;
    };

    try {
      const updatedData = {
        type: merged.type,
        amountMl: numOrNull(merged.amountMl, 0, 3000, "amountMl"),
        leftMinutes: numOrNull(merged.leftMinutes, 0, 180, "leftMinutes"),
        rightMinutes: numOrNull(merged.rightMinutes, 0, 180, "rightMinutes"),
        spitUp: merged.spitUp,
        notes: merged.notes,
        timestamp: (() => {
          const parsed = new Date(merged.timestamp as string);
          if (Number.isNaN(parsed.getTime())) throw new RangeError("timestamp 格式无效");
          return parsed.toISOString();
        })(),
      };
      const updated = await prisma.feedingRecord.update({ where: { id }, data: updatedData });
      return NextResponse.json(updated);
    } catch (e: any) {
      if (e instanceof RangeError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
  } catch (error) {
    console.error("PUT /api/records/feeding error:", error);
    return NextResponse.json({ error: "Failed to update feeding record" }, { status: 500 });
  }
}
