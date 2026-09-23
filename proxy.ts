import { NextRequest, NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { isBridgedMethod } from "@/lib/growdesk/bridge-policy";

/** Routing fence only. Session and BabyMember authorization remain in the handlers/API. */
export function proxy(request: NextRequest) {
  if (
    !GROWDESK_CONFIG.enabled ||
    isBridgedMethod(request.nextUrl.pathname, request.method, GROWDESK_CONFIG.backend)
  ) {
    return NextResponse.next();
  }
  // A legacy route's 401 would incorrectly log a valid BFF user out. Never call it.
  const goBackend = GROWDESK_CONFIG.usesGoBackend;
  return NextResponse.json({
    error: goBackend
      ? "此功能尚未由 Go 服务端接管，已阻止回退到 Web 本地状态。"
      : "此功能尚未接入 GrowDesk，未访问旧数据库。请勿切换生产写入。",
    code: goBackend ? "GROWDESK_GO_ROUTE_NOT_READY" : "GROWDESK_ROUTE_NOT_MIGRATED",
  }, { status: 501, headers: { "cache-control": "no-store" } });
}
export const config = {
  matcher: ["/api/:path*", "/mcp/:path*", "/oauth/:path*", "/.well-known/:path*"],
};
