import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { activeChatRunManager } from "@/lib/agent";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(request.url);
  const requestedBabyId = url.searchParams.get("babyId");
  const requestedContextType = url.searchParams.get("contextType")?.trim() || null;

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const session = await bffAiSessionStore.getSession(id, bffSession.user.id, {
      babyId: requestedBabyId,
      contextType: requestedContextType,
      accessToken: bffSession.accessToken,
    });

    if (!session) {
      return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
    }

    if (
      (requestedBabyId && session.babyId !== requestedBabyId) ||
      (requestedContextType && session.contextType !== requestedContextType)
    ) {
      return NextResponse.json(
        { error: "会话所属宝宝或领域与当前请求不匹配" },
        { status: 409 }
      );
    }

    const formatted = {
      id: session.id,
      title: session.title,
      contextType: session.contextType,
      babyId: session.babyId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: (session.messages || []).map((m) => {
        let imagesList: string[] = [];
        if (m.image) {
          if (m.image.startsWith("[")) {
            try {
              const parsed = JSON.parse(m.image);
              if (Array.isArray(parsed)) imagesList = parsed;
            } catch {
              imagesList = [m.image];
            }
          } else {
            imagesList = [m.image];
          }
        }
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          image: m.image,
          images: imagesList.length > 0 ? imagesList : undefined,
          tools: m.toolsJson ? safeJsonParse(m.toolsJson, []) : [],
          createdAt: m.createdAt,
        };
      }),
    };

    const activeRun = activeChatRunManager.get(session.id);
    const activeRunData =
      activeRun && activeRun.userId === bffSession.user.id && activeRun.status === "running"
        ? {
            status: "running",
            fullText: activeRun.fullText,
            toolTraces: activeRun.toolTraces,
          }
        : null;

    return NextResponse.json({ session: formatted, activeRun: activeRunData });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const session = await prisma.aiChatSession.findFirst({
    where: { id, userId: user.id },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
  }
  if (
    (requestedBabyId && session.babyId !== requestedBabyId) ||
    (requestedContextType && session.contextType !== requestedContextType)
  ) {
    return NextResponse.json(
      { error: "会话所属宝宝或领域与当前请求不匹配" },
      { status: 409 }
    );
  }

  const formatted = {
    id: session.id,
    title: session.title,
    contextType: session.contextType,
    babyId: session.babyId,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messages: session.messages.map((m) => {
      let imagesList: string[] = [];
      if (m.image) {
        if (m.image.startsWith("[")) {
          try {
            const parsed = JSON.parse(m.image);
            if (Array.isArray(parsed)) imagesList = parsed;
          } catch {
            imagesList = [m.image];
          }
        } else {
          imagesList = [m.image];
        }
      }
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        image: m.image,
        images: imagesList.length > 0 ? imagesList : undefined,
        tools: m.toolsJson ? safeJsonParse(m.toolsJson, []) : [],
        createdAt: m.createdAt.toISOString(),
      };
    }),
  };

  const activeRun = activeChatRunManager.get(session.id);
  const activeRunData =
    activeRun && activeRun.userId === user.id && activeRun.status === "running"
      ? {
          status: "running",
          fullText: activeRun.fullText,
          toolTraces: activeRun.toolTraces,
        }
      : null;

  return NextResponse.json({ session: formatted, activeRun: activeRunData });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 50) : undefined;

  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const updated = await bffAiSessionStore.updateSessionTitle(
      id,
      bffSession.user.id,
      title,
      bffSession.accessToken
    );

    if (!updated) {
      return NextResponse.json({ error: "对话会话不存在" }, { status: 404 });
    }

    return NextResponse.json({ session: updated });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const session = await prisma.aiChatSession.findFirst({
    where: { id, userId: user.id },
  });

  if (!session) {
    return NextResponse.json({ error: "对话会话不存在" }, { status: 404 });
  }

  const updated = await prisma.aiChatSession.update({
    where: { id },
    data: { title },
  });

  return NextResponse.json({ session: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    await activeChatRunManager.cancelRun(id, bffSession.user.id);
    activeChatRunManager.delete(id);

    const deleted = await bffAiSessionStore.deleteSession(id, bffSession.user.id, bffSession.accessToken);
    if (!deleted) {
      return NextResponse.json({ error: "对话会话不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true, id });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const session = await prisma.aiChatSession.findFirst({
    where: { id, userId: user.id },
  });

  if (!session) {
    return NextResponse.json({ error: "对话会话不存在" }, { status: 404 });
  }

  await activeChatRunManager.cancelRun(id, user.id);
  activeChatRunManager.delete(id);

  await prisma.aiChatSession.delete({
    where: { id },
  });

  return NextResponse.json({ success: true, id });
}
