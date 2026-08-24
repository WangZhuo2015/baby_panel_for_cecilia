import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signAuthToken,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";
import { config, AUTH_CONFIG } from "@/lib/config";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "请输入用户名和密码" },
        { status: 400 }
      );
    }

    const cleanUsername = String(username).trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { username: cleanUsername },
      include: {
        memberships: {
          include: {
            family: {
              include: {
                babies: {
                  orderBy: { createdAt: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 }
      );
    }

    const token = await signAuthToken({
      userId: user.id,
      username: user.username,
    });

    const primaryFamily = user.memberships[0]?.family;
    const activeBaby = primaryFamily?.babies[0] || null;

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
      },
      family: primaryFamily
        ? {
            id: primaryFamily.id,
            name: primaryFamily.name,
            inviteCode: primaryFamily.inviteCode,
          }
        : null,
      baby: activeBaby,
    });

    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_CONFIG.cookieMaxAge,
    });

    return response;
  } catch (error) {
    console.error("POST /api/auth/login error:", error);
    return NextResponse.json(
      { error: "登录失败，请稍后重试" },
      { status: 500 }
    );
  }
}
