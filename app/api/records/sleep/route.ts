import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  toGrowDeskSleepCreatePayload,
  toGrowDeskSleepUpdatePayload,
  fromGrowDeskSleepRecord,
  type GrowDeskSleepRecord,
} from "@/lib/growdesk/sleep-compat";
import crypto from "node:crypto";

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
      const res = await growdeskFetch<Array<GrowDeskSleepRecord>>(
        `/api/v1/babies/${babyId}/records/sleep?limit=${limit}`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch sleep records" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      return NextResponse.json(rawList.map(fromGrowDeskSleepRecord));
    }

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

      const payload = toGrowDeskSleepCreatePayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskSleepRecord>(
        `/api/v1/babies/${babyId}/records/sleep`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to create sleep record" },
          { status: res.status },
        );
      }

      return NextResponse.json(fromGrowDeskSleepRecord(res.data), { status: 201 });
    }

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
        `/api/v1/babies/${babyId}/records/sleep/${id}?baseVersion=${baseVersion}`,
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
          { error: res.error?.message || "Failed to delete sleep record" },
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

      const payload = toGrowDeskSleepUpdatePayload(body);
      const res = await growdeskFetch<GrowDeskSleepRecord>(
        `/api/v1/babies/${babyId}/records/sleep/${id}`,
        {
          method: "PATCH",
          accessToken: bffSession.accessToken,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to update sleep record" },
          { status: res.status },
        );
      }

      return NextResponse.json(fromGrowDeskSleepRecord(res.data));
    }

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

export async function PATCH(request: Request) {
  return PUT(request);
}
