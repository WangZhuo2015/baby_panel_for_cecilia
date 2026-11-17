import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type StreamFn,
} from "@earendil-works/pi-agent-core";
import { planErrorMessage } from "@/lib/chatgpt-plan/core.mjs";
import type { ImageContent, Model } from "@earendil-works/pi-ai";
import {
  createLlmBackend,
  createOpencodeResponsesBackend,
  OPENROUTER_HEADERS,
  resolveLlmBackendId,
  type LlmBackendId,
} from "@/lib/agent/model";
import { getActiveLlmProfileId, OPENAI_OFFICIAL_PROFILE_ID } from "@/lib/llm-profiles";
import { createRetryingModelStreamFn } from "@/lib/agent/stream-retry";
import type { ChatLlmModelInfo } from "@/lib/agent/chat-retry";

export { getRetryAfterMs, isRateLimitError } from "@/lib/agent/stream-retry";

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
  backendSession?: import("@/lib/chatgpt-plan").ChatGPTBackend;
  llmInfo?: ChatLlmModelInfo;
  pinnedLlm?: boolean;
  onModelUsed?: (llm: ChatLlmModelInfo) => void;
  getApiKey?: (provider: string) => string | undefined;
}

interface BackendStreamSource {
  models: { streamSimple: StreamFn };
  model: Model<any>;
  getApiKey: () => string | undefined;
}

/** Bind each candidate invocation to only that backend's credentials and headers. */
export function createBackendStreamFn(
  backend: BackendStreamSource,
  providerHeader: Record<string, string> = {},
): StreamFn {
  const inner = backend.models.streamSimple.bind(backend.models);
  return (model, context, options) => {
    const { apiKey: _inheritedApiKey, headers: _inheritedHeaders, ...safeOptions } = options || {};
    return inner(model, context, {
      ...safeOptions,
      apiKey: backend.getApiKey(),
      toolChoice: options?.toolChoice ?? "auto",
      headers: { ...providerHeader, ...(backend.model.headers || {}) },
    });
  };
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

let testMockStreamFn: StreamFn | null = null;
let testMockModel: Model<any> | null = null;

export function setTestMockStreamFn(fn: StreamFn | null, model?: Model<any> | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("[SECURITY] Mocking streamFn is strictly forbidden in production");
  }
  testMockStreamFn = fn;
  testMockModel = model ?? null;
}

export function getTestMockStreamFn(): StreamFn | null {
  return testMockStreamFn;
}

export async function runBabyAgent(opts: RunBabyAgentOptions): Promise<void> {
  const activeStreamFn = opts.backendSession?.streamFn ?? opts.streamFn ?? testMockStreamFn;
  const activeModel = opts.backendSession?.model ?? opts.model ?? testMockModel;

  const hasImages = Boolean(opts.images && opts.images.length > 0);
  // Resolve the active profile inside the request's profile scope. This keeps a
  // saved per-feature selection pinned even when its key is not in process.env.
  const officialProfileSelected = getActiveLlmProfileId() === OPENAI_OFFICIAL_PROFILE_ID;
  const configuredOpencode = createLlmBackend("opencode", { isVision: hasImages });
  const opencodeChat = configuredOpencode;
  const hasOpencodeApiKey = Boolean(opencodeChat.getApiKey());
  const isOpencodeZen = Boolean(opencodeChat.model.baseUrl?.includes("opencode.ai") && opencodeChat.model.id.includes("muse-spark"));
  const opencodeResponses = hasOpencodeApiKey && !hasImages && isOpencodeZen ? createOpencodeResponsesBackend() : null;
  const openrouter = createLlmBackend("openrouter", { isVision: hasImages });
  const requestedBackend = opts.backend || resolveLlmBackendId();
  const useOpencode = requestedBackend === "opencode";

  const opencodeChatFn = createBackendStreamFn(opencodeChat as any);
  const opencodeResponsesFn = opencodeResponses ? createBackendStreamFn(opencodeResponses as any) : null;
  const openrouterFn = createBackendStreamFn(openrouter, OPENROUTER_HEADERS);

  if (officialProfileSelected && useOpencode && !opencodeChat.getApiKey() && !opts.backendSession && !activeStreamFn) {
    throw new Error("OpenAI official API is not configured. Set GROWDESK_AI_API_KEY or GROWDESK_AI_API_KEY_FILE.");
  }

  const created = activeStreamFn && activeModel ? null : (useOpencode ? opencodeChat : openrouter);
  const model = activeModel ?? created!.model;

  if (opts.pinnedLlm && !opts.backendSession && !activeStreamFn && useOpencode && !opencodeChat.getApiKey()) {
    throw new Error("所选 API 配置暂不可用，请检查配置后重试。");
  }

  const primaryFn = activeStreamFn
    ? activeStreamFn
    : useOpencode ? opencodeChatFn : openrouterFn;
  const primaryModel = activeModel || (useOpencode ? opencodeChat.model : openrouter.model);
  const fallbackCandidates = activeStreamFn || opts.pinnedLlm || opts.backend || officialProfileSelected
    ? []
    : [
        ...(opencodeResponsesFn ? [{ model: opencodeResponses!.model, invoke: opencodeResponsesFn }] : []),
        ...(useOpencode || !hasOpencodeApiKey ? [] : [{ model: opencodeChat.model, invoke: opencodeChatFn }]),
        ...(useOpencode ? [{ model: openrouter.model, invoke: openrouterFn }] : []),
      ];

  const streamFn: StreamFn = createRetryingModelStreamFn(primaryFn, {
    maxRetries: 10,
    fallbacks: fallbackCandidates,
    onSuccess: (message, candidateModel) => {
      const source = opts.llmInfo?.source || (opts.backendSession ? "chatgpt" : "api");
      let endpointHost = "";
      try {
        const baseUrl = candidateModel.baseUrl;
        if (typeof baseUrl === "string") endpointHost = new URL(baseUrl).hostname;
      } catch {}
      const actualProvider = source === "chatgpt"
        ? "OpenAI/ChatGPT"
        : endpointHost || message.provider || candidateModel.provider || primaryModel.provider;
      const actualModel = message.responseModel || message.model || candidateModel.id;
      const profileId = opts.llmInfo?.profileId && (opts.pinnedLlm || opts.llmInfo.model === candidateModel.id)
        ? opts.llmInfo.profileId
        : undefined;
      opts.onModelUsed?.({
        source,
        provider: actualProvider,
        model: actualModel,
        ...(profileId ? { profileId } : {}),
      });
    },
  });
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
    getApiKey: opts.backendSession?.getApiKey ?? opts.getApiKey ?? (useOpencode ? opencodeChat.getApiKey : openrouter.getApiKey) ?? (() => undefined),
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
  // Provider stream failures are commonly reported after streamSimple returns.
  // Agent records those error frames in state; surface them so the run is failed.
  const lastAssistant = [...agent.state.messages].reverse().find((message) => message.role === "assistant");
  const streamError = agent.state.errorMessage || (
    lastAssistant?.role === "assistant" &&
    (lastAssistant.stopReason === "error" || lastAssistant.stopReason === "aborted")
      ? lastAssistant.errorMessage
      : undefined
  );
  if (streamError) {
    throw new Error(streamError.startsWith("chatgpt_") ? planErrorMessage({ code: streamError }) : streamError);
  }
}
