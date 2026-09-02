import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth";
import { getActiveBaby } from "@/lib/api-helpers";
import {
  buildAgentSystemPrompt,
  createBabyPanelTools,
  createLlmBackend,
  runBabyAgent,
} from "@/lib/agent";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strips JSON action code blocks, raw markdown formatting, and citations
 * to produce clean, natural spoken Chinese suitable for HomePod / Siri TTS.
 */
function cleanReplyForSpeech(raw: string): string {
  return raw
    .replace(/```(?:json:action|action)[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[#\-\*\s]+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Resolves the authenticated user and baby for the Voice MVP.
 * Prioritizes standard PWA session (Cookie / Bearer JWT).
 * In development / explicit config, falls back to VOICE_MVP_SECRET Bearer header.
 */
async function resolveVoiceMvpPrincipal(request: Request) {
  // 1. Try standard PWA Auth Session (Cookie or standard Bearer JWT)
  const user = await getAuthSession(request);
  if (user) {
    const babyResult = await getActiveBaby(user.id);
    if (babyResult.baby) {
      return { user, baby: babyResult.baby };
    }
  }

  // 2. Try development-only VOICE_MVP_SECRET
  const authHeader = request.headers.get("authorization");
  const mvpSecret = process.env.VOICE_MVP_SECRET;

  if (mvpSecret && authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (token === mvpSecret) {
      // Optional explicit userId/babyId from env
      const envUserId = process.env.VOICE_MVP_USER_ID;
      const envBabyId = process.env.VOICE_MVP_BABY_ID;

      if (envUserId && envBabyId) {
        const mvpUser = await prisma.user.findUnique({
          where: { id: envUserId },
          select: { id: true, username: true, displayName: true },
        });
        const mvpBaby = await prisma.baby.findUnique({
          where: { id: envBabyId },
        });
        if (mvpUser && mvpBaby) {
          return { user: mvpUser, baby: mvpBaby };
        }
      }

      // Default: Find the first user with an active baby
      const firstUser = await prisma.user.findFirst({
        include: {
          memberships: {
            include: {
              family: {
                include: {
                  babies: {
                    orderBy: { createdAt: "asc" },
                  },
                },
              },
            },
          },
        },
      });

      if (firstUser) {
        const baby = firstUser.memberships
          .flatMap((m) => m.family.babies)[0];
        if (baby) {
          return {
            user: {
              id: firstUser.id,
              username: firstUser.username,
              displayName: firstUser.displayName,
            },
            baby,
          };
        }
      }
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const principal = await resolveVoiceMvpPrincipal(request);
    if (!principal) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: 请先登录或提供有效的语音访问凭证" },
        { status: 401 }
      );
    }

    const { user, baby } = principal;

    // Rate limiting
    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`voice:${user.id || ip}`, 30, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { success: false, error: `请求过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    if (!createLlmBackend().getApiKey()) {
      return NextResponse.json(
        { success: false, error: "未配置 AI 服务 API Key，无法使用语音助手" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    let rawText = "";
    if (typeof body === "string") {
      rawText = body.trim();
    } else if (body && typeof body === "object") {
      rawText = (
        typeof body.text === "string"
          ? body.text
          : typeof body.message === "string"
            ? body.message
            : typeof body.prompt === "string"
              ? body.prompt
              : typeof body.query === "string"
                ? body.query
                : typeof body.content === "string"
                  ? body.content
                  : ""
      ).trim();
    }

    if (!rawText) {
      console.warn(`[Voice API] Received empty request body from ${ip}:`, JSON.stringify(body));
      return NextResponse.json(
        { success: false, error: "text is required" },
        { status: 400 }
      );
    }

    if (rawText.length > 4000) {
      return NextResponse.json(
        { success: false, error: "消息过长，上限为 4000 字符" },
        { status: 400 }
      );
    }

    const startTime = Date.now();
    console.log(
      `[Voice API] Incoming request from ${ip} (user: ${user.username}, baby: ${baby.nickname}): "${rawText}"`
    );

    // Timeout configuration:
    // - Default: 0 (disabled / synchronous blocking until completion)
    // - Can be configured globally via process.env.VOICE_TIMEOUT_MS (e.g. 8000)
    // - Can be overridden per-request via body.timeoutMs
    const envTimeout = parseInt(process.env.VOICE_TIMEOUT_MS || "0", 10);
    const reqTimeout = typeof body.timeoutMs === "number" && body.timeoutMs >= 0 ? body.timeoutMs : undefined;
    const timeoutMs = reqTimeout !== undefined ? reqTimeout : (Number.isNaN(envTimeout) ? 0 : envTimeout);

    const timeoutReply =
      (typeof body.timeoutReply === "string" && body.timeoutReply.trim()) ||
      process.env.VOICE_TIMEOUT_REPLY ||
      "已收到，正在为您处理中，完成后将通过通知发送给您。";

    const shouldPushOnTimeout =
      body.asyncPush !== undefined
        ? Boolean(body.asyncPush)
        : process.env.VOICE_ASYNC_PUSH !== "false";

    // 1. Build context & system prompt
    const systemPrompt = buildAgentSystemPrompt({
      contextType: "general",
      baby,
    });

    // 2. Build server-verified tools
    const tools = createBabyPanelTools({
      userId: user.id,
      baby,
    });

    // 3. Execute agent loop (Sync mode vs Configurable Timeout-Race mode)
    if (timeoutMs <= 0) {
      let assistantFull = "";
      await runBabyAgent({
        systemPrompt,
        history: [],
        prompt: rawText,
        tools,
        abortSignal: request.signal,
        onEvent: (event) => {
          if (event.type === "text") {
            assistantFull += event.text;
          }
        },
      });

      const reply = cleanReplyForSpeech(assistantFull) || "未能获取有效回复，请稍后重试。";
      const duration = Date.now() - startTime;
      console.log(`[Voice API] Completed sync in ${duration}ms -> Reply: "${reply.slice(0, 100)}..."`);

      return NextResponse.json({
        success: true,
        async: false,
        reply,
      });
    }

    // Configurable Timeout Race mode
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<{ isTimeout: true }>((resolve) => {
      timer = setTimeout(() => resolve({ isTimeout: true }), timeoutMs);
    });

    const agentPromise = (async () => {
      let assistantFull = "";
      await runBabyAgent({
        systemPrompt,
        history: [],
        prompt: rawText,
        tools,
        onEvent: (event) => {
          if (event.type === "text") {
            assistantFull += event.text;
          }
        },
      });
      if (timer) clearTimeout(timer);
      return { isTimeout: false as const, assistantFull };
    })();

    const raceResult = await Promise.race([agentPromise, timeoutPromise]);

    if (raceResult.isTimeout) {
      console.log(
        `[Voice API] Request exceeded ${timeoutMs}ms threshold, switching to async background execution`
      );

      // Guard background execution to finish and send push notification
      void agentPromise
        .then(async ({ assistantFull }) => {
          const finalReply = cleanReplyForSpeech(assistantFull) || "已处理完毕。";
          const totalDuration = Date.now() - startTime;
          console.log(
            `[Voice API Async] Background agent completed in ${totalDuration}ms -> "${finalReply.slice(0, 80)}..."`
          );

          if (shouldPushOnTimeout && baby.familyId) {
            try {
              const { notifyFamilyMembers } = await import("@/lib/push-helper");
              await notifyFamilyMembers({
                familyId: baby.familyId,
                title: `🍼 ${baby.nickname}的育儿助手`,
                body: finalReply,
                url: "/daily-summary",
              });
            } catch (pushErr) {
              console.warn("[Voice API Async] Push notification failed:", pushErr);
            }
          }
        })
        .catch((err) => {
          console.error("[Voice API Async] Background agent execution error:", err);
        });

      return NextResponse.json({
        success: true,
        async: true,
        reply: timeoutReply,
      });
    }

    const reply = cleanReplyForSpeech(raceResult.assistantFull) || "未能获取有效回复，请稍后重试。";
    const duration = Date.now() - startTime;
    console.log(
      `[Voice API] Completed within ${timeoutMs}ms (${duration}ms) -> Reply: "${reply.slice(0, 100)}..."`
    );

    return NextResponse.json({
      success: true,
      async: false,
      reply,
    });
  } catch (error: any) {
    console.error("POST /api/agent/voice error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "服务器内部错误，请稍后重试" },
      { status: 500 }
    );
  }
}
