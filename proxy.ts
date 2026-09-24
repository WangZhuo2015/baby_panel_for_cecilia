import { NextRequest, NextResponse } from "next/server";
import { GROWDESK_CONFIG } from "@/lib/config";
import { isBridgedMethod } from "@/lib/growdesk/bridge-policy";

/** Routing fence only. Session and BabyMember authorization remain in the handlers/API. */
export function proxy(request: NextRequest) {
  // Rewrite before public-file routing: otherwise a surviving file under
  // public/uploads could bypass the dynamic /uploads handler entirely.
  if (GROWDESK_CONFIG.enabled && request.nextUrl.pathname.startsWith("/uploads/")) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return NextResponse.json({ error: "Method not allowed" }, {
        status: 405, headers: { allow: "GET, HEAD", "cache-control": "no-store" },
      });
    }
    const target = request.nextUrl.clone();
    target.pathname = `/api/legacy-attachments${request.nextUrl.pathname.slice("/uploads".length)}`;
    return NextResponse.rewrite(target);
  }
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
  matcher: ["/uploads/:path*", "/api/:path*", "/mcp/:path*", "/oauth/:path*", "/.well-known/:path*"],
};
