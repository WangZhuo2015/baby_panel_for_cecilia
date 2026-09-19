import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { activeChatRunManager } from "@/lib/agent";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let user: { id: string };
    if (GROWDESK_CONFIG.enabled) {
      // CSRF first: a state-changing call must prove its origin before any session exchange.
      const csrfError = verifyBffCsrf(request);
      if (csrfError) return csrfError;
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      user = bffSession.user;
    } else {
      const auth = await requireAuth(request);
      if (auth.errorResponse) return auth.errorResponse;
      user = auth.user;
    }

    const body = await request.json().catch(() => ({}));
    const { sessionId } = body;

    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const cancelled = await activeChatRunManager.cancelRun(sessionId, user.id);
    return NextResponse.json({ success: true, cancelled });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}
