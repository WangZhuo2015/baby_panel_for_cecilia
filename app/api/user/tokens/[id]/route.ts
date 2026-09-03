import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { revokePersonalAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;

    const { id } = await props.params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: "令牌 ID 不能为空" },
        { status: 400 }
      );
    }

    const ok = await revokePersonalAccessToken(auth.user.id, id);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "令牌不存在或无权删除" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/user/tokens/[id] error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "撤销令牌失败" },
      { status: 500 }
    );
  }
}
