import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { BridgeError } from "@/lib/growdesk/bridge-protocol";
import { acknowledgeGrowDeskVoiceLog, getGrowDeskVoiceLog } from "@/lib/growdesk/voice-log-api";
import { growdeskFetch } from "@/lib/growdesk/client";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ success: false, error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { id } = await props.params;
      const log = await getGrowDeskVoiceLog(growdeskFetch, bffSession.accessToken, id);
      if (log.id !== id || log.userId !== bffSession.user.id) {
        throw new BridgeError(502, "UPSTREAM_SCOPE_MISMATCH", "服务端返回了其他用户的语音记录");
      }
      return NextResponse.json({ success: true, log }, { headers: { "cache-control": "no-store" } });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await props.params;
    const log = await prisma.agentVoiceLog.findFirst({
      where: { id, userId: auth.user.id },
      include: {
        baby: { select: { id: true, nickname: true, gender: true } },
      },
    });

    if (!log) {
      return NextResponse.json(
        { success: false, error: "未找到该语音交互记录" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, log });
  } catch (error: any) {
    if (GROWDESK_CONFIG.enabled && error instanceof BridgeError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    console.error("GET /api/agent/voice/logs/[id] error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "获取记录失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrf = verifyBffCsrf(request, { enforceInTest: true });
      if (csrf) return csrf;
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ success: false, error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { id } = await props.params;
      const body: unknown = await request.json().catch(() => null);
      const value = body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).acknowledged : undefined;
      if (value !== true && value !== false && value !== "true" && value !== "false") {
        throw new BridgeError(400, "INVALID_ACKNOWLEDGEMENT", "acknowledged 必须为布尔值");
      }
      await acknowledgeGrowDeskVoiceLog(growdeskFetch, bffSession.accessToken, id, value === true || value === "true");
      return NextResponse.json({ success: true }, { headers: { "cache-control": "no-store" } });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await props.params;
    const body = await request.json().catch(() => ({}));
    const acknowledged = body.acknowledged === true || body.acknowledged === "true";

    const updated = await prisma.agentVoiceLog.updateMany({
      where: { id, userId: auth.user.id },
      data: { acknowledged },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { success: false, error: "记录不存在或无权修改" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (GROWDESK_CONFIG.enabled && error instanceof BridgeError) {
      return NextResponse.json({ success: false, error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    console.error("PATCH /api/agent/voice/logs/[id] error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "更新状态失败" },
      { status: 500 }
    );
  }
}
