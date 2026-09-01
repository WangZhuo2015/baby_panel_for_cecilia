import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import { createLlmBackend, createOpencodeResponsesBackend, OPENROUTER_HEADERS, type LlmBackendId } from "@/lib/agent/model";

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

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; message?: string };
  if (e.status === 404 || e.status === 405) return true;
  if (typeof e.message === "string" && (e.message.includes("404") || e.message.toLowerCase().includes("not found") || e.message.includes("405"))) return true;
  return false;
}

export async function runBabyAgent(opts: RunBabyAgentOptions): Promise<void> {
  const hasImages = Boolean(opts.images && opts.images.length > 0);
  // Try Opencode first (chat -> responses), then OpenRouter - keep both endpoints
  const useOpencode = Boolean(process.env.AI_API_KEY);
  const opencodeChat = useOpencode ? createLlmBackend("opencode", { isVision: hasImages }) : null;
  const opencodeResponses = useOpencode && !hasImages ? createOpencodeResponsesBackend() : null;
  const openrouter = createLlmBackend("openrouter", { isVision: hasImages });

  const makeStreamFn = (backend: { models: { streamSimple: StreamFn }, model: Model<any> }, providerHeader: Record<string,string>): StreamFn => {
    const inner = (backend.models as any).streamSimple.bind(backend.models);
    return (m, context, options) => inner(m, context, {
      ...options,
      toolChoice: options?.toolChoice ?? "auto",
      headers: { ...providerHeader, ...options?.headers },
    });
  };

  const opencodeChatFn = opencodeChat ? makeStreamFn(opencodeChat as any, {}) : null;
  const opencodeResponsesFn = opencodeResponses ? makeStreamFn(opencodeResponses as any, {}) : null;
  const openrouterFn = (() => {
    const inner = openrouter.models.streamSimple.bind(openrouter.models);
    return (m: Model<any>, context: any, options: any) => inner(m, context, {
      ...options,
      toolChoice: options?.toolChoice ?? "auto",
      headers: { ...OPENROUTER_HEADERS, ...options?.headers },
    });
  })() as StreamFn;

  const created = opts.streamFn && opts.model ? null : (opencodeChat ?? openrouter);
  const model = opts.model ?? created!.model;

  // Unified streamFn with dual endpoint + dual provider fallback + 429 retry
  const streamFn: StreamFn = async (m, context, options) => {
    const candidates: Array<{ fn: StreamFn; name: string }> = [];
    if (opencodeChatFn) candidates.push({ fn: opencodeChatFn, name: "opencode-chat" });
    if (opencodeResponsesFn) candidates.push({ fn: opencodeResponsesFn, name: "opencode-responses" });
    candidates.push({ fn: openrouterFn, name: "openrouter" });

    // If opts.streamFn provided, use it directly with retry
    if (opts.streamFn) {
      let lastError: unknown;
      for (let attempt = 0; attempt <= 10; attempt++) {
        try { return await opts.streamFn(m, context, options); } catch (e) {
          lastError = e;
          if (attempt === 10 || !isRateLimitError(e)) throw e;
          const backoff = getRetryAfterMs(e) ?? Math.min(1000 * Math.pow(2, attempt), 10000);
          await new Promise(r => setTimeout(r, backoff + Math.random()*500));
        }
      }
      throw lastError;
    }

    let lastError: unknown;
    for (const { fn, name } of candidates) {
      for (let attempt = 0; attempt <= 10; attempt++) {
        try {
          // Use the candidate's model for provider header
          const candidateModel = name.startsWith("opencode") ? (name === "opencode-chat" ? opencodeChat!.model : opencodeResponses!.model) : openrouter.model;
          return await fn(candidateModel as any, context, options);
        } catch (error) {
          lastError = error;
          // For opencode-chat 404, immediately try next endpoint (responses) without consuming retry
          if (name === "opencode-chat" && isNotFoundError(error)) break;
          if (isRateLimitError(error) && attempt < 10) {
            const backoff = getRetryAfterMs(error) ?? Math.min(1000 * Math.pow(2, attempt), 10000);
            await new Promise(r => setTimeout(r, backoff + Math.random()*500));
            continue;
          }
          // For other errors, try next provider
          break;
        }
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
    getApiKey: opts.getApiKey ?? opencodeChat?.getApiKey ?? openrouter.getApiKey ?? (() => undefined),
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
