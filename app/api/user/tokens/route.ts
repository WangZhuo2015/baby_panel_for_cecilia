import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  MAX_TOKENS_PER_USER,
} from "@/lib/tokens";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const tokens = await listPersonalAccessTokens(auth.user.id);
    return NextResponse.json({ success: true, tokens });
  } catch (error: any) {
    console.error("GET /api/user/tokens error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "获取令牌失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`user_tokens:${auth.user.id}:${ip}`, 10, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { success: false, error: `创建过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const existing = await prisma.personalAccessToken.count({ where: { userId: auth.user.id } });
    if (existing >= MAX_TOKENS_PER_USER) {
      return NextResponse.json(
        { success: false, error: `令牌数量已达上限（${MAX_TOKENS_PER_USER} 个），请先删除旧令牌` },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "我的快捷指令";

    const created = await createPersonalAccessToken(auth.user.id, name);
    return NextResponse.json({ success: true, token: created });
  } catch (error: any) {
    console.error("POST /api/user/tokens error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "创建令牌失败" },
      { status: 500 }
    );
  }
}
