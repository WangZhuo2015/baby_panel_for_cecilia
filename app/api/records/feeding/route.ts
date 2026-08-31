import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";

function mapError(e: unknown) {
  if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden: 您无权访问此宝宝档案" }, { status: 403 });
  // RangeError from legacy numOrNull also maps to 400
  if (e instanceof RangeError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  if (e instanceof Error && e.message.includes("Invalid date format")) return NextResponse.json({ error: e.message }, { status: 400 });
  console.error("records/feeding error:", e);
  return NextResponse.json({ error: "Failed" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user.id, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby, familyId: babyResult.family.id };
    const data = await records.getFeedingRecords(ctx, { date: searchParams.get("date") || undefined, limit: searchParams.get("limit") || undefined });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/records/feeding error:", e);
    return NextResponse.json({ error: "Failed to fetch feeding records" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const babyResult = await requireBaby(auth.user.id, body.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    // Strict validation mirrors original route messages via service helper
    records.validateFeedingStrict(body);
    if (body.notes !== undefined && body.notes !== null && String(body.notes).trim().length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    // Normalize amount fields (allow string numbers)
    const parsedAmount = body.amountMl !== undefined && body.amountMl !== null && body.amountMl !== "" ? Number(body.amountMl) : null;
    const parsedLeft = body.leftMinutes !== undefined && body.leftMinutes !== null && body.leftMinutes !== "" ? Number(body.leftMinutes) : null;
    const parsedRight = body.rightMinutes !== undefined && body.rightMinutes !== null && body.rightMinutes !== "" ? Number(body.rightMinutes) : null;
    const rec = await records.createFeeding(ctx, {
      type: body.type,
      timestamp: body.timestamp,
      amountMl: parsedAmount,
      leftMinutes: parsedLeft,
      rightMinutes: parsedRight,
      spitUp: body.spitUp === true || body.spitUp === "true" || body.spitUp === 1,
      notes: body.notes,
      clientId: body.clientId,
      formulaProductId: body.formulaProductId ? String(body.formulaProductId) : null,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof RangeError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("POST /api/records/feeding error:", e);
    return NextResponse.json({ error: "Failed to create feeding record" }, { status: 500 });
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
    // Need baby check: first fetch record to get babyId, then verify membership via getActiveBaby
    // But service deleteRecord already checks babyId match; we need ctx babyId. Fetch record's babyId via temp lookup using service's direct prisma? Simpler: fetch via prisma here then verify.
    // Use service's deleteRecord with ctx from first baby? Need babyId.
    // Fallback: getActiveBaby check after fetching record via service's internal lookup is not exposed, so we do manual check here like original:
    const { prisma } = await import("@/lib/prisma");
    const rec = await prisma.feedingRecord.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "未找到指定的喂养记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user.id, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    await records.deleteRecord({ userId: auth.user.id, babyId: rec.babyId }, "feeding", id);
    return NextResponse.json({ success: true, id });
  } catch (e) {
    const mapped = mapError(e);
    if ((mapped as any).status !== 500) return mapped;
    console.error("DELETE /api/records/feeding error:", e);
    return NextResponse.json({ error: "Failed to delete feeding record" }, { status: 500 });
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
    const existing = await prisma.feedingRecord.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "未找到指定的喂养记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user.id, existing.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    const ctx = { userId: auth.user.id, babyId: existing.babyId };
    const updated = await records.updateFeeding(ctx, id, body);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof ValidationError || e instanceof RangeError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("PUT /api/records/feeding error:", e);
    return NextResponse.json({ error: "Failed to update feeding record" }, { status: 500 });
  }
}
