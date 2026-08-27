import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createLlmBackend, OPENROUTER_HEADERS, type LlmBackendId } from "@/lib/agent/model";

const MAX_TURNS = 8;

export type AgentStreamEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      name: string;
      label?: string;
      status: "start" | "end";
      args?: unknown;
      isError?: boolean;
      summary?: string;
      details?: unknown;
    };

export interface RunBabyAgentOptions {
  systemPrompt: string;
  history: AgentMessage[];
  prompt: string;
  images?: ImageContent[];
  tools: AgentTool[];
  abortSignal?: AbortSignal;
  onEvent: (event: AgentStreamEvent) => void;
  streamFn?: StreamFn;
  model?: Model<any>;
  backend?: LlmBackendId;
  getApiKey?: (provider: string) => string | undefined;
}

function toolLabel(tools: AgentTool[], name: string): string | undefined {
  return tools.find((t) => t.name === name)?.label;
}

function toolResultSummary(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) return undefined;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; message?: string; cause?: unknown };
  if (e.status === 429) return true;
  if (typeof e.message === "string" && (e.message.includes("429") || e.message.toLowerCase().includes("rate limit") || e.message.toLowerCase().includes("too many requests"))) return true;
  if (e.cause && typeof e.cause === "object" && (e.cause as { status?: number }).status === 429) return true;
  return false;
}

export function getRetryAfterMs(error: unknown): number | null {
  const e = error as { headers?: Record<string, string>; response?: { headers?: { get: (k:string)=>string|null } } };
  const raw = e.headers?.["retry-after"] || e.headers?.["Retry-After"] || e.response?.headers?.get?.("retry-after") || null;
  if (raw) {
    const secs = parseInt(raw, 10);
    if (!Number.isNaN(secs)) return secs * 1000;
  }
  return null;
}

export async function runBabyAgent(opts: RunBabyAgentOptions): Promise<void> {
  const created = opts.streamFn && opts.model ? null : createLlmBackend(opts.backend ?? "openrouter");
  const model = opts.model ?? created!.model;
  const innerStream = opts.streamFn ?? created!.models.streamSimple.bind(created!.models);
  const baseStreamFn: StreamFn = (m, context, options) =>
    innerStream(m, context, {
      ...options,
      toolChoice: options?.toolChoice ?? "auto",
      headers: {
        ...(m.provider === "openrouter" ? OPENROUTER_HEADERS : {}),
        ...options?.headers,
      },
    });
  // Wrap with 429 retry (10 times)
  const streamFn: StreamFn = async (m, context, options) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= 10; attempt++) {
      try {
        return await baseStreamFn(m, context, options);
      } catch (error) {
        lastError = error;
        if (attempt === 10 || !isRateLimitError(error)) throw error;
        const retryAfter = getRetryAfterMs(error);
        const backoff = retryAfter ?? Math.min(1000 * Math.pow(2, attempt), 10000);
        // Add jitter
        const jitter = Math.random() * 500;
        await new Promise((r) => setTimeout(r, backoff + jitter));
      }
    }
    throw lastError;
  };
  let turns = 0;

  const agent = new Agent({
    initialState: {
      systemPrompt: opts.systemPrompt,
      model,
      tools: opts.tools,
      thinkingLevel: "low",
      messages: opts.history,
    },
    streamFn,
    getApiKey: opts.getApiKey ?? created?.getApiKey ?? (() => undefined),
    toolExecution: "sequential",
    shouldStopAfterTurn: () => {
      turns += 1;
      return turns >= MAX_TURNS;
    },
  });

  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      agent.abort();
    } else {
      opts.abortSignal.addEventListener("abort", () => agent.abort(), { once: true });
    }
  }

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      opts.onEvent({ type: "text", text: event.assistantMessageEvent.delta });
      return;
    }
    if (event.type === "tool_execution_start") {
      opts.onEvent({
        type: "tool",
        name: event.toolName,
        label: toolLabel(opts.tools, event.toolName),
        status: "start",
        args: event.args,
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      opts.onEvent({
        type: "tool",
        name: event.toolName,
        label: toolLabel(opts.tools, event.toolName),
        status: "end",
        isError: event.isError,
        summary: toolResultSummary(event.result),
        details: (event.result as { details?: unknown })?.details ?? event.result,
      });
    }
  });

  await agent.prompt(opts.prompt, opts.images);
}
