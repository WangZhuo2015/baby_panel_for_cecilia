import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hashPassword,
  signAuthToken,
  generateInviteCode,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { username, password, displayName, inviteCode, relation } = body;

    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return NextResponse.json(
        { error: "用户名至少需要 3 个字符" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "密码至少需要 6 位" },
        { status: 400 }
      );
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanDisplayName = (displayName && typeof displayName === "string" && displayName.trim())
      ? displayName.trim()
      : cleanUsername;

    const existingUser = await prisma.user.findUnique({
      where: { username: cleanUsername },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "该用户名已被注册，请直接登录或换一个用户名" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    let familyToJoinId: string | null = null;
    let memberRole = "admin";

    if (inviteCode && typeof inviteCode === "string" && inviteCode.trim()) {
      const targetFamily = await prisma.family.findUnique({
        where: { inviteCode: inviteCode.trim().toUpperCase() },
      });
      if (!targetFamily) {
        return NextResponse.json(
          { error: "家庭邀请码无效，请核对后重试" },
          { status: 404 }
        );
      }
      familyToJoinId = targetFamily.id;
      memberRole = "member";
    }

    // Transaction to create User, Family (if new), and FamilyMember
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: cleanUsername,
          passwordHash,
          displayName: cleanDisplayName,
        },
      });

      let family;
      if (familyToJoinId) {
        family = await tx.family.findUniqueOrThrow({
          where: { id: familyToJoinId },
          include: { babies: true },
        });
      } else {
        const newInviteCode = generateInviteCode(6);
        family = await tx.family.create({
          data: {
            name: `${cleanDisplayName}的家`,
            inviteCode: newInviteCode,
          },
          include: { babies: true },
        });
      }

      await tx.familyMember.create({
        data: {
          familyId: family.id,
          userId: user.id,
          role: memberRole,
          relation: (relation && typeof relation === "string") ? relation : "parent",
        },
      });

      return { user, family };
    });

    const token = await signAuthToken({
      userId: result.user.id,
      username: result.user.username,
    });

    const response = NextResponse.json(
      {
        user: {
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.displayName,
        },
        family: {
          id: result.family.id,
          name: result.family.name,
          inviteCode: result.family.inviteCode,
        },
        baby: result.family.babies[0] || null,
      },
      { status: 201 }
    );

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error) {
    console.error("POST /api/auth/register error:", error);
    return NextResponse.json(
      { error: "注册失败，请稍后重试" },
      { status: 500 }
    );
  }
}
