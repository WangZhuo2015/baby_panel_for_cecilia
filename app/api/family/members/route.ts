import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, getActiveBaby } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskIdentityEndpoints } from "@/lib/growdesk/identity-endpoints";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) return growdeskIdentityEndpoints.familyMembers(request);
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const active = await getActiveBaby(user.id);
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
