import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";

async function getOwnJob(userId: string, id: string) {
  const job = await prisma.aiJob.findUnique({ where: { id } });
  if (!job || job.userId !== userId) return null;
  return job;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { id } = await context.params;

  let job = await getOwnJob(auth.user.id, id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  // 超时兜底：若 processing 超过 3 分钟，自动标记为 failed，防止前端死循环轮询
  if (job.status === "processing" && Date.now() - new Date(job.createdAt).getTime() > 180_000) {
    job = await prisma.aiJob.update({
      where: { id },
      data: {
        status: "failed",
        errorMessage: "AI 识别任务响应超时，请重新拍摄更清晰的照片并上传",
        finishedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    id: job.id,
    status: job.status,
    result: job.status === "done" && job.resultJson ? JSON.parse(job.resultJson) : null,
    errorMessage: job.errorMessage,
    imageUrl: job.imageUrl,
    claimed: job.claimed,
  });
}

/** 领取（确认入库后标记），防止重复提醒 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { id } = await context.params;

  const job = await getOwnJob(auth.user.id, id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  await prisma.aiJob.update({ where: { id }, data: { claimed: true } });
  return NextResponse.json({ success: true });
}
