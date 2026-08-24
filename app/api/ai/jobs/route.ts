import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";

/** 当前用户的 AI 任务列表（待领取优先，最近 10 条） */
export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  const jobs = await prisma.aiJob.findMany({
    where: { userId: auth.user.id, type: "medical_ocr" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 待领取 = done && !claimed；processing 也返回供前端恢复轮询
  return NextResponse.json({
    pendingClaim: jobs.filter((j) => j.status === "done" && !j.claimed).length,
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      imageUrl: j.imageUrl,
      errorMessage: j.errorMessage,
      claimed: j.claimed,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
    })),
  });
}
