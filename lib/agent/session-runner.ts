import { randomUUID } from "node:crypto";
import type { AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { prisma } from "@/lib/prisma";
import { archiveText } from "@/lib/archive";
import { createBabyPanelTools } from "@/lib/agent/tools";
import { resolveImageContent } from "@/lib/agent/images";
import { runBabyAgent } from "@/lib/agent/run";
import { isGrowDeskEnabled } from "@/lib/growdesk/config";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";
import {
  isPotentialWriteTool,
  makeChatToolsJson,
  stableChatAssistantMessageId,
  type ChatLlmModelInfo,
  type ChatTurnReceipt,
} from "@/lib/agent/chat-retry";

export type ChatRunStatus = "running" | "completed" | "failed" | "cancelled";

export type ChatStreamEvent =
  | { type: "session"; session: { id: string; title: string; contextType: string } }
  | { type: "text"; text: string; replay?: boolean }
  | { type: "tool"; tool: any; replay?: boolean }
  | { type: "llm"; llm: ChatLlmModelInfo; replay?: boolean }
  | { type: "done" }
  | { type: "error"; error: string; turnId?: string; retryable?: boolean; writeToolStarted?: boolean; attempt?: number };

export type ChatStreamSubscriber = (event: ChatStreamEvent) => void;

export interface ActiveChatRun {
  sessionId: string;
  userId: string;
  babyId?: string | null;
  turnId: string;
  attempt: number;
  status: ChatRunStatus;
  fullText: string;
  toolTraces: any[];
  abortController: AbortController;
  subscribers: Set<ChatStreamSubscriber>;
  createdAt: number;
  lastActiveAt: number;
  timeoutTimer: NodeJS.Timeout;
  sessionMeta: { id: string; title: string; contextType: string };
  promise: Promise<void>;
  broadcast: (event: ChatStreamEvent) => void;
  isTimedOut?: boolean;
  llm?: ChatLlmModelInfo;
  writeToolStarted: boolean;
  errorMessage?: string;
  retryable: boolean;
  requestFingerprint: string;
}

export interface StartChatRunParams {
  sessionId: string;
  userId: string;
  turnId?: string;
  attempt?: number;
  requestFingerprint?: string;
  baby: any;
  promptText: string;
  imageList?: string[];
  systemPrompt: string;
  history: AgentMessage[];
  sessionMeta: { id: string; title: string; contextType: string };
  timeoutMs?: number;
  streamFn?: StreamFn;
  model?: Model<any>;
  getApiKey?: (provider: string) => string | undefined;
  accessToken?: string;
  familyId?: string;
  backendSession?: import("@/lib/chatgpt-plan").ChatGPTBackend;
  llmInfo?: ChatLlmModelInfo;
  pinnedLlm?: boolean;
}

async function saveAssistantMessage(
  sessionId: string,
  userId: string,
  content: string,
  toolTraces: any[],
  turn: ChatTurnReceipt,
  llm: ChatLlmModelInfo | undefined,
  messageId: string,
  accessToken?: string
): Promise<void> {
  const toolsJson = makeChatToolsJson(toolTraces, { llm, turn });
  if (isGrowDeskEnabled()) {
    const saved = await bffAiSessionStore.addMessage(
      sessionId,
      userId,
      {
        role: "assistant",
        content,
        id: messageId,
        toolsJson: toolsJson ?? undefined,
      },
      accessToken
    );
    if (!saved) throw new Error("GrowDesk did not persist the assistant message");
    return;
  }
  await prisma.aiChatMessage.create({
    data: {
      sessionId,
      role: "assistant",
      content,
      toolsJson,
      id: messageId,
    },
  });
  await prisma.aiChatSession.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });
}

async function trySaveAssistantMessage(...args: Parameters<typeof saveAssistantMessage>): Promise<boolean> {
  try {
    await saveAssistantMessage(...args);
    return true;
  } catch (error) {
    console.error("[SessionRunner] Assistant message persistence failed:", error);
    return false;
  }
}

function markPersistenceFailure(run: ActiveChatRun): void {
  run.status = "failed";
  run.errorMessage = "回复已生成，但对话记录保存失败；执行结果无法确认，请勿重复提交。";
  run.retryable = false;
  run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: false, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
}

export class ActiveChatRunManager {
  private runs = new Map<string, ActiveChatRun>();
  private turnRuns = new Map<string, ActiveChatRun>();

  private turnKey(userId: string, turnId: string): string {
    return `${userId}:${turnId}`;
  }

  public get(sessionId: string): ActiveChatRun | undefined {
    return this.runs.get(sessionId);
  }

  public getByTurnId(userId: string, turnId: string): ActiveChatRun | undefined {
    return this.turnRuns.get(this.turnKey(userId, turnId));
  }

  public has(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  public getActiveCount(): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.status === "running") count += 1;
    }
    return count;
  }

  public startRun(params: StartChatRunParams): ActiveChatRun {
    const turnId = params.turnId || randomUUID();
    const attempt = Math.max(1, params.attempt || 1);
    const requestFingerprint = params.requestFingerprint || "";
    const existingTurn = this.getByTurnId(params.userId, turnId);
    if (existingTurn?.status === "running") return existingTurn;
    const existing = this.runs.get(params.sessionId);
    if (existing && existing.status === "running" && existing.userId === params.userId) {
      return existing;
    }

    if (existing) {
      clearTimeout(existing.timeoutTimer);
      this.runs.delete(params.sessionId);
    }

    const abortController = new AbortController();
    const subscribers = new Set<ChatStreamSubscriber>();
    const timeoutMs = params.timeoutMs ?? 180_000;

    const broadcast = (event: ChatStreamEvent) => {
      for (const sub of subscribers) {
        try {
          sub(event);
        } catch {
          subscribers.delete(sub);
        }
      }
    };

    const run: ActiveChatRun = {
      sessionId: params.sessionId,
      userId: params.userId,
      turnId,
      attempt,
      babyId: params.baby?.id ?? null,
      status: "running",
      fullText: "",
      toolTraces: [],
      abortController,
      subscribers,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      sessionMeta: params.sessionMeta,
      timeoutTimer: null as unknown as NodeJS.Timeout,
      promise: Promise.resolve(),
      broadcast,
      writeToolStarted: false,
      llm: params.llmInfo,
      retryable: false,
      requestFingerprint,
    };

    run.timeoutTimer = setTimeout(() => {
      if (run.status === "running") {
        console.warn(`[ActiveChatRunManager] Session ${params.sessionId} timed out after ${timeoutMs}ms`);
        run.isTimedOut = true;
        run.status = "failed";
        run.errorMessage = "AI 会话执行超时，请稍后重试";
        // Abort is cooperative; advertise retry only after the old execution settles.
        run.retryable = false;
        run.abortController.abort();
        run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: run.retryable, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
        run.broadcast({ type: "done" });
      }
    }, timeoutMs);

    run.promise = (async () => {
      try {
        const resolvedImages: ImageContent[] = [];
        if (params.imageList && params.imageList.length > 0) {
          for (const imgStr of params.imageList.slice(0, 6)) {
            const resolved = await resolveImageContent(imgStr);
            if (resolved) resolvedImages.push(resolved);
          }
        }

        const tools: AgentTool[] = createBabyPanelTools({
          userId: params.userId,
          baby: params.baby,
          accessToken: params.accessToken,
          familyId: params.familyId,
        });

        await runBabyAgent({
          systemPrompt: params.systemPrompt,
          history: params.history,
          prompt: params.promptText,
          images: resolvedImages.length > 0 ? resolvedImages : undefined,
          tools,
          abortSignal: run.abortController.signal,
          streamFn: params.streamFn,
          model: params.model,
          getApiKey: params.getApiKey,
          backendSession: params.backendSession,
          llmInfo: params.llmInfo,
          pinnedLlm: params.pinnedLlm,
          onModelUsed: (llm) => {
            run.llm = llm;
            run.broadcast({ type: "llm", llm });
          },
          onEvent: (event) => {
            run.lastActiveAt = Date.now();
            if (event.type === "text") {
              run.fullText += event.text;
              run.broadcast({ type: "text", text: event.text });
            } else {
              if (event.status === "start" && isPotentialWriteTool(event.name)) {
                run.writeToolStarted = true;
                run.retryable = false;
              }
              if (event.status === "end") {
                run.toolTraces.push(event);
              }
              run.broadcast({ type: "tool", tool: event });
            }
          },
        });

        if (run.fullText) {
          void archiveText("output_json", run.fullText).catch(() => {});
        }

        // If the run was aborted (by timeout watchdog or user cancellation)
        if (run.abortController.signal.aborted) {
          const isTimedOut = Boolean(run.isTimedOut || run.status === "failed");
          if (isTimedOut) {
            run.status = "failed";
          } else {
            run.status = "cancelled";
          }
          const finalMsg =
            run.fullText || (isTimedOut ? "AI 会话执行超时，请稍后重试。" : "已取消生成。");
          run.errorMessage = isTimedOut ? (run.errorMessage || finalMsg) : undefined;
          run.retryable = isTimedOut && !run.writeToolStarted;
          const saved = await trySaveAssistantMessage(
            run.sessionId,
            run.userId,
            finalMsg,
            run.toolTraces,
            { type: "llm_turn", turnId: run.turnId, status: run.status, attempt: run.attempt, retryable: run.retryable, writeToolStarted: run.writeToolStarted, error: run.errorMessage },
            run.llm,
            stableChatAssistantMessageId(run.userId, run.sessionId, run.turnId, run.attempt),
            params.accessToken
          );
          if (!saved) markPersistenceFailure(run);
          if (run.errorMessage) run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: run.retryable, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
          run.broadcast({ type: "done" });
          return;
        }

        // Persist assistant response upon successful completion
        const saved = await trySaveAssistantMessage(
          run.sessionId,
          run.userId,
          run.fullText || "未能获取有效回复，请重试。",
          run.toolTraces,
          { type: "llm_turn", turnId: run.turnId, status: "completed", attempt: run.attempt, retryable: false, writeToolStarted: run.writeToolStarted },
          run.llm,
          stableChatAssistantMessageId(run.userId, run.sessionId, run.turnId, run.attempt),
          params.accessToken
        );

        if (!saved) {
          markPersistenceFailure(run);
          run.broadcast({ type: "done" });
          return;
        }

        run.status = "completed";
        run.broadcast({ type: "done" });
      } catch (err: any) {
        const isTimedOut = Boolean(run.isTimedOut || run.status === "failed");
        const isAborted = run.abortController.signal.aborted || err?.name === "AbortError";
        if (isTimedOut) {
          run.status = "failed";
          run.errorMessage = run.errorMessage || String(err?.message || "AI 会话执行超时，请稍后重试。");
          run.retryable = !run.writeToolStarted;
          const fallback = run.fullText || "AI 会话执行超时，请稍后重试。";
          const saved = await trySaveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            { type: "llm_turn", turnId: run.turnId, status: "failed", attempt: run.attempt, retryable: run.retryable, writeToolStarted: run.writeToolStarted, error: run.errorMessage },
            run.llm,
            stableChatAssistantMessageId(run.userId, run.sessionId, run.turnId, run.attempt),
            params.accessToken
          );
          if (!saved) markPersistenceFailure(run);
          run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: run.retryable, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
          run.broadcast({ type: "done" });
        } else if (isAborted) {
          run.status = "cancelled";
          run.errorMessage = String(err?.message || "生成已取消");
          run.retryable = false;
          const fallback = run.fullText || "已取消生成。";
          const saved = await trySaveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            { type: "llm_turn", turnId: run.turnId, status: "cancelled", attempt: run.attempt, retryable: false, writeToolStarted: run.writeToolStarted, error: run.errorMessage },
            run.llm,
            stableChatAssistantMessageId(run.userId, run.sessionId, run.turnId, run.attempt),
            params.accessToken
          );
          if (!saved) markPersistenceFailure(run);
          if (!saved) run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: false, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
          run.broadcast({ type: "done" });
        } else {
          console.error("[SessionRunner] AI agent execution error:", err);
          run.status = "failed";
          run.errorMessage = String(err?.message || "AI 请求未完成，请稍后重试。");
          run.retryable = !run.writeToolStarted;
          const fallback = run.fullText || run.errorMessage;
          const saved = await trySaveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            { type: "llm_turn", turnId: run.turnId, status: "failed", attempt: run.attempt, retryable: run.retryable, writeToolStarted: run.writeToolStarted, error: run.errorMessage },
            run.llm,
            stableChatAssistantMessageId(run.userId, run.sessionId, run.turnId, run.attempt),
            params.accessToken
          );
          if (!saved) markPersistenceFailure(run);
          run.broadcast({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: run.retryable, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
          run.broadcast({ type: "done" });
        }
      } finally {
        clearTimeout(run.timeoutTimer);
        run.subscribers.clear();
        // Retain run state in memory for 60 seconds before cleanup
        setTimeout(() => {
          if (this.runs.get(run.sessionId) === run) {
            this.runs.delete(run.sessionId);
          }
          if (this.turnRuns.get(this.turnKey(run.userId, run.turnId)) === run) {
            this.turnRuns.delete(this.turnKey(run.userId, run.turnId));
          }
        }, 60_000).unref?.();
      }
    })();

    this.runs.set(params.sessionId, run);
    this.turnRuns.set(this.turnKey(params.userId, turnId), run);
    return run;
  }

  public attachSubscriber(
    sessionId: string,
    subscriber: ChatStreamSubscriber,
    replay = true
  ): boolean {
    const run = this.runs.get(sessionId);
    return run ? this.attachRunSubscriber(run, subscriber, replay) : false;
  }

  public attachTurnSubscriber(
    userId: string,
    turnId: string,
    subscriber: ChatStreamSubscriber,
    replay = true,
  ): boolean {
    const run = this.getByTurnId(userId, turnId);
    return run ? this.attachRunSubscriber(run, subscriber, replay) : false;
  }

  public attachRunSubscriber(
    run: ActiveChatRun,
    subscriber: ChatStreamSubscriber,
    replay = true,
  ): boolean {

    if (run.status !== "running") {
      if (replay) {
        subscriber({ type: "session", session: run.sessionMeta });

        for (const tool of run.toolTraces) {
          subscriber({ type: "tool", tool, replay: true });
        }

        if (run.llm) subscriber({ type: "llm", llm: run.llm, replay: true });

        if (run.fullText) {
          subscriber({ type: "text", text: run.fullText, replay: true });
        }

        if (run.status === "failed" && run.errorMessage) {
          subscriber({ type: "error", error: run.errorMessage, turnId: run.turnId, retryable: run.retryable, writeToolStarted: run.writeToolStarted, attempt: run.attempt });
        }
        subscriber({ type: "done" });
      }
      return true;
    }

    run.subscribers.add(subscriber);

    if (replay) {
      subscriber({ type: "session", session: run.sessionMeta });

      for (const tool of run.toolTraces) {
        subscriber({ type: "tool", tool, replay: true });
      }

      if (run.llm) subscriber({ type: "llm", llm: run.llm, replay: true });

      if (run.fullText) {
        subscriber({ type: "text", text: run.fullText, replay: true });
      }
    }

    return true;
  }

  public detachSubscriber(sessionId: string, subscriber: ChatStreamSubscriber): void {
    const run = this.runs.get(sessionId);
    if (run) {
      run.subscribers.delete(subscriber);
    }
  }

  public detachRunSubscriber(run: ActiveChatRun, subscriber: ChatStreamSubscriber): void {
    run.subscribers.delete(subscriber);
  }

  public async cancelRun(sessionId: string, userId?: string): Promise<boolean> {
    const run = this.runs.get(sessionId);
    if (!run) return false;
    if (userId && run.userId !== userId) return false;
    if (run.status !== "running") return false;

    run.abortController.abort();
    run.status = "cancelled";
    try {
      await run.promise;
    } catch {}
    return true;
  }

  public delete(sessionId: string): void {
    const run = this.runs.get(sessionId);
    if (run) {
      clearTimeout(run.timeoutTimer);
      this.runs.delete(sessionId);
    }
  }

  public clearAllForTest(): void {
    for (const run of this.runs.values()) {
      clearTimeout(run.timeoutTimer);
      run.abortController.abort();
    }
    this.runs.clear();
    this.turnRuns.clear();
  }
}

const globalForRunner = globalThis as unknown as {
  __activeChatRunManager?: ActiveChatRunManager;
};

export const activeChatRunManager =
  globalForRunner.__activeChatRunManager ??
  (globalForRunner.__activeChatRunManager = new ActiveChatRunManager());
