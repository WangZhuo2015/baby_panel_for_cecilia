import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signAuthToken,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";
import { config, AUTH_CONFIG } from "@/lib/config";
import { validateCsrfOrigin } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const csrfError = validateCsrfOrigin(request);
    if (csrfError) return csrfError;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`login:${ip}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `登录尝试过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { username, password } = body;


    if (!username || !password || typeof password !== "string" || password.length > 72) {
      return NextResponse.json(
        { error: "请输入正确的用户名和密码" },
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

    // 时序抹平：用户不存在时也执行一次同代价的 bcrypt 比较，防止按响应时间枚举用户名
    const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PxHqXn5rJQWvFPGf1PVLfZGmOB7a";
    const isValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !isValid) {
      return NextResponse.json(
        { error: "用户名或密码错误" },
        { status: 401 }
      );
    }


    const token = await signAuthToken({
      userId: user.id,
      username: user.username,
    });

    const primaryFamily =
      user.memberships.find((m) => m.family.babies.length > 0)?.family ||
      user.memberships[0]?.family;
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
