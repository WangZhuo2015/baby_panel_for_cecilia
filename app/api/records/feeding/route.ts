import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import {
  toGrowDeskFeedingCreatePayload,
  toGrowDeskFeedingUpdatePayload,
  fromGrowDeskFeedingRecord,
  type GrowDeskFeedingRecord,
} from "@/lib/growdesk/feeding-compat";
import crypto from "node:crypto";

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
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const babyId = searchParams.get("babyId");
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      const limit = searchParams.get("limit") || "50";
      const res = await growdeskFetch<Array<GrowDeskFeedingRecord>>(
        `/api/v1/babies/${babyId}/records/feeding?limit=${limit}`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch feeding records" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      return NextResponse.json(rawList.map(fromGrowDeskFeedingRecord));
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({} as any));
      const babyId = body.babyId;
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const payload = toGrowDeskFeedingCreatePayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskFeedingRecord>(
        `/api/v1/babies/${babyId}/records/feeding`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to create feeding record" },
          { status: res.status },
        );
      }

      return NextResponse.json(fromGrowDeskFeedingRecord(res.data), { status: 201 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const babyResult = await requireBaby(auth.user, body.babyId);
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
      source: body.source,
      sourceAgent: body.sourceAgent,
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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      let id = searchParams.get("id");
      let babyId = searchParams.get("babyId");
      let baseVersion = searchParams.get("baseVersion") || "1";
      if (!id) {
        const body = await request.json().catch(() => ({} as any));
        id = body?.id;
        babyId = babyId || body?.babyId;
        baseVersion = String(body?.baseVersion || baseVersion);
      }
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const res = await growdeskFetch(
        `/api/v1/babies/${babyId}/records/feeding/${id}?baseVersion=${baseVersion}`,
        {
          method: "DELETE",
          accessToken: bffSession.accessToken,
        },
      );

      if (!res.ok) {
        if (res.status === 404) {
          return NextResponse.json({ success: true, id, alreadyDeleted: true });
        }
        return NextResponse.json(
          { error: res.error?.message || "Failed to delete feeding record" },
          { status: res.status },
        );
      }

      return NextResponse.json({ success: true, id });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");
    if (!id) { const body = await request.json().catch(() => ({} as any)); id = body?.id; }
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const rec = await prisma.feedingRecord.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ success: true, id, alreadyDeleted: true });
    const babyCheck = await getActiveBaby(auth.user, rec.babyId);
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
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({} as any));
      const id = body?.id;
      const babyId = body?.babyId;
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const payload = toGrowDeskFeedingUpdatePayload(body);
      const res = await growdeskFetch<GrowDeskFeedingRecord>(
        `/api/v1/babies/${babyId}/records/feeding/${id}`,
        {
          method: "PATCH",
          accessToken: bffSession.accessToken,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to update feeding record" },
          { status: res.status },
        );
      }

      return NextResponse.json(fromGrowDeskFeedingRecord(res.data));
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id;
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const existing = await prisma.feedingRecord.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "未找到指定的喂养记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, existing.babyId);
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
