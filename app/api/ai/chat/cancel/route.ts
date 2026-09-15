import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { activeChatRunManager } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const cancelled = await activeChatRunManager.cancelRun(sessionId, user.id);
    return NextResponse.json({ success: true, cancelled });
  } catch (error) {
    console.error("POST /api/ai/chat/cancel error:", error);
    return NextResponse.json({ error: "取消 AI 任务失败" }, { status: 500 });
  }
}
