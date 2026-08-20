import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthSession(request);
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }

    const active = await getActiveBabyForUser(user.id);
    if (!active?.family) {
      return NextResponse.json({ members: [], inviteCode: null });
    }

    const members = await prisma.familyMember.findMany({
      where: { familyId: active.family.id },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      family: {
        id: active.family.id,
        name: active.family.name,
        inviteCode: active.family.inviteCode,
      },
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        username: m.user.username,
        displayName: m.user.displayName,
        role: m.role,
        relation: m.relation,
        joinedAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/family/members error:", error);
    return NextResponse.json(
      { error: "获取家庭成员列表失败" },
      { status: 500 }
    );
  }
}
