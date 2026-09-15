import { GROWDESK_CONFIG } from "@/lib/config";
import { medicalDetailBridge } from "@/lib/growdesk/medical-detail-bridge";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (GROWDESK_CONFIG.enabled) return medicalDetailBridge(request, (await params).id);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;

    const report = await prisma.medicalReport.findUnique({
      where: { id },
    });

    if (!report) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    const babyCheck = await getActiveBaby(user.id, report.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    return NextResponse.json({
      ...report,
      items: safeJsonParse(report.itemsJson, []),
    });
  } catch (error: any) {
    console.error("GET /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "获取报告详情失败" }, { status: 500 });
  }
}

async function handleUpdate(
  request: Request,
  params: Promise<{ id: string }>
) {
  if (GROWDESK_CONFIG.enabled) return medicalDetailBridge(request, (await params).id);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;

    const report = await prisma.medicalReport.findUnique({ where: { id } });
    if (!report) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    const babyCheck = await getActiveBaby(user.id, report.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    const body = await request.json().catch(() => ({}));
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = String(body.title).trim();
    if (body.category !== undefined) updateData.category = body.category;
    if (body.date !== undefined) updateData.date = String(body.date).trim();
    if (body.hospital !== undefined) updateData.hospital = body.hospital;
    if (body.doctorNotes !== undefined) updateData.doctorNotes = body.doctorNotes;
    if (body.aiSummary !== undefined) updateData.aiSummary = body.aiSummary;
    if (body.items !== undefined) updateData.itemsJson = JSON.stringify(Array.isArray(body.items) ? body.items : []);
    if (body.imageUrl !== undefined) {
      const trimmed = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
      if (trimmed && !/^\/uploads\/medical\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(trimmed)) {
        return NextResponse.json({ error: "imageUrl 仅支持本站 /uploads/medical/ 路径的图片" }, { status: 400 });
      }
      updateData.imageUrl = trimmed || null;
    }

    const updated = await prisma.medicalReport.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      ...updated,
      items: safeJsonParse(updated.itemsJson, []),
    });
  } catch (error: any) {
    console.error("PUT/PATCH /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "更新报告失败" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUpdate(request, params);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleUpdate(request, params);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (GROWDESK_CONFIG.enabled) return medicalDetailBridge(request, (await params).id);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { id } = await params;

    const report = await prisma.medicalReport.findUnique({ where: { id } });
    if (!report) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    const babyCheck = await getActiveBaby(user.id, report.babyId);
    if (babyCheck.errorResponse) return babyCheck.errorResponse;

    await prisma.medicalReport.delete({ where: { id } });

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error("DELETE /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "删除报告失败" }, { status: 500 });
  }
}
