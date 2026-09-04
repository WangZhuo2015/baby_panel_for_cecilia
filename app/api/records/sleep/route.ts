import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby, familyId: babyResult.family.id };
    const data = await records.getSleepRecords(ctx, { date: searchParams.get("date") || undefined, limit: searchParams.get("limit") || undefined });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/records/sleep error:", e);
    return NextResponse.json({ error: "Failed to fetch sleep records" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const babyResult = await requireBaby(auth.user, body.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    if (!body.startTime || typeof body.startTime !== "string" || !body.endTime || typeof body.endTime !== "string") {
      return NextResponse.json({ error: "startTime 和 endTime 必填且必须为有效时间字符串" }, { status: 400 });
    }
    const rec = await records.createSleep(ctx, {
      startTime: body.startTime,
      endTime: body.endTime,
      type: body.type,
      nightWakingCount: body.nightWakingCount,
      notes: body.notes,
      clientId: body.clientId,
      date: body.date,
      source: body.source,
      sourceAgent: body.sourceAgent,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof RangeError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("POST /api/records/sleep error:", e);
    return NextResponse.json({ error: "Failed to create sleep record" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");
    if (!id) { const body = await request.json().catch(() => ({} as any)); id = body?.id; }
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const rec = await prisma.sleepRecord.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ success: true, id, alreadyDeleted: true });
    const babyCheck = await getActiveBaby(auth.user, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    await records.deleteRecord({ userId: auth.user.id, babyId: rec.babyId }, "sleep", id);
    return NextResponse.json({ success: true, id });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("DELETE /api/records/sleep error:", e);
    return NextResponse.json({ error: "Failed to delete sleep record" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id;
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const existing = await prisma.sleepRecord.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "未找到指定的睡眠记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, existing.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    const ctx = { userId: auth.user.id, babyId: existing.babyId };
    const updated = await records.updateSleep(ctx, id, body);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("PUT /api/records/sleep error:", e);
    return NextResponse.json({ error: "Failed to update sleep record" }, { status: 500 });
  }
}
