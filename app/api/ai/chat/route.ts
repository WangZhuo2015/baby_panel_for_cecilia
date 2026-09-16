import {durableChatRequest} from "@/lib/growdesk/durable-chat";
import { NextResponse } from "next/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { archiveText } from "@/lib/archive";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";
import {
  buildAgentSystemPrompt,
  createLlmBackend,
  activeChatRunManager,
  type ChatStreamSubscriber,
} from "@/lib/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function toHistory(messages: { role?: string; content?: unknown }[]): AgentMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const text = typeof m.content === "string" ? m.content : "";
      if (m.role === "assistant") {
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text }],
          api: "openai-completions" as const,
          provider: "openrouter",
          model: "openrouter",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop" as const,
          timestamp: Date.now(),
        };
      }
      return {
        role: "user" as const,
        content: text,
        timestamp: Date.now(),
      };
    });
}

export async function GET(request: Request) {
  if(GROWDESK_CONFIG.enabled)return durableChatRequest(request);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    let session: any = null;
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      session = await bffAiSessionStore.getSession(sessionId, user.id, bffSession.accessToken);
    } else {
      session = await prisma.aiChatSession.findFirst({
        where: { id: sessionId, userId: user.id },
      });
    }
    if (!session) {
      return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
    }

    const activeRun = activeChatRunManager.get(sessionId);
    const isOwnerRun = Boolean(activeRun && activeRun.userId === user.id);
    const acceptHeader = request.headers.get("accept") || "";
    const wantsStream =
      acceptHeader.includes("text/event-stream") || url.searchParams.get("stream") === "true";

    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          let isClosed = false;
          const subscriber: ChatStreamSubscriber = (event) => {
            if (isClosed) return;
            try {
              if (event.type === "session") {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ session: event.session })}\n\n`)
                );
              } else if (event.type === "text") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ text: event.text, replay: event.replay })}\n\n`
                  )
                );
              } else if (event.type === "tool") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ tool: event.tool, replay: event.replay })}\n\n`
                  )
                );
              } else if (event.type === "done") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                isClosed = true;
                try {
                  controller.close();
                } catch {}
              } else if (event.type === "error") {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ error: event.error })}\n\n`)
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                isClosed = true;
                try {
                  controller.close();
                } catch {}
              }
            } catch {
              isClosed = true;
            }
          };

          if (isOwnerRun && activeRun!.status === "running") {
            request.signal.addEventListener(
              "abort",
              () => {
                isClosed = true;
                activeChatRunManager.detachSubscriber(sessionId, subscriber);
                try {
                  controller.close();
                } catch {}
              },
              { once: true }
            );
            activeChatRunManager.attachSubscriber(sessionId, subscriber, true);
          } else {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            try {
              controller.close();
            } catch {}
          }
        },
      });
      return new Response(stream, { headers: sseHeaders() });
    }

    return NextResponse.json({
      active: Boolean(isOwnerRun && activeRun!.status === "running"),
      status: isOwnerRun ? activeRun!.status : "idle",
      text: isOwnerRun ? activeRun!.fullText : "",
      tools: isOwnerRun ? activeRun!.toolTraces : [],
    });
  } catch (err) {
    console.error("GET /api/ai/chat exception:", err);
    return NextResponse.json({ error: "获取会话状态失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if(GROWDESK_CONFIG.enabled)return durableChatRequest(request);
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`chat:${user.id || ip}`, 20, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `提问过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    if (!createLlmBackend().getApiKey()) {
      return NextResponse.json(
        { error: "未配置 LLM API Key，无法使用 AI 助手" },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { messages, contextDetail, babyId, sessionId } = body;
    const contextType =
      typeof body.contextType === "string" && body.contextType.trim()
        ? body.contextType.trim()
        : "general";

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    }
    if (messages.length > 50) {
      return NextResponse.json({ error: "消息历史记录过多，请开启新会话" }, { status: 400 });
    }

    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content === "string") {
        if (m.content.length > 8000) {
          return NextResponse.json({ error: "单条消息长度不能超过 8000 字符" }, { status: 400 });
        }
        totalChars += m.content.length;
      }
    }
    if (totalChars > 30000) {
      return NextResponse.json({ error: "消息总长度超出限制" }, { status: 400 });
    }

    const babyResult = await requireBaby(user.id, babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const targetBaby = babyResult.baby;

    const rawImages: unknown = body.images ?? body.image;
    const imageList: string[] = Array.isArray(rawImages)
      ? rawImages.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      : typeof rawImages === "string" && rawImages.trim()
        ? [rawImages.trim()]
        : [];

    const lastUser = [...messages].reverse().find((m: { role?: string }) => m.role === "user");
    const promptText =
      (typeof lastUser?.content === "string" && lastUser.content.trim()) ||
      (imageList.length > 0
        ? imageList.length > 1
          ? `请帮我同时对比和解读这 ${imageList.length} 张图片/单据`
          : "请帮我识别并解读这张图片/单据"
        : "");
    if (!promptText && imageList.length === 0) {
      return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    }

    if (promptText) {
      void archiveText("input_text", promptText).catch(() => {});
    }

    let bffSession: any = null;
    if (GROWDESK_CONFIG.enabled) {
      bffSession = await resolveBffSession(request);
      if (!bffSession) return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    // 1. Session Persistence Setup
    let activeSession: { id: string; title: string; contextType: string; babyId?: string | null } | null = null;
    if (sessionId && typeof sessionId === "string") {
      const existing = bffSession
        ? await bffAiSessionStore.getSession(sessionId, user.id, bffSession.accessToken)
        : await prisma.aiChatSession.findFirst({
            where: { id: sessionId, userId: user.id },
          });
      if (!existing) {
        return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
      }
      if (existing.babyId !== targetBaby.id || existing.contextType !== contextType) {
        return NextResponse.json(
          { error: "会话所属宝宝或领域与当前请求不匹配，请切换会话后重试" },
          { status: 409 }
        );
      }
      activeSession = existing;
    }
    if (!activeSession) {
      const generatedTitle = promptText.replace(/[\r\n\t]+/g, " ").trim().slice(0, 24) || "新对话";
      activeSession = bffSession
        ? await bffAiSessionStore.createSession(
            {
              userId: user.id,
              babyId: targetBaby.id,
              title: generatedTitle,
              contextType,
            },
            bffSession.accessToken
          )
        : await prisma.aiChatSession.create({
            data: {
              userId: user.id,
              babyId: targetBaby.id,
              title: generatedTitle,
              contextType,
            },
          });
    }

    if (!activeSession) {
      return NextResponse.json({ error: "无法创建或找到会话" }, { status: 500 });
    }

    const currentSession = activeSession;
    const sid = currentSession.id;
    const imagePersistStr =
      imageList.length === 1
        ? imageList[0]
        : imageList.length > 1
          ? JSON.stringify(imageList)
          : null;

    // Check if an active agent is already running for this session
    const existingRun = activeChatRunManager.get(sid);
    if (existingRun && existingRun.status === "running") {
      return NextResponse.json(
        {
          error: "当前会话正在思考生成中，请等待完成或点击停止生成后再发送新问题",
          active: true,
          sessionId: sid,
        },
        { status: 409 }
      );
    }

    // 2. Prompt-First Persistence: Save user prompt to DB BEFORE agent starts
    if (bffSession) {
      await bffAiSessionStore.addMessage(
        sid,
        user.id,
        {
          role: "user",
          content: promptText,
          image: imagePersistStr ?? undefined,
        },
        bffSession.accessToken
      );
    } else {
      await prisma.aiChatMessage.create({
        data: {
          sessionId: sid,
          role: "user",
          content: promptText,
          image: imagePersistStr,
        },
      });
    }

    const systemPrompt = buildAgentSystemPrompt({
      contextType,
      contextDetail,
      baby: targetBaby,
    });

    const prior = messages.filter(
      (m: { role?: string }, idx: number) =>
        idx < messages.length - 1 && (m.role === "user" || m.role === "assistant")
    );

    // 3. Start background runner decoupled from client request.signal
    activeChatRunManager.startRun({
      sessionId: sid,
      userId: user.id,
      baby: targetBaby,
      promptText,
      imageList,
      systemPrompt,
      history: toHistory(prior.slice(-8)),
      sessionMeta: {
        id: currentSession.id,
        title: currentSession.title,
        contextType: currentSession.contextType,
      },
      accessToken: bffSession?.accessToken,
      familyId: targetBaby.familyId || undefined,
    });

    // 4. Stream response to this client, detaching cleanly on client disconnect without aborting the background run
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let isClosed = false;
        const subscriber: ChatStreamSubscriber = (event) => {
          if (isClosed) return;
          try {
            if (event.type === "session") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ session: event.session })}\n\n`)
              );
            } else if (event.type === "text") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ text: event.text, replay: event.replay })}\n\n`
                )
              );
            } else if (event.type === "tool") {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ tool: event.tool, replay: event.replay })}\n\n`
                )
              );
            } else if (event.type === "done") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              isClosed = true;
              try {
                controller.close();
              } catch {}
            } else if (event.type === "error") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: event.error })}\n\n`)
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              isClosed = true;
              try {
                controller.close();
              } catch {}
            }
          } catch {
            isClosed = true;
          }
        };

        request.signal.addEventListener(
          "abort",
          () => {
            isClosed = true;
            activeChatRunManager.detachSubscriber(sid, subscriber);
            try {
              controller.close();
            } catch {}
          },
          { once: true }
        );

        activeChatRunManager.attachSubscriber(sid, subscriber, true);
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (error) {
    console.error("POST /api/ai/chat exception:", error);
    const errText =
      "网络连接暂时超时，请稍后重新提问。若宝宝身体有明显不适，请以专业医生诊断为准。";
    return new Response(`data: ${JSON.stringify({ text: errText })}\n\ndata: [DONE]\n\n`, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }
}
