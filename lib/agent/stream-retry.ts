import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";

type ModelStreamCall = (
  model: Model<any>,
  context: Context,
  options?: SimpleStreamOptions,
) => ReturnType<StreamFn>;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "errorMessage" in error) {
    return String((error as { errorMessage?: unknown }).errorMessage || "");
  }
  return String(error || "Unknown provider error");
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = value.status ?? value.statusCode ?? value.response?.status;
  return typeof status === "number" ? status : undefined;
}

export function getRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = error as { headers?: Headers | Record<string, unknown>; response?: { headers?: Headers | Record<string, unknown> } };
  const headers = value.headers ?? value.response?.headers;
  let raw: unknown;
  if (headers && typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("retry-after");
  } else if (headers && typeof headers === "object") {
    const entries = headers as Record<string, unknown>;
    raw = entries["retry-after"] ?? entries["Retry-After"];
  }
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/** Compatibility helper retained for callers that specifically classify 429s. */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
    errorMessage?: unknown;
    cause?: unknown;
    response?: { status?: unknown };
  };
  if (value.status === 429 || value.statusCode === 429 || value.response?.status === 429) return true;
  const message = [value.message, value.errorMessage]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (/\b429\b|rate limit|too many requests/i.test(message)) return true;
  if (value.cause && typeof value.cause === "object") {
    const cause = value.cause as { status?: unknown; statusCode?: unknown; message?: unknown };
    if (cause.status === 429 || cause.statusCode === 429) return true;
    return typeof cause.message === "string" && /\b429\b|rate limit|too many requests/i.test(cause.message);
  }
  return false;
}

function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export function isRetryableModelStageError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (status !== undefined && status >= 500 && status <= 599)) return true;
  const message = errorText(error).toLowerCase();
  return /(?:econnreset|econnrefused|etimedout|eai_again|und_err_connect_timeout|socket hang up|network error|fetch failed|temporar(?:y|ily) unavailable|gateway timeout|service unavailable|rate limit|too many requests|\b429\b)/i.test(message);
}

function failureMessage(model: Model<any>, error: unknown): AssistantMessage {
  const text = errorText(error) || "模型请求未完成";
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: text,
    timestamp: Date.now(),
  };
}

/**
 * Retry a single model stage before exposing any of its events to Agent. This
 * means partial text/tool-call deltas from a broken lazy stream are discarded;
 * previously completed tool results stay in `context.messages` and are reused.
 */
export function createRetryingModelStreamFn(
  invoke: ModelStreamCall,
  options: {
    maxRetries?: number;
    fallbacks?: Array<{ model: Model<any>; invoke: ModelStreamCall }>;
    onSuccess?: (message: AssistantMessage, model: Model<any>) => void;
    wait?: (ms: number) => Promise<void>;
  } = {},
): StreamFn {
  const maxRetries = Math.max(0, Math.min(10, options.maxRetries ?? 1));

  return (model, context, callOptions) => {
    const output = createAssistantMessageEventStream();
    void (async () => {
      let lastError: unknown = new Error("模型请求未完成");
      let lastModel = model;

      const candidates = [
        { model, invoke },
        ...(options.fallbacks || []),
      ];
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const candidate = candidates[candidateIndex];
        lastModel = candidate.model;
        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          let events: AssistantMessageEvent[] = [];
          try {
            const source = await candidate.invoke(candidate.model, context, callOptions);
            let finalMessage: AssistantMessage | undefined;

            for await (const event of source) {
              events.push(event);
              if (event.type === "done") finalMessage = event.message;
              if (event.type === "error") finalMessage = event.error;
            }

            if (!finalMessage) {
              finalMessage = await source.result().catch((error: unknown) => {
                lastError = error;
                return undefined;
              });
            }
            if (!finalMessage) throw lastError;

            if (finalMessage.stopReason === "error" || finalMessage.stopReason === "aborted") {
              lastError = finalMessage.errorMessage || finalMessage;
              if (
                finalMessage.stopReason === "error" &&
                attempt < maxRetries &&
                isRetryableModelStageError(lastError)
              ) {
                const retryAfter = getRetryAfterMs(lastError);
                if (retryAfter !== null && retryAfter > 30_000) {
                  output.end(finalMessage);
                  return;
                }
                await (options.wait || wait)(retryAfter ?? Math.min(250 * (2 ** attempt), 2_000));
                continue;
              }
              if (
                candidateIndex < candidates.length - 1 &&
                finalMessage.stopReason === "error" &&
                isRetryableModelStageError(lastError)
              ) break;
              for (const event of events) output.push(event);
              output.end(finalMessage);
              return;
            }

            for (const event of events) output.push(event);
            output.end(finalMessage);
            try {
              options.onSuccess?.(finalMessage, candidate.model);
            } catch {
              // Attribution callbacks must not change whether a provider response succeeds.
            }
            return;
          } catch (error) {
            lastError = error;
            if (attempt < maxRetries && isRetryableModelStageError(error)) {
              const retryAfter = getRetryAfterMs(error);
              if (retryAfter !== null && retryAfter <= 30_000) {
                await (options.wait || wait)(retryAfter);
                continue;
              }
              if (retryAfter === null) {
                await (options.wait || wait)(Math.min(250 * (2 ** attempt), 2_000));
                continue;
              }
            }
            if (candidateIndex < candidates.length - 1 && isRetryableModelStageError(error)) break;
            const failed = failureMessage(candidate.model, lastError);
            output.push({ type: "error", reason: "error", error: failed });
            output.end(failed);
            return;
          }
        }
      }

      const failed = failureMessage(lastModel, lastError);
      output.push({ type: "error", reason: "error", error: failed });
      output.end(failed);
    })();

    return output;
  };
}
