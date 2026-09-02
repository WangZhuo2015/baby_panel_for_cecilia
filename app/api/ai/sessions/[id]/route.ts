import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const { id } = await params;
  const url = new URL(request.url);
  const requestedBabyId = url.searchParams.get("babyId");
  const requestedContextType = url.searchParams.get("contextType")?.trim() || null;
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
      { status: 409 },
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

  return NextResponse.json({ session: formatted });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 50) : undefined;

  if (!title) {
    return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  }

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
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const { id } = await params;
  const session = await prisma.aiChatSession.findFirst({
    where: { id, userId: user.id },
  });

  if (!session) {
    return NextResponse.json({ error: "对话会话不存在" }, { status: 404 });
  }

  await prisma.aiChatSession.delete({
    where: { id },
  });

  return NextResponse.json({ success: true, id });
}

