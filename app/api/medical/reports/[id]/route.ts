import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthSession(request);
    const activeBabyInfo = user ? await getActiveBabyForUser(user.id) : null;
    const baby = activeBabyInfo?.baby || (await prisma.baby.findFirst());

    if (!baby) {
      return NextResponse.json({ error: "未找到宝宝档案" }, { status: 404 });
    }

    const report = await prisma.medicalReport.findUnique({
      where: { id },
    });

    if (!report || report.babyId !== baby.id) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    return NextResponse.json({
      ...report,
      items: JSON.parse(report.itemsJson || "[]"),
    });
  } catch (error: any) {
    console.error("GET /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "获取报告详情失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthSession(request);
    const activeBabyInfo = user ? await getActiveBabyForUser(user.id) : null;
    const baby = activeBabyInfo?.baby || (await prisma.baby.findFirst());

    if (!baby) {
      return NextResponse.json({ error: "未找到宝宝档案" }, { status: 404 });
    }

    const report = await prisma.medicalReport.findUnique({ where: { id } });
    if (!report || report.babyId !== baby.id) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    const body = await request.json();
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = String(body.title).trim();
    if (body.category !== undefined) updateData.category = body.category;
    if (body.date !== undefined) updateData.date = String(body.date).trim();
    if (body.hospital !== undefined) updateData.hospital = body.hospital;
    if (body.doctorNotes !== undefined) updateData.doctorNotes = body.doctorNotes;
    if (body.aiSummary !== undefined) updateData.aiSummary = body.aiSummary;
    if (body.items !== undefined) updateData.itemsJson = JSON.stringify(body.items);
    if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;

    const updated = await prisma.medicalReport.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      ...updated,
      items: JSON.parse(updated.itemsJson || "[]"),
    });
  } catch (error: any) {
    console.error("PATCH /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "更新报告失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthSession(request);
    const activeBabyInfo = user ? await getActiveBabyForUser(user.id) : null;
    const baby = activeBabyInfo?.baby || (await prisma.baby.findFirst());

    if (!baby) {
      return NextResponse.json({ error: "未找到宝宝档案" }, { status: 404 });
    }

    const report = await prisma.medicalReport.findUnique({ where: { id } });
    if (!report || report.babyId !== baby.id) {
      return NextResponse.json({ error: "报告不存在" }, { status: 404 });
    }

    await prisma.medicalReport.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/medical/reports/[id] error:", error);
    return NextResponse.json({ error: "删除报告失败" }, { status: 500 });
  }
}
