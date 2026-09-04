import { NextResponse } from "next/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { archiveText } from "@/lib/archive";
import {
  buildAgentSystemPrompt,
  createBabyPanelTools,
  createLlmBackend,
  parseDataImage,
  resolveImageContent,
  runBabyAgent,
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
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
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

export async function POST(request: Request) {
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
    const { messages, contextDetail, babyId, image, sessionId } = body;
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

    // 1. Session Persistence Setup
    let activeSession: { id: string; title: string; contextType: string } | null = null;
    if (sessionId && typeof sessionId === "string") {
      const existing = await prisma.aiChatSession.findFirst({
        where: { id: sessionId, userId: user.id },
      });
      if (!existing) {
        return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
      }
      if (existing.babyId !== targetBaby.id || existing.contextType !== contextType) {
        return NextResponse.json(
          { error: "会话所属宝宝或领域与当前请求不匹配，请切换会话后重试" },
          { status: 409 },
        );
      }
      activeSession = existing;
    }
    if (!activeSession) {
      const generatedTitle = promptText.replace(/[\r\n\t]+/g, " ").trim().slice(0, 24) || "新对话";
      activeSession = await prisma.aiChatSession.create({
        data: {
          userId: user.id,
          babyId: targetBaby.id,
          title: generatedTitle,
          contextType,
        },
      });
    }

    const systemPrompt = buildAgentSystemPrompt({
      contextType,
      contextDetail,
      baby: targetBaby,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        // Emit session info as first SSE event
        send({ session: activeSession });

        let assistantFull = "";
        const toolTraces: any[] = [];

        try {
          const prior = messages.filter(
            (m: { role?: string }, idx: number) =>
              idx < messages.length - 1 && (m.role === "user" || m.role === "assistant")
          );
          
          // Resolve multiple images (up to 6)
          const resolvedImages = [];
          for (const imgStr of imageList.slice(0, 6)) {
            const resolved = await resolveImageContent(imgStr);
            if (resolved) resolvedImages.push(resolved);
          }

          await runBabyAgent({
            systemPrompt,
            history: toHistory(prior.slice(-8)),
            prompt: promptText,
            images: resolvedImages.length > 0 ? resolvedImages : undefined,
            tools: createBabyPanelTools({ userId: user.id, baby: targetBaby }),
            abortSignal: request.signal,
            onEvent: (event) => {
              if (event.type === "text") {
                assistantFull += event.text;
                send({ text: event.text });
              } else {
                if (event.status === "end") {
                  toolTraces.push(event);
                }
                send({ tool: event });
              }
            },
          });

          if (assistantFull) {
            void archiveText("output_json", assistantFull).catch(() => {});
          }

          // Persist user and assistant messages into DB
          try {
            if (activeSession) {
              const sid = activeSession.id;
              const imagePersistStr =
                imageList.length === 1
                  ? imageList[0]
                  : imageList.length > 1
                    ? JSON.stringify(imageList)
                    : null;

              await prisma.aiChatMessage.create({
                data: {
                  sessionId: sid,
                  role: "user",
                  content: promptText,
                  image: imagePersistStr,
                },
              });
              await prisma.aiChatMessage.create({
                data: {
                  sessionId: sid,
                  role: "assistant",
                  content: assistantFull || "未能获取有效回复，请重试。",
                  toolsJson: toolTraces.length > 0 ? JSON.stringify(toolTraces) : null,
                },
              });
              await prisma.aiChatSession.update({
                where: { id: sid },
                data: { updatedAt: new Date() },
              });
            }
          } catch (dbErr) {
            console.error("Failed to save chat message history:", dbErr);
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err: any) {
          const isAborted = request.signal.aborted || err?.name === "AbortError";
          if (!isAborted) {
            console.error("AI chat run error:", err);
            const fallback =
              assistantFull ||
              "网络连接暂时超时，请稍后重新提问。若宝宝身体有明显不适，请以专业医生诊断为准。";
            if (!assistantFull) send({ text: fallback });

            // Persist on error as well
            try {
              if (activeSession) {
                const sid = activeSession.id;
                await prisma.aiChatMessage.create({
                  data: {
                    sessionId: sid,
                    role: "user",
                    content: promptText,
                    image: typeof image === "string" ? image : null,
                  },
                });
                await prisma.aiChatMessage.create({
                  data: {
                    sessionId: sid,
                    role: "assistant",
                    content: fallback,
                    toolsJson: toolTraces.length > 0 ? JSON.stringify(toolTraces) : null,
                  },
                });
              }
            } catch {}
          } else if (assistantFull && activeSession) {
            // Save whatever partial assistant message was generated before user cancelled
            try {
              const sid = activeSession.id;
              await prisma.aiChatMessage.create({
                data: {
                  sessionId: sid,
                  role: "user",
                  content: promptText,
                  image: typeof image === "string" ? image : null,
                },
              });
              await prisma.aiChatMessage.create({
                data: {
                  sessionId: sid,
                  role: "assistant",
                  content: assistantFull,
                  toolsJson: toolTraces.length > 0 ? JSON.stringify(toolTraces) : null,
                },
              });
            } catch {}
          }

          try {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } catch {}
        } finally {
          try {
            controller.close();
          } catch {}
        }
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
