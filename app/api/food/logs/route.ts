import { legacyListQuery } from "@/lib/growdesk/legacy-list-query";
import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";
import { BridgeError, bridgeErrorResponse, wireVersion } from "@/lib/growdesk/bridge-protocol";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  toGrowDeskFoodCreatePayload,
  toGrowDeskFoodUpdatePayload,
  fromGrowDeskFoodRecord,
  type GrowDeskFoodRecord,
} from "@/lib/growdesk/food-compat";
import { fetchLegacyRecordList } from "@/lib/growdesk/record-list";
import { fetchRecordDetail, idempotencyKey, readJsonObject, recordPath, requireWriteData } from "@/lib/growdesk/record-route-helpers";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const babyId = searchParams.get("babyId");
      if (!babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      const recordId = searchParams.get("id");
      const extended = request.headers.get("x-growdesk-representation") === "extended";
      if (recordId) {
        const record = await fetchRecordDetail<GrowDeskFoodRecord>(growdeskFetch, bffSession.accessToken, babyId, recordId, "food");
        return NextResponse.json(fromGrowDeskFoodRecord(record, extended), { headers: { "cache-control": "no-store" } });
      }
      const list = await fetchLegacyRecordList<GrowDeskFoodRecord>(growdeskFetch, bffSession.accessToken, babyId, legacyListQuery(searchParams), "food");
      return NextResponse.json(list.map(record => fromGrowDeskFoodRecord(record, extended)), { headers: { "cache-control": "no-store" } });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    const data = await records.getFoodLogRecords(ctx, { date: searchParams.get("date") || undefined, limit: searchParams.get("limit") || undefined });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/food/logs error:", e);
    return NextResponse.json({ error: "Failed to fetch food log records" }, { status: 500 });
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
      const body = await readJsonObject(request);
      const babyId = body.babyId;
      if (typeof babyId !== "string" || !babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      const res = await growdeskFetch<GrowDeskFoodRecord>(recordPath("food", babyId), {
        method: "POST",
        accessToken: bffSession.accessToken,
        idempotencyKey: idempotencyKey(body, request),
        body: toGrowDeskFoodCreatePayload(body),
      });
      const data = requireWriteData(res, "Failed to create food log record");
      return NextResponse.json(fromGrowDeskFoodRecord(data, request.headers.get("x-growdesk-representation") === "extended"), { status: 201 });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const babyResult = await requireBaby(auth.user, body.babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    const rec = await records.createFoodLog(ctx, {
      date: body.date,
      time: body.time,
      foods: body.foods,
      portion: body.portion,
      acceptance: body.acceptance,
      babyState: body.babyState,
      hasAbnormal: body.hasAbnormal,
      abnormalNotes: body.abnormalNotes,
      clientId: body.clientId,
      source: body.source,
      sourceAgent: body.sourceAgent,
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("POST /api/food/logs error:", e);
    return NextResponse.json({ error: "Failed to create food log record" }, { status: 500 });
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
      let body: Record<string, unknown> = {};
      let id = searchParams.get("id");
      let babyId = searchParams.get("babyId");
      let baseVersion: unknown = searchParams.get("baseVersion");
      if (!id || !babyId || baseVersion === null) {
        body = await readJsonObject(request);
        id = id || (typeof body.id === "string" ? body.id : null);
        babyId = babyId || (typeof body.babyId === "string" ? body.babyId : null);
        baseVersion = body.baseVersion ?? body.version ?? baseVersion;
      }
      if (!id) return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
      if (!babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      const version = wireVersion(baseVersion);
      const res = await growdeskFetch(recordPath("food", babyId, id) + `?baseVersion=${encodeURIComponent(version)}`, {
        method: "DELETE",
        accessToken: bffSession.accessToken,
        idempotencyKey: idempotencyKey(body, request),
      });
      if (!res.ok) return NextResponse.json({ error: res.error?.message || "Failed to delete food log" }, { status: res.status });
      return NextResponse.json({ success: true, id });
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");
    if (!id) { const body = await request.json().catch(() => ({} as any)); id = body?.id; }
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const rec = await prisma.foodLogRecord.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "未找到指定的辅食记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    await records.deleteRecord({ userId: auth.user.id, babyId: rec.babyId }, "food", id);
    return NextResponse.json({ success: true, id });
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("DELETE /api/food/logs error:", e);
    return NextResponse.json({ error: "Failed to delete food log" }, { status: 500 });
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
      const body = await readJsonObject(request);
      const id = body.id;
      const babyId = body.babyId;
      if (typeof id !== "string" || !id) return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
      if (typeof babyId !== "string" || !babyId) return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      // Read before a notes/observation patch so omitted legacy observations survive.
      // The caller's baseVersion still guards the subsequent write against races.
      const existing = await fetchRecordDetail<GrowDeskFoodRecord>(growdeskFetch, bffSession.accessToken, babyId, id, "food");
      const res = await growdeskFetch<GrowDeskFoodRecord>(recordPath("food", babyId, id), {
        method: "PATCH",
        accessToken: bffSession.accessToken,
        idempotencyKey: idempotencyKey(body, request),
        body: toGrowDeskFoodUpdatePayload(body, existing),
      });
      const data = requireWriteData(res, "Failed to update food log record");
      return NextResponse.json(fromGrowDeskFoodRecord(data, request.headers.get("x-growdesk-representation") === "extended"));
    }
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id;
    if (!id || typeof id !== "string") return NextResponse.json({ error: "请提供要修改的记录 ID" }, { status: 400 });
    const { prisma } = await import("@/lib/prisma");
    const existing = await prisma.foodLogRecord.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "未找到指定的辅食记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, existing.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    const ctx = { userId: auth.user.id, babyId: existing.babyId };
    const updated = await records.updateFoodLog(ctx, id, body);
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("PUT /api/food/logs error:", e);
    return NextResponse.json({ error: "Failed to update food log" }, { status: 500 });
  }
}
