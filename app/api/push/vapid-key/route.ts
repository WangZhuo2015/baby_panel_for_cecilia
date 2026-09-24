import { NextResponse } from "next/server";
import { GROWDESK_CONFIG, PUSH_CONFIG } from "@/lib/config";
import { requireAuth } from "@/lib/api-helpers";
import { resolveBffSession } from "@/lib/growdesk/session";
import { BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";

export async function GET(request: Request) {
  if (GROWDESK_CONFIG.enabled) {
    try {
      if (!await resolveBffSession(request)) throw new BridgeError(401, "UNAUTHORIZED", "请先登录");
      const publicKey = PUSH_CONFIG.publicKey;
      if (!publicKey) throw new BridgeError(503, "PUSH_NOT_CONFIGURED", "推送服务尚未配置");
      return NextResponse.json({ publicKey }, { headers: { "cache-control": "no-store" } });
    } catch (error) { return bridgeErrorResponse(error); }
  }
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const publicKey = PUSH_CONFIG.publicKey;
  if (!publicKey) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 });
  return NextResponse.json({ publicKey });
}
