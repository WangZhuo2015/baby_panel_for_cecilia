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
import { tryVoiceFastPath } from "@/lib/agent/voice-fast-path";
import { verifyPersonalAccessToken } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Strips JSON action code blocks, raw markdown formatting, and citations
 * to produce clean, natural spoken Chinese suitable for HomePod / Siri TTS.
 */
export function cleanReplyForSpeech(raw: string): string {
  return raw
    .replace(/```(?:json:action|action)[\s\S]*?```/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[#\-\*\s]+/gm, "")
    // Remove emojis so Siri TTS doesn't awkwardly read out "奶瓶", "闪光" etc.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[|><]/g, " ")
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

  // 2. Try database-backed Personal Access Token (PAT)
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();

    if (token.startsWith("bp_pat_")) {
      const verified = await verifyPersonalAccessToken(token);
      if (verified) {
        const babyResult = await getActiveBaby(verified.user.id);
        if (babyResult.baby) {
          return { user: verified.user, baby: babyResult.baby };
        }
      }
    }

    // 3. Backward-compatible legacy VOICE_MVP_SECRET fallback
    const mvpSecret = process.env.VOICE_MVP_SECRET;
    if (mvpSecret && token === mvpSecret) {
      const envUserId = process.env.VOICE_MVP_USER_ID;
      const envBabyId = process.env.VOICE_MVP_BABY_ID;

      // Strict requirement: Never fallback to findFirst across arbitrary users/families
      if (!envUserId || !envBabyId) {
        console.error(
          "[Voice API Auth] VOICE_MVP_SECRET provided, but VOICE_MVP_USER_ID or VOICE_MVP_BABY_ID is not configured in .env!"
        );
        return null;
      }

      const mvpUser = await prisma.user.findUnique({
        where: { id: envUserId },
        select: {
          id: true,
          username: true,
          displayName: true,
          memberships: { select: { familyId: true } },
        },
      });

      const mvpBaby = await prisma.baby.findUnique({
        where: { id: envBabyId },
      });

      if (mvpUser && mvpBaby) {
        // Multi-tenant check: ensure baby belongs to user's family
        const userFamilyIds = new Set(mvpUser.memberships.map((m) => m.familyId));
        if (userFamilyIds.has(mvpBaby.familyId)) {
          return { user: mvpUser, baby: mvpBaby };
        }
        console.error(
          `[Voice API Auth] Multi-tenant boundary violation: Baby ${envBabyId} does not belong to User ${envUserId}`
        );
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

    // ── Fast-Path Query Engine for Ultra-Low Latency Voice (<100ms) ──
    const fastReply = await tryVoiceFastPath({
      text: rawText,
      baby,
      userId: user.id,
    });

    if (fastReply) {
      const reply = cleanReplyForSpeech(fastReply);
      const duration = Date.now() - startTime;
      console.log(
        `[Voice API Fast-Path] Completed in ${duration}ms -> Reply: "${reply.slice(0, 100)}..."`
      );

      void prisma.agentVoiceLog
        .create({
          data: {
            userId: user.id,
            babyId: baby.id,
            prompt: rawText,
            reply,
            isAsync: false,
            isFastPath: true,
            acknowledged: true,
          },
        })
        .catch((e) => console.warn("[Voice API] Failed to log fast-path:", e));

      return NextResponse.json({
        success: true,
        async: false,
        fastPath: true,
        reply,
      });
    }

    // Timeout configuration:
    // - Default: 13500ms (13.5s, allowing a safety buffer before iOS Shortcuts 15s client timeout)
    // - Can be configured globally via process.env.VOICE_TIMEOUT_MS (e.g. 15000)
    // - Can be overridden per-request via body.timeoutMs
    const envTimeout = parseInt(process.env.VOICE_TIMEOUT_MS || "13500", 10);
    const reqTimeout = typeof body.timeoutMs === "number" && body.timeoutMs >= 0 ? body.timeoutMs : undefined;
    const timeoutMs = reqTimeout !== undefined ? reqTimeout : (Number.isNaN(envTimeout) ? 13500 : envTimeout);

    const timeoutReply =
      (typeof body.timeoutReply === "string" && body.timeoutReply.trim()) ||
      process.env.VOICE_TIMEOUT_REPLY ||
      "已收到，正在为您处理中，完成后将通过通知发送给您。";

    const shouldPushOnTimeout =
      body.asyncPush !== undefined
        ? Boolean(body.asyncPush)
        : process.env.VOICE_ASYNC_PUSH !== "false";

    if (!createLlmBackend().getApiKey()) {
      return NextResponse.json(
        { success: false, error: "未配置 AI 服务 API Key，无法使用语音助手" },
        { status: 503 }
      );
    }

    // 1. Build context & system prompt
    const systemPrompt = buildAgentSystemPrompt({
      contextType: "voice",
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

          // 1. Create AgentVoiceLog with acknowledged: false (unseen by user)
          let createdLogId: string | null = null;
          try {
            const logRecord = await prisma.agentVoiceLog.create({
              data: {
                userId: user.id,
                babyId: baby.id,
                prompt: rawText,
                reply: finalReply,
                isAsync: true,
                isFastPath: false,
                acknowledged: false,
              },
            });
            createdLogId = logRecord.id;
          } catch (logErr) {
            console.warn("[Voice API Async] Failed to create voice log:", logErr);
          }

          // 2. Dispatch push notification with direct deep link to the result
          if (shouldPushOnTimeout && baby.familyId) {
            try {
              const { notifyFamilyMembers } = await import("@/lib/push-helper");
              const targetUrl = createdLogId
                ? `/?agentVoiceLogId=${createdLogId}`
                : "/daily-summary";

              await notifyFamilyMembers({
                familyId: baby.familyId,
                title: `🍼 ${baby.nickname}的育儿助手`,
                body: finalReply,
                url: targetUrl,
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

    const reply = cleanReplyForSpeech(raceResult.assistantFull) || "好的，已为您处理完成。";
    const duration = Date.now() - startTime;
    console.log(
      `[Voice API] Completed within ${timeoutMs}ms (${duration}ms) -> Reply: "${reply.slice(0, 100)}..."`
    );

    void prisma.agentVoiceLog
      .create({
        data: {
          userId: user.id,
          babyId: baby.id,
          prompt: rawText,
          reply,
          isAsync: false,
          isFastPath: false,
          acknowledged: true,
        },
      })
      .catch((e) => console.warn("[Voice API] Failed to log sync agent:", e));

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
