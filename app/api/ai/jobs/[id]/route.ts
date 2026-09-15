import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiJobStore } from "@/lib/growdesk/ai-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getOwnJob(userId: string, id: string) {
  const job = await prisma.aiJob.findUnique({ where: { id } });
  if (!job || job.userId !== userId) return null;
  return job;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const job = bffAiJobStore.getJob(id, bffSession.user.id);
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    const status =
      job.status === "succeeded" ? "done" : job.status === "running" ? "processing" : job.status;
    let result: any = null;
    if (job.status === "succeeded" && job.resultJson) {
      try {
        result = JSON.parse(job.resultJson);
      } catch {
        result = null;
      }
    }

    return NextResponse.json({
      id: job.id,
      status,
      result,
      errorMessage: job.errorMessage,
      imageUrl: job.imageUrl,
      claimed: job.claimed,
    });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

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
  const { id } = await context.params;

  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const claimed = bffAiJobStore.claimJob(id, bffSession.user.id);
    if (!claimed) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  const job = await getOwnJob(auth.user.id, id);
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  await prisma.aiJob.update({ where: { id }, data: { claimed: true } });
  return NextResponse.json({ success: true });
}
