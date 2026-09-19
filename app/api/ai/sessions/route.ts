import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { growdeskFetch } from "@/lib/growdesk/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (GROWDESK_CONFIG.enabled) {
    try {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const url = new URL(request.url);
      const babyId = url.searchParams.get("babyId");
      const contextType = url.searchParams.get("contextType");
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));
      const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

      if (babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, babyId);
        if (!baby) {
          return NextResponse.json({ error: "未找到该宝宝档案" }, { status: 404 });
        }
      }

      const { total, sessions } = await bffAiSessionStore.listSessions(bffSession.user.id, {
        babyId,
        contextType,
        limit,
        offset,
        accessToken: bffSession.accessToken,
      });

      return NextResponse.json({ total, sessions });
    } catch (error) {
      return bridgeErrorResponse(error);
    }
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const url = new URL(request.url);
  const babyId = url.searchParams.get("babyId");
  const contextType = url.searchParams.get("contextType");
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));

  if (babyId) {
    const babyResult = await requireBaby(user.id, babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
  }

  const normalizedContextType =
    typeof contextType === "string" && contextType.trim() ? contextType.trim() : null;
  const where: any = { userId: user.id };
  if (babyId) where.babyId = babyId;
  if (normalizedContextType) where.contextType = normalizedContextType;

  const [total, sessions] = await Promise.all([
    prisma.aiChatSession.count({ where }),
    prisma.aiChatSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: {
          select: { messages: true },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const formatted = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    contextType: s.contextType,
    babyId: s.babyId,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    messageCount: s._count.messages,
    lastMessage: s.messages[0]
      ? {
          id: s.messages[0].id,
          role: s.messages[0].role,
          content: s.messages[0].content.slice(0, 100),
          createdAt: s.messages[0].createdAt.toISOString(),
        }
      : null,
  }));

  return NextResponse.json({ total, sessions: formatted });
}

export async function POST(request: Request) {
  if (GROWDESK_CONFIG.enabled) {
    try {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const ip = getClientIp(request);
      const rateLimit = checkRateLimit(`ai_sessions:${bffSession.user.id}:${ip}`, 30, 60_000);
      if (!rateLimit.success) {
        return NextResponse.json(
          { error: `创建过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
          { status: 429 }
        );
      }

      const body = await request.json().catch(() => ({}));
      const { babyId, title } = body;
      const contextType =
        typeof body.contextType === "string" && body.contextType.trim()
          ? body.contextType.trim()
          : "general";

      let targetBabyId: string | null = null;
      if (babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken, babyId);
        if (!baby) {
          return NextResponse.json({ error: "未找到该宝宝档案" }, { status: 404 });
        }
        targetBabyId = baby.id;
      } else {
        const defaultBaby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        targetBabyId = defaultBaby?.id || null;
      }

      const session = await bffAiSessionStore.createSession({
        userId: bffSession.user.id,
        babyId: targetBabyId,
        title,
        contextType,
        accessToken: bffSession.accessToken,
      });

      return NextResponse.json({
        session: {
          id: session.id,
          title: session.title,
          contextType: session.contextType,
          babyId: session.babyId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messages: [],
        },
      });
    } catch (error) {
      return bridgeErrorResponse(error);
    }
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`ai_sessions:${user.id}:${ip}`, 30, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: `创建过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { babyId, title } = body;
  const contextType =
    typeof body.contextType === "string" && body.contextType.trim()
      ? body.contextType.trim()
      : "general";

  let targetBabyId: string | null = null;
  if (babyId) {
    const babyRes = await requireBaby(user.id, babyId);
    if (babyRes.errorResponse) return babyRes.errorResponse;
    targetBabyId = babyRes.baby.id;
  } else {
    const defaultBaby = await prisma.baby.findFirst({
      where: { family: { members: { some: { userId: user.id } } } },
    });
    targetBabyId = defaultBaby?.id || null;
  }

  const session = await prisma.aiChatSession.create({
    data: {
      userId: user.id,
      babyId: targetBabyId,
      title: typeof title === "string" && title.trim() ? title.trim().slice(0, 50) : "新对话",
      contextType,
    },
  });

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      contextType: session.contextType,
      babyId: session.babyId,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messages: [],
    },
  });
}
