import { createHash, randomUUID } from "node:crypto";
import { createChatGPTBackend, ChatGPTPlanError, planErrorMessage } from "@/lib/chatgpt-plan";
import { NextResponse } from "next/server";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { archiveText } from "@/lib/archive";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { BridgeError } from "@/lib/growdesk/bridge-protocol";
import { getLlmProfileById, resolveLlmProfileModel } from "@/lib/llm-profiles";
import {
  buildAgentSystemPrompt,
  createLlmBackend,
  activeChatRunManager,
  type ActiveChatRun,
  type ChatStreamSubscriber,
} from "@/lib/agent";
import {
  CHAT_TURN_ID_PATTERN,
  makeChatRetryClaimToolsJson,
  makeChatTurnRequestToolsJson,
  readChatLlmModelInfo,
  readChatTurnRequest,
  readChatTurnReceipt,
  stableChatRetryClaimMessageId,
  stableChatUserMessageId,
  type ChatLlmModelInfo,
} from "@/lib/agent/chat-retry";
import {
  getCurrentLlmFeatureScope,
  getCurrentLlmModelInfo,
  withLlmFeature,
} from "@/lib/llm-context";

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

function parseToolsJson(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function streamRun(request: Request, run: ActiveChatRun): Response {
  const encoder = new TextEncoder();
  let subscriber: ChatStreamSubscriber | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      subscriber = (event) => {
        if (isClosed) return;
        try {
          if (event.type === "session") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ session: event.session })}\n\n`));
          else if (event.type === "text") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.text, replay: event.replay })}\n\n`));
          else if (event.type === "tool") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tool: event.tool, replay: event.replay })}\n\n`));
          else if (event.type === "llm") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ llm: event.llm, replay: event.replay })}\n\n`));
          else if (event.type === "error") controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: event.error, turnId: event.turnId, retryable: event.retryable, writeToolStarted: event.writeToolStarted, attempt: event.attempt })}\n\n`));
          else {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            isClosed = true;
            controller.close();
          }
        } catch {
          isClosed = true;
        }
      };
      request.signal.addEventListener("abort", () => {
        isClosed = true;
        if (subscriber) activeChatRunManager.detachRunSubscriber(run, subscriber);
        try { controller.close(); } catch {}
      }, { once: true });
      activeChatRunManager.attachRunSubscriber(run, subscriber, true);
    },
    cancel() {
      if (subscriber) activeChatRunManager.detachRunSubscriber(run, subscriber);
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function persistedRunStream(
  session: { id: string; title: string; contextType: string },
  text: string,
  llm: ChatLlmModelInfo | undefined,
  error?: string,
  receipt?: { turnId: string; attempt: number; retryable: boolean; writeToolStarted: boolean },
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      emit({ session });
      if (llm) emit({ llm, replay: true });
      if (text) emit({ text, replay: true });
      if (error) emit({ error, ...receipt });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

function requestFingerprint(input: { prompt: string; images: string[]; babyId: string; contextType: string; contextDetail?: unknown }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function samePersistedUserMessage(
  message: { content?: unknown; image?: unknown },
  promptText: string,
  imagePersistStr: string | null,
): boolean {
  return message.content === promptText && (message.image || null) === imagePersistStr;
}

async function sessionMessages(
  sessionId: string,
  userId: string,
  bffSession: { accessToken: string } | null,
  loadedSession?: any,
): Promise<any[]> {
  if (bffSession) {
    const session = loadedSession || await bffAiSessionStore.getSession(sessionId, userId, bffSession.accessToken);
    return Array.isArray(session?.messages) ? session.messages : [];
  }
  return prisma.aiChatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
}

function toolsForMessage(message: any): unknown[] {
  return parseToolsJson(message?.toolsJson ?? message?.tools);
}

function findTurnAssistant(messages: any[], turnId: string): any | undefined {
  return [...messages].reverse().find((message) =>
    message.role === "assistant" && readChatTurnReceipt(toolsForMessage(message))?.turnId === turnId,
  );
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
          provider: "unknown",
          model: "unknown",
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
  try {
    const bffSession = GROWDESK_CONFIG.enabled ? await resolveBffSession(request) : null;
    if (GROWDESK_CONFIG.enabled && !bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }
    const auth = bffSession ? { user: bffSession.user } : await requireAuth(request);
    if ("errorResponse" in auth && auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const url = new URL(request.url);
    const turnId = url.searchParams.get("turnId") || undefined;
    if (turnId && !CHAT_TURN_ID_PATTERN.test(turnId)) {
      return NextResponse.json({ error: "请求标识无效" }, { status: 400 });
    }
    let sessionId = url.searchParams.get("sessionId");
    const turnRun = turnId ? activeChatRunManager.getByTurnId(user.id, turnId) : undefined;
    if (!sessionId && turnRun && turnRun.userId === user.id) sessionId = turnRun.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    let session: any = null;
    if (bffSession) {
      session = await bffAiSessionStore.getSession(sessionId, user.id, bffSession.accessToken);
    } else {
      session = await prisma.aiChatSession.findFirst({
        where: { id: sessionId, userId: user.id },
      });
    }
    if (!session) {
      return NextResponse.json({ error: "对话会话不存在或已删除" }, { status: 404 });
    }

    const activeRun = turnId
      ? (turnRun?.sessionId === sessionId ? turnRun : undefined)
      : activeChatRunManager.get(sessionId);
    const isOwnerRun = Boolean(activeRun && activeRun.userId === user.id);
    const messagesInSession = turnId ? await sessionMessages(sessionId, user.id, bffSession, session) : [];
    const userMessage = turnId
      ? messagesInSession.find((message) => message.id === stableChatUserMessageId(user.id, sessionId!, turnId))
      : undefined;
    const assistantMessage = turnId ? findTurnAssistant(messagesInSession, turnId) : undefined;
    const receipt = assistantMessage
      ? readChatTurnReceipt(toolsForMessage(assistantMessage))
      : undefined;
    const llm = assistantMessage ? readChatLlmModelInfo(toolsForMessage(assistantMessage)) : undefined;
    const persistedError = receipt?.status === "failed"
      ? receipt.error || "此前请求失败，请检查状态后重试。"
      : receipt?.status === "cancelled" ? receipt.error || "此前请求已取消。" : undefined;
    const acceptHeader = request.headers.get("accept") || "";
    const wantsStream =
      acceptHeader.includes("text/event-stream") || url.searchParams.get("stream") === "true";

    if (wantsStream) {
      if (isOwnerRun) return streamRun(request, activeRun!);
      if (turnId && receipt && (receipt.status === "completed" || receipt.status === "failed" || receipt.status === "cancelled")) {
        return persistedRunStream(
          { id: session.id, title: session.title, contextType: session.contextType },
          assistantMessage?.content || "",
          llm,
          persistedError,
          receipt ? { turnId: receipt.turnId, attempt: receipt.attempt, retryable: receipt.retryable, writeToolStarted: receipt.writeToolStarted } : undefined,
        );
      }
      if (turnId && userMessage) return NextResponse.json({ error: "请求状态无法确认，请勿自动重复发送", code: "turn_state_unknown" }, { status: 409 });
      return NextResponse.json({ error: "找不到该请求的执行记录", code: "run_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      active: Boolean(isOwnerRun && activeRun!.status === "running"),
      status: isOwnerRun ? activeRun!.status : receipt?.status || (userMessage ? "unknown" : "idle"),
      turnId,
      retryable: isOwnerRun ? activeRun!.retryable : Boolean(receipt?.retryable && !receipt.writeToolStarted),
      writeToolStarted: isOwnerRun ? activeRun!.writeToolStarted : Boolean(receipt?.writeToolStarted),
      error: isOwnerRun ? activeRun!.errorMessage : persistedError,
      llm: isOwnerRun ? activeRun!.llm : llm,
      text: isOwnerRun ? activeRun!.fullText : assistantMessage?.content || "",
      tools: isOwnerRun ? activeRun!.toolTraces : [],
    });
  } catch (err) {
    if (err instanceof BridgeError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("GET /api/ai/chat exception:", err);
    return NextResponse.json({ error: "获取会话状态失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const bffSession = GROWDESK_CONFIG.enabled ? await resolveBffSession(request) : null;
    if (GROWDESK_CONFIG.enabled && !bffSession) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }
    const auth = bffSession ? { user: bffSession.user } : await requireAuth(request);
    if ("errorResponse" in auth && auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    return await withLlmFeature(user.id, "chat", bffSession?.accessToken, async () => {

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`chat:${user.id || ip}`, 20, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `提问过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const explicitTurnId = body.turnId !== undefined;
    const turnId = explicitTurnId ? body.turnId : randomUUID();
    if (typeof turnId !== "string" || !CHAT_TURN_ID_PATTERN.test(turnId)) {
      return NextResponse.json({ error: "请求标识无效", code: "invalid_turn_id" }, { status: 400 });
    }

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

    const babyResult = bffSession
      ? { baby: await loadWebBaby(growdeskFetch, bffSession.accessToken, babyId) }
      : await requireBaby(user.id, babyId);
    if ("errorResponse" in babyResult && babyResult.errorResponse) return babyResult.errorResponse;
    const targetBaby = babyResult.baby;
    if (!targetBaby) return NextResponse.json({ error: "请先添加宝宝信息" }, { status: 404 });

    const rawImages: unknown = body.images ?? body.image;
    const imageList: string[] = Array.isArray(rawImages)
      ? rawImages.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
      : typeof rawImages === "string" && rawImages.trim()
        ? [rawImages.trim()]
        : [];

    const selection = getCurrentLlmFeatureScope()?.selection;
    if (selection?.source === "api" && imageList.length > 0) {
      const profile = getLlmProfileById(selection.profileId);
      if (!profile || selection.modelId !== resolveLlmProfileModel(profile, true)) {
        return NextResponse.json({
          error: "当前聊天模型不支持图片输入，请在模型配置中选择该 profile 的视觉模型。",
          code: "chat_model_vision_required",
          retryable: false,
        }, { status: 400 });
      }
    }
    let backendSession: Awaited<ReturnType<typeof createChatGPTBackend>> | undefined;
    if (selection?.source === "chatgpt") {
      try {
        backendSession = await createChatGPTBackend(user.id, selection.profileId, selection.modelId, imageList.length > 0);
      } catch (error) {
        if (imageList.length > 0 && error instanceof ChatGPTPlanError && error.code === "chatgpt_model_unavailable") {
          return NextResponse.json({
            error: "所选 ChatGPT 模型不支持图片输入，请在模型配置中选择支持图片的模型。",
            code: "chatgpt_model_vision_required",
            retryable: false,
          }, { status: 400 });
        }
        throw error;
      }
    }
    const apiBackend = createLlmBackend(selection?.source === "api" ? "opencode" : undefined, { isVision: imageList.length > 0 });
    if (!backendSession && !apiBackend.getApiKey()) {
      return NextResponse.json({ error: "当前 AI 配置不可用，请在模型来源设置中检查所选 profile 和密钥" }, { status: 503 });
    }
    const llmInfo: ChatLlmModelInfo | undefined = backendSession
      ? { source: "chatgpt", provider: "chatgpt-plan", model: selection!.modelId, profileId: selection!.profileId }
      : getCurrentLlmModelInfo(imageList.length > 0);

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

    const fingerprint = requestFingerprint({
      prompt: promptText,
      images: imageList,
      babyId: targetBaby.id,
      contextType,
      contextDetail,
    });
    const retryingRun = activeChatRunManager.getByTurnId(user.id, turnId);
    if (retryingRun?.status === "running") {
      if (retryingRun.requestFingerprint !== fingerprint || (sessionId && sessionId !== retryingRun.sessionId)) {
        return NextResponse.json({ error: "该请求标识已用于其他内容", code: "turn_content_conflict" }, { status: 409 });
      }
      return streamRun(request, retryingRun);
    }
    if (!sessionId && body.retry === true) {
      return NextResponse.json(
        { error: "找不到该请求所属的对话，已停止重放以避免重复处理", code: "turn_session_unknown", retryable: false },
        { status: 409 },
      );
    }
    if (!sessionId && explicitTurnId) {
      return NextResponse.json({ error: "发送前必须创建对话，以便安全检查请求状态", code: "chat_session_required" }, { status: 400 });
    }

    if (promptText) {
      void archiveText("input_text", promptText).catch(() => {});
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

    const userMessageId = stableChatUserMessageId(user.id, sid, turnId);
    const existingMessages = await sessionMessages(sid, user.id, bffSession, currentSession);
    const persistedUser = existingMessages.find((message) => message.id === userMessageId);
    if (persistedUser && !samePersistedUserMessage(persistedUser, promptText, imagePersistStr)) {
      return NextResponse.json({ error: "该请求标识已用于其他消息", code: "turn_content_conflict" }, { status: 409 });
    }
    if (persistedUser) {
      const requestMarker = readChatTurnRequest(toolsForMessage(persistedUser));
      if (!requestMarker || requestMarker.turnId !== turnId || requestMarker.fingerprint !== fingerprint) {
        return NextResponse.json({ error: "该请求内容或上下文与首次提交不一致，已停止重放", code: "turn_content_conflict", retryable: false }, { status: 409 });
      }
    }

    let attempt = 1;
    const priorAssistant = findTurnAssistant(existingMessages, turnId);
    const priorReceipt = priorAssistant
      ? readChatTurnReceipt(toolsForMessage(priorAssistant))
      : undefined;
    const priorLlm = priorAssistant
      ? readChatLlmModelInfo(toolsForMessage(priorAssistant))
      : undefined;
    if (persistedUser) {
      if (!priorReceipt) {
        return NextResponse.json(
          { error: "此前的请求状态无法确认，为避免重复执行，不能自动重放", code: "turn_state_unknown", retryable: false },
          { status: 409 },
        );
      }
      if (priorReceipt.status === "completed") {
        return persistedRunStream(
          { id: currentSession.id, title: currentSession.title, contextType: currentSession.contextType },
          priorAssistant.content || "",
          priorLlm,
        );
      }
      if (body.retry !== true) {
        return persistedRunStream(
          { id: currentSession.id, title: currentSession.title, contextType: currentSession.contextType },
          priorAssistant.content || "",
          priorLlm,
          priorReceipt.error || "此前请求失败；请先检查状态，再点击重试。",
          { turnId, attempt: priorReceipt.attempt, retryable: priorReceipt.retryable, writeToolStarted: priorReceipt.writeToolStarted },
        );
      }
      if (priorReceipt.status !== "failed" || !priorReceipt.retryable || priorReceipt.writeToolStarted) {
        return NextResponse.json(
          { error: priorReceipt.writeToolStarted ? "此前已开始写入工具操作，整轮重放不安全" : priorReceipt.error || "此前请求不可安全重试", code: "unsafe_turn_retry", retryable: false },
          { status: 409 },
        );
      }
      attempt = priorReceipt.attempt + 1;
    }

    // Check if a different agent run is already using the session.
    const existingRun = activeChatRunManager.get(sid);
    if (existingRun && existingRun.status === "running") {
      if (existingRun.turnId === turnId && existingRun.requestFingerprint === fingerprint) {
        return streamRun(request, existingRun);
      }
      return NextResponse.json(
        {
          error: "当前会话正在思考生成中，请等待完成或点击停止生成后再发送新问题",
          active: true,
          sessionId: sid,
        },
        { status: 409 }
      );
    }

    // Claim the stable user row before work starts. Only the atomic winner may call the model.
    const requestToolsJson = makeChatTurnRequestToolsJson(turnId, fingerprint, {
      contextDetailPresent: Object.prototype.hasOwnProperty.call(body, "contextDetail"),
      ...(Object.prototype.hasOwnProperty.call(body, "contextDetail") ? { contextDetail } : {}),
    });
    if (!persistedUser) {
      if (bffSession) {
        const claim = await bffAiSessionStore.addMessage(
          sid,
          user.id,
          {
            id: userMessageId,
            role: "user",
            content: promptText,
            image: imagePersistStr,
            toolsJson: requestToolsJson,
            claim: true,
          },
          bffSession.accessToken,
        );
        if (claim?.created !== true) {
          return NextResponse.json({ error: "该请求已由另一执行者领取；请查询状态后再继续", code: "turn_claimed", retryable: false }, { status: 409 });
        }
      } else {
        try {
          await prisma.aiChatMessage.create({
            data: {
              id: userMessageId,
              sessionId: sid,
              role: "user",
              content: promptText,
              image: imagePersistStr,
              toolsJson: requestToolsJson,
            },
          });
        } catch (error) {
          const existing = await prisma.aiChatMessage.findUnique({ where: { id: userMessageId } });
          if (!existing || !samePersistedUserMessage(existing, promptText, imagePersistStr)) throw error;
          return NextResponse.json({ error: "该请求已由另一执行者领取；请查询状态后再继续", code: "turn_claimed", retryable: false }, { status: 409 });
        }
      }
    } else if (attempt > 1) {
      const claimId = stableChatRetryClaimMessageId(user.id, sid, turnId, attempt);
      if (existingMessages.some((message) => message.id === claimId)) {
        return NextResponse.json({ error: "该重试已由另一执行者领取；请查询状态后再继续", code: "retry_claimed", retryable: false }, { status: 409 });
      }
      if (bffSession) {
        const claim = await bffAiSessionStore.addMessage(sid, user.id, {
          id: claimId,
          role: "system",
          content: "重试执行权",
          toolsJson: makeChatRetryClaimToolsJson(turnId, attempt),
          claim: true,
        }, bffSession.accessToken);
        if (claim?.created !== true) {
          return NextResponse.json({ error: "该重试已由另一执行者领取；请查询状态后再继续", code: "retry_claimed", retryable: false }, { status: 409 });
        }
      } else {
        try {
          await prisma.aiChatMessage.create({ data: {
            id: claimId,
            sessionId: sid,
            role: "system",
            content: "重试执行权",
            toolsJson: makeChatRetryClaimToolsJson(turnId, attempt),
          } });
        } catch (error) {
          const existing = await prisma.aiChatMessage.findUnique({ where: { id: claimId } });
          if (!existing) throw error;
          return NextResponse.json({ error: "该重试已由另一执行者领取；请查询状态后再继续", code: "retry_claimed", retryable: false }, { status: 409 });
        }
      }
    }

    const systemPrompt = buildAgentSystemPrompt({
      contextType,
      contextDetail,
      baby: targetBaby,
    });

    const lastUserIndex = [...messages].map((message: { role?: string }, index: number) => ({ message, index }))
      .reverse().find(({ message }) => message.role === "user")?.index ?? messages.length;
    const prior = messages.filter(
      (m: { role?: string }, idx: number) =>
        idx < lastUserIndex && (m.role === "user" || m.role === "assistant")
    );

    // 3. Start background runner decoupled from client request.signal
    activeChatRunManager.startRun({
      sessionId: sid,
      userId: user.id,
      turnId,
      attempt,
      requestFingerprint: fingerprint,
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
      backendSession,
      llmInfo,
      pinnedLlm: selection?.source === "api",
    });
    const run = activeChatRunManager.getByTurnId(user.id, turnId);
    return run ? streamRun(request, run) : NextResponse.json({ error: "AI 请求未能启动", code: "chat_run_missing" }, { status: 500 });
    });
  } catch (error) {
    if (error instanceof BridgeError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof ChatGPTPlanError) return NextResponse.json({ error: planErrorMessage(error), code: error.code }, { status: 400 });
    console.error("POST /api/ai/chat exception:", error);
    return NextResponse.json({ error: "AI 请求未能启动，请查看状态后再决定是否重试", code: "chat_start_failed" }, { status: 500 });
  }
}
