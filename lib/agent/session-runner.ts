import type { AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { prisma } from "@/lib/prisma";
import { archiveText } from "@/lib/archive";
import { createBabyPanelTools } from "@/lib/agent/tools";
import { resolveImageContent } from "@/lib/agent/images";
import { runBabyAgent } from "@/lib/agent/run";
import { isGrowDeskEnabled } from "@/lib/growdesk/config";
import { bffAiSessionStore } from "@/lib/growdesk/ai-sessions";

export type ChatRunStatus = "running" | "completed" | "failed" | "cancelled";

export type ChatStreamEvent =
  | { type: "session"; session: { id: string; title: string; contextType: string } }
  | { type: "text"; text: string; replay?: boolean }
  | { type: "tool"; tool: any; replay?: boolean }
  | { type: "done" }
  | { type: "error"; error: string };

export type ChatStreamSubscriber = (event: ChatStreamEvent) => void;

export interface ActiveChatRun {
  sessionId: string;
  userId: string;
  babyId?: string | null;
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
}

export interface StartChatRunParams {
  sessionId: string;
  userId: string;
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
}

async function saveAssistantMessage(
  sessionId: string,
  userId: string,
  content: string,
  toolTraces: any[],
  accessToken?: string
): Promise<void> {
  const toolsJson = toolTraces.length > 0 ? JSON.stringify(toolTraces) : null;
  if (isGrowDeskEnabled()) {
      await bffAiSessionStore.addMessage(
        sessionId,
        userId,
        {
          role: "assistant",
          content,
          toolsJson: toolsJson ?? undefined,
        },
        accessToken
      );
    return;
  }
  try {
    await prisma.aiChatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content,
        toolsJson,
      },
    });
    await prisma.aiChatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  } catch (dbErr) {
    console.error("[SessionRunner] Failed to persist assistant message:", dbErr);
  }
}

export class ActiveChatRunManager {
  private runs = new Map<string, ActiveChatRun>();

  public get(sessionId: string): ActiveChatRun | undefined {
    return this.runs.get(sessionId);
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
    const existing = this.runs.get(params.sessionId);
    if (existing && existing.status === "running") {
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
    };

    run.timeoutTimer = setTimeout(() => {
      if (run.status === "running") {
        console.warn(`[ActiveChatRunManager] Session ${params.sessionId} timed out after ${timeoutMs}ms`);
        run.isTimedOut = true;
        run.status = "failed";
        run.abortController.abort();
        run.broadcast({ type: "error", error: "AI 会话执行超时，请稍后重试" });
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
          onEvent: (event) => {
            run.lastActiveAt = Date.now();
            if (event.type === "text") {
              run.fullText += event.text;
              run.broadcast({ type: "text", text: event.text });
            } else {
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
          await saveAssistantMessage(
            run.sessionId,
            run.userId,
            finalMsg,
            run.toolTraces,
            params.accessToken
          );
          run.broadcast({ type: "done" });
          return;
        }

        // Persist assistant response upon successful completion
        await saveAssistantMessage(
          run.sessionId,
          run.userId,
          run.fullText || "未能获取有效回复，请重试。",
          run.toolTraces,
          params.accessToken
        );

        run.status = "completed";
        run.broadcast({ type: "done" });
      } catch (err: any) {
        const isTimedOut = Boolean(run.isTimedOut || run.status === "failed");
        const isAborted = run.abortController.signal.aborted || err?.name === "AbortError";
        if (isTimedOut) {
          run.status = "failed";
          const fallback = run.fullText || "AI 会话执行超时，请稍后重试。";
          await saveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            params.accessToken
          );
          run.broadcast({ type: "done" });
        } else if (isAborted) {
          run.status = "cancelled";
          const fallback = run.fullText || "已取消生成。";
          await saveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            params.accessToken
          );
          run.broadcast({ type: "done" });
        } else {
          console.error("[SessionRunner] AI agent execution error:", err);
          run.status = "failed";
          const fallback =
            run.fullText ||
            "网络连接暂时超时，请稍后重新提问。若宝宝身体有明显不适，请以专业医生诊断为准。";
          if (!run.fullText) {
            run.broadcast({ type: "text", text: fallback });
          }
          await saveAssistantMessage(
            run.sessionId,
            run.userId,
            fallback,
            run.toolTraces,
            params.accessToken
          );
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
        }, 60_000).unref?.();
      }
    })();

    this.runs.set(params.sessionId, run);
    return run;
  }

  public attachSubscriber(
    sessionId: string,
    subscriber: ChatStreamSubscriber,
    replay = true
  ): boolean {
    const run = this.runs.get(sessionId);
    if (!run) return false;

    if (run.status !== "running") {
      if (replay) {
        subscriber({ type: "session", session: run.sessionMeta });

        for (const tool of run.toolTraces) {
          subscriber({ type: "tool", tool, replay: true });
        }

        if (run.fullText) {
          subscriber({ type: "text", text: run.fullText, replay: true });
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
  }
}

const globalForRunner = globalThis as unknown as {
  __activeChatRunManager?: ActiveChatRunManager;
};

export const activeChatRunManager =
  globalForRunner.__activeChatRunManager ??
  (globalForRunner.__activeChatRunManager = new ActiveChatRunManager());
