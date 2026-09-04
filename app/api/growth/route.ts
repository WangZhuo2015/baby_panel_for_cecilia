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
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    const data = await records.getGrowthMeasurements(ctx, { limit: searchParams.get("limit") || undefined });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/growth error:", e);
    return NextResponse.json({ error: "Failed to fetch growth measurements" }, { status: 500 });
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
    const rec = await records.createGrowth(ctx, {
      date: body.date,
      weightKg: body.weightKg,
      heightCm: body.heightCm,
      headCircumferenceCm: body.headCircumferenceCm,
      imageUrl: body.imageUrl,
      clientId: body.clientId,
      source: body.source,
      sourceAgent: body.sourceAgent,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("POST /api/growth error:", e);
    return NextResponse.json({ error: "Failed to create growth measurement" }, { status: 500 });
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
    const rec = await prisma.growthMeasurement.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "未找到指定的生长记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    await records.deleteRecord({ userId: auth.user.id, babyId: rec.babyId }, "growth", id);
    return NextResponse.json({ success: true, id });
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("DELETE /api/growth error:", e);
    return NextResponse.json({ error: "Failed to delete growth measurement" }, { status: 500 });
  }
}
