import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { normalizeRelation } from "@/lib/constants";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`family_join:${user.id || ip}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `尝试过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { inviteCode, relation } = body;


    if (!inviteCode || typeof inviteCode !== "string") {
      return NextResponse.json(
        { error: "请输入家庭邀请码" },
        { status: 400 }
      );
    }

    const targetFamily = await prisma.family.findUnique({
      where: { inviteCode: inviteCode.trim().toUpperCase() },
      include: {
        babies: true,
      },
    });

    if (!targetFamily) {
      return NextResponse.json(
        { error: "邀请码无效，未找到对应家庭" },
        { status: 404 }
      );
    }

    // Check if already in family
    const existing = await prisma.familyMember.findUnique({
      where: {
        familyId_userId: {
          familyId: targetFamily.id,
          userId: user.id,
        },
      },
    });

    if (existing) {
      return NextResponse.json({
        message: "您已在该家庭中",
        family: {
          id: targetFamily.id,
          name: targetFamily.name,
          inviteCode: targetFamily.inviteCode,
        },
        baby: targetFamily.babies[0] || null,
      });
    }

    await prisma.familyMember.create({
      data: {
        familyId: targetFamily.id,
        userId: user.id,
        role: "member",
        relation: normalizeRelation(relation),
      },
    });

    return NextResponse.json({
      message: "成功加入家庭！",
      family: {
        id: targetFamily.id,
        name: targetFamily.name,
        inviteCode: targetFamily.inviteCode,
      },
      baby: targetFamily.babies[0] || null,
    });
  } catch (error) {
    console.error("POST /api/family/join error:", error);
    return NextResponse.json(
      { error: "加入家庭失败，请稍后重试" },
      { status: 500 }
    );
  }
}
