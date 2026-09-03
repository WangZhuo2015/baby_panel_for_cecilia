import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`family_preview:${ip}`, 30, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `请求过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim().toUpperCase();

    if (!code || code.length < 4 || code.length > 16) {
      return NextResponse.json(
        { error: "请输入有效的邀请码" },
        { status: 400 }
      );
    }

    const family = await prisma.family.findUnique({
      where: { inviteCode: code },
      include: {
        babies: {
          select: {
            id: true,
            nickname: true,
            gender: true,
            birthDate: true,
            avatarUrl: true,
          },
        },
        members: {
          select: {
            role: true,
            relation: true,
            user: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (!family) {
      return NextResponse.json(
        { found: false, error: "未找到该家庭，请核对邀请码" },
        { status: 404 }
      );
    }

    const adminMember = family.members.find((m) => m.role === "admin");
    const baby = family.babies[0] || null;

    return NextResponse.json({
      found: true,
      family: {
        id: family.id,
        name: family.name,
        inviteCode: family.inviteCode,
        memberCount: family.members.length,
        adminName: adminMember?.user.displayName || "家庭管理员",
      },
      baby: baby
        ? {
            nickname: baby.nickname,
            gender: baby.gender,
            birthDate: baby.birthDate,
            avatarUrl: baby.avatarUrl,
          }
        : null,
    });
  } catch (error) {
    console.error("GET /api/family/preview error:", error);
    return NextResponse.json(
      { error: "查询家庭信息失败" },
      { status: 500 }
    );
  }
}
