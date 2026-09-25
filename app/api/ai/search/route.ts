import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { performWebSearch } from "@/lib/agent/search";

import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  let userId: string;
  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    userId = bffSession.user.id;
  } else {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    userId = auth.user.id;
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") || url.searchParams.get("query") || "";
  const limit = parseInt(url.searchParams.get("limit") || "5", 10);

  if (!q.trim()) {
    return NextResponse.json({ error: "缺少搜索关键词 q" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`web_search:${userId || getClientIp(request)}`, 30, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: `搜索过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
      { status: 429 }
    );
  }

  try {
    const results = await performWebSearch(q, limit);
    return NextResponse.json({ query: q, total: results.length, results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "搜索失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let userId: string;
  if (GROWDESK_CONFIG.enabled) {
    const csrfErr = verifyBffCsrf(request);
    if (csrfErr) return csrfErr;
    const bffSession = await resolveBffSession(request);
    if (!bffSession) return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    userId = bffSession.user.id;
  } else {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    userId = auth.user.id;
  }

  const body = await request.json().catch(() => ({}));
  const q = typeof body.query === "string" ? body.query : typeof body.q === "string" ? body.q : "";
  const limit = typeof body.limit === "number" ? body.limit : 5;

  if (!q.trim()) {
    return NextResponse.json({ error: "缺少搜索关键词 query" }, { status: 400 });
  }

  const rateLimit = checkRateLimit(`web_search:${userId || getClientIp(request)}`, 30, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: `搜索过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
      { status: 429 }
    );
  }

  try {
    const results = await performWebSearch(q, limit);
    return NextResponse.json({ query: q, total: results.length, results });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "搜索失败" }, { status: 500 });
  }
}

