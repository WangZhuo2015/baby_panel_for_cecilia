import { readJsonObject } from "@/lib/growdesk/record-route-helpers";
import { growdeskRouteBoundary } from "@/lib/growdesk/route-boundary";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiJobStore } from "@/lib/growdesk/ai-jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 当前用户的 AI 任务列表（待领取优先，最近 10 条） */
export async function GET(request: Request) {
  return growdeskRouteBoundary(request, async () => {
  if (GROWDESK_CONFIG.enabled) {
    const bffSession = await resolveBffSession(request);
    if (!bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const { pendingClaim, jobs } = await bffAiJobStore.listJobs(bffSession.user.id, {
      type: "medical_ocr",
      babyId: new URL(request.url).searchParams.get("babyId") || undefined,
      accessToken: bffSession.accessToken,
      limit: 10,
    });

    const formatted = jobs.map((j) => ({
      id: j.id, babyId: j.babyId, type: j.type, taskStatus: j.status,
      status: j.status === "succeeded" ? "done" : ["pending", "running"].includes(j.status) ? "processing" : j.status,
      imageUrl: j.imageUrl,
      errorMessage: j.errorMessage,
      claimed: j.claimed,
      createdAt: j.createdAt,
    }));

    return NextResponse.json({
      pendingClaim,
      jobs: formatted,
    });
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  const jobs = await prisma.aiJob.findMany({
    where: { userId: auth.user.id, type: "medical_ocr" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 超时兜底更新
  const now = Date.now();
  for (const j of jobs) {
    if (j.status === "processing" && now - new Date(j.createdAt).getTime() > 180_000) {
      j.status = "failed";
      j.errorMessage = "AI 识别任务响应超时，请重新拍摄更清晰的照片并上传";
      prisma.aiJob
        .update({
          where: { id: j.id },
          data: { status: "failed", errorMessage: j.errorMessage, finishedAt: new Date() },
        })
        .catch(() => {});
    }
  }

  // 待领取 = done && !claimed；processing 也返回供前端恢复轮询
  return NextResponse.json({
    pendingClaim: jobs.filter((j) => j.status === "done" && !j.claimed).length,
    jobs: jobs.map((j) => ({
      id: j.id, babyId: j.babyId, type: j.type, taskStatus: j.status,
      status: j.status,
      imageUrl: j.imageUrl,
      errorMessage: j.errorMessage,
      claimed: j.claimed,
      createdAt: j.createdAt,
    })),
  });
  });
}

/** Explicit submission only; this endpoint never evaluates client-supplied identity. */
export async function POST(request: Request) {
  return growdeskRouteBoundary(request, async () => {
    if (!GROWDESK_CONFIG.enabled) return NextResponse.json({ error: "该接口需要 GrowDesk" }, { status: 501 });
    const session = await resolveBffSession(request);
    if (!session) return NextResponse.json({ error: "会话已过期" }, { status: 401 });
    const body = await readJsonObject(request);
    const result = await bffAiJobStore.createJob({
      userId: session.user.id, babyId: String(body.babyId || ""), type: String(body.type || ""),
      clientRequestId: String(body.clientRequestId || ""),
      attachmentId: typeof body.attachmentId === "string" ? body.attachmentId : undefined,
      targetDate: typeof body.targetDate === "string" ? body.targetDate : undefined,
      accessToken: session.accessToken,
    });
    return NextResponse.json({ jobId: result.id, babyId: result.babyId, status: "processing" }, { status: 202 });
  });
}
