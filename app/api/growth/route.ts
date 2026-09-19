import { NextResponse } from "next/server";
import { requireAuth, requireBaby, getActiveBaby } from "@/lib/api-helpers";
import * as records from "@/lib/records/service";
import { ValidationError, NotFoundError, ForbiddenError } from "@/lib/records/service";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  toGrowDeskGrowthCreatePayload,
  toGrowDeskGrowthUpdatePayload,
  fromGrowDeskGrowthRecord,
  type GrowDeskGrowthRecord,
} from "@/lib/growdesk/growth-compat";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { BridgeError, bridgeErrorResponse, wireVersion } from "@/lib/growdesk/bridge-protocol";
import crypto from "node:crypto";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      let babyId = searchParams.get("babyId");
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      const limit = searchParams.get("limit") || "50";
      const res = await growdeskFetch<Array<GrowDeskGrowthRecord>>(
        `/api/v1/babies/${babyId}/growth-measurements?limit=${limit}`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to fetch growth measurements" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, babyId);
      return NextResponse.json(rawList.map((record: GrowDeskGrowthRecord) => fromGrowDeskGrowthRecord(record, baby?.birthDate)));
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { searchParams } = new URL(request.url);
    const babyResult = await requireBaby(auth.user, searchParams.get("babyId"));
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const ctx = { userId: auth.user.id, babyId: babyResult.baby.id, baby: babyResult.baby };
    const data = await records.getGrowthMeasurements(ctx, { limit: searchParams.get("limit") || undefined });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("GET /api/growth error:", e);
    return NextResponse.json({ error: "Failed to fetch growth measurements" }, { status: 500 });
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

      const payload = toGrowDeskGrowthCreatePayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskGrowthRecord>(
        `/api/v1/babies/${babyId}/growth-measurements`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to create growth measurement" },
          { status: res.status },
        );
      }

      return NextResponse.json(fromGrowDeskGrowthRecord(res.data), { status: 201 });
    }

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
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    console.error("POST /api/growth error:", e);
    return NextResponse.json({ error: "Failed to create growth measurement" }, { status: 500 });
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
      let rawVersion = searchParams.get("baseVersion");
      if (!id) {
        const body = await request.json().catch(() => ({} as any));
        id = body?.id;
        babyId = babyId || body?.babyId;
        rawVersion = rawVersion || body?.baseVersion || body?.version;
      }
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供要删除的记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const baseVersion = wireVersion(rawVersion || "1");

      const res = await growdeskFetch(
        `/api/v1/babies/${babyId}/growth-measurements/${id}?baseVersion=${baseVersion}`,
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
          { error: res.error?.message || "Failed to delete growth measurement" },
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
    const rec = await prisma.growthMeasurement.findUnique({ where: { id } });
    if (!rec) return NextResponse.json({ error: "未找到指定的生长记录" }, { status: 404 });
    const babyCheck = await getActiveBaby(auth.user, rec.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;
    await records.deleteRecord({ userId: auth.user.id, babyId: rec.babyId }, "growth", id);
    return NextResponse.json({ success: true, id });
  } catch (e) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    console.error("DELETE /api/growth error:", e);
    return NextResponse.json({ error: "Failed to delete growth measurement" }, { status: 500 });
  }
}

async function handleUpdate(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({} as any));
      const { searchParams } = new URL(request.url);
      const id = body.id || searchParams.get("id");
      let babyId = body.babyId || searchParams.get("babyId");
      if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "请提供生长记录 ID" }, { status: 400 });
      }
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const payload = toGrowDeskGrowthUpdatePayload(body);
      const res = await growdeskFetch<GrowDeskGrowthRecord>(
        `/api/v1/babies/${babyId}/growth-measurements/${id}`,
        {
          method: "PATCH",
          accessToken: bffSession.accessToken,
          body: payload,
        }
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "Failed to update growth measurement" },
          { status: res.status }
        );
      }

      return NextResponse.json(fromGrowDeskGrowthRecord(res.data));
    }

    return NextResponse.json({ error: "Not implemented in local mode" }, { status: 501 });
  } catch (e: any) {
    if (e instanceof BridgeError) return bridgeErrorResponse(e);
    console.error("UPDATE /api/growth error:", e);
    return NextResponse.json({ error: e?.message || "Failed to update growth measurement" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  return handleUpdate(request);
}

export async function PUT(request: Request) {
  return handleUpdate(request);
}
