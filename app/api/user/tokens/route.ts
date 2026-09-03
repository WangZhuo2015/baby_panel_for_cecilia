import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
} from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const tokens = await listPersonalAccessTokens(auth.user.id);
    return NextResponse.json({ success: true, tokens });
  } catch (error: any) {
    console.error("GET /api/user/tokens error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "获取令牌失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "我的快捷指令";

    const created = await createPersonalAccessToken(auth.user.id, name);
    return NextResponse.json({ success: true, token: created });
  } catch (error: any) {
    console.error("POST /api/user/tokens error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "创建令牌失败" },
      { status: 500 }
    );
  }
}
