import {
  ChatGPTPlanError,
  chatGPTPlanFetch,
  chatGPTPlanModel,
  planResponseError,
  type ChatGPTPlan,
} from "./core.mjs";
import { getChatGPTPlan } from "./index";

export interface ChatGPTTaskScope {
  owner: string;
  selection: {
    source: "chatgpt";
    profileId: string;
    modelId: string;
  };
}

export interface ChatGPTTaskAdapterOptions {
  getPlan?: () => ChatGPTPlan;
  fetcher?: typeof fetch;
}

function unavailable(): ChatGPTPlanError {
  return new ChatGPTPlanError("chatgpt_unavailable");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbortSignal(signal: AbortSignal | null | undefined): signal is AbortSignal {
  return Boolean(signal && typeof signal.aborted === "boolean");
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (!isAbortSignal(signal) || !signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}

function normalizeImageUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 28_000_000) throw unavailable();
  if (/^data:image\/gif;base64,/i.test(value)) throw unavailable();
  if (/^data:image\/(?:jpeg|jpg|png|webp|heic|heif);base64,/i.test(value)) {
    return value.replace(/^data:image\/jpg;/i, "data:image/jpeg;");
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
  } catch {
    // Invalid URLs are rejected below.
  }
  throw unavailable();
}

function toResponsesInput(messages: unknown): { input: Array<Record<string, unknown>>; hasImages: boolean } {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 128) throw unavailable();
  const input: Array<Record<string, unknown>> = [];
  let hasImages = false;

  for (const raw of messages) {
    if (!isRecord(raw) || typeof raw.role !== "string") throw unavailable();
    const role = raw.role;
    // Existing raw feature tasks send only system/developer instructions and user content.
    // Reject assistant history until its distinct Responses output_text input contract is mapped.
    if (role !== "system" && role !== "developer" && role !== "user") throw unavailable();

    const parts: Array<Record<string, unknown>> = [];
    if (typeof raw.content === "string") {
      parts.push({ type: "input_text", text: raw.content });
    } else if (Array.isArray(raw.content)) {
      for (const rawPart of raw.content) {
        if (!isRecord(rawPart)) throw unavailable();
        if (rawPart.type === "text" && typeof rawPart.text === "string") {
          parts.push({ type: "input_text", text: rawPart.text });
          continue;
        }
        if (rawPart.type === "image_url") {
          const image = typeof rawPart.image_url === "string"
            ? rawPart.image_url
            : isRecord(rawPart.image_url) ? rawPart.image_url.url : undefined;
          parts.push({ type: "input_image", image_url: normalizeImageUrl(image) });
          hasImages = true;
          continue;
        }
        throw unavailable();
      }
    } else {
      throw unavailable();
    }

    if (parts.length === 0) throw unavailable();
    input.push({ role, content: parts });
  }

  return { input, hasImages };
}

function toResponsesPayload(body: Record<string, unknown>, modelId: string): {
  payload: Record<string, unknown>;
  hasImages: boolean;
} {
  const converted = toResponsesInput(body.messages);
  const payload: Record<string, unknown> = {
    model: modelId,
    input: converted.input,
  };

  if (body.response_format !== undefined) {
    const responseFormat = body.response_format;
    if (!isRecord(responseFormat)) throw unavailable();
    if (responseFormat.type === "json_object") {
      payload.text = { format: { type: "json_object" } };
    } else if (responseFormat.type !== "text") {
      throw unavailable();
    }
  }

  return { payload, hasImages: converted.hasImages };
}

function parseSseFrame(frame: string): unknown | undefined {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    throw unavailable();
  }
}

async function readCompletedResponse(response: Response, signal: AbortSignal | null | undefined): Promise<Record<string, unknown>> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: Record<string, unknown> | undefined;

  const handleFrame = (frame: string) => {
    const event = parseSseFrame(frame);
    if (!isRecord(event)) return;
    if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
      throw new ChatGPTPlanError(planResponseError(0, event.response || event));
    }
    if (event.type === "response.completed") {
      if (completed || !isRecord(event.response) ||
          event.response.status !== undefined && event.response.status !== "completed") {
        throw unavailable();
      }
      completed = event.response;
    } else if (completed) {
      throw unavailable();
    }
  };

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (buffer.length > 1_048_576) throw unavailable();
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleFrame(buffer);
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  throwIfAborted(signal);
  if (!completed) throw unavailable();
  return completed;
}

function responseText(response: Record<string, unknown>): string {
  if (response.status !== undefined && response.status !== "completed") throw unavailable();
  if (Array.isArray(response.output)) {
    const text: string[] = [];
    for (const item of response.output) {
      if (!isRecord(item)) throw unavailable();
      // Reasoning is metadata; any tool call, refusal, image, or other output type
      // means this feature has not received a plain text task result.
      if (item.type === "reasoning") continue;
      if (item.type !== "message" || item.role !== undefined && item.role !== "assistant" ||
          !Array.isArray(item.content) || item.content.length === 0) {
        throw unavailable();
      }
      for (const part of item.content) {
        if (!isRecord(part) || part.type !== "output_text" || typeof part.text !== "string") throw unavailable();
        text.push(part.text);
      }
    }
    const output = text.join("");
    if (output) return output;
  }
  if (typeof response.output_text === "string") return response.output_text;
  return "";
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function toChatCompletion(response: Record<string, unknown>, selectedModel: string): Response {
  const content = responseText(response);
  if (!content.trim()) throw unavailable();

  const usage = isRecord(response.usage) ? response.usage : undefined;
  const promptTokens = safeTokenCount(usage?.input_tokens);
  const completionTokens = safeTokenCount(usage?.output_tokens);
  const model = typeof response.model === "string" && response.model.trim()
    ? response.model
    : selectedModel;
  const body = {
    id: typeof response.id === "string" ? response.id : undefined,
    object: "chat.completion",
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    ...(promptTokens !== undefined || completionTokens !== undefined
      ? { usage: {
          ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
          ...(completionTokens !== undefined ? { completion_tokens: completionTokens } : {}),
          ...(promptTokens !== undefined && completionTokens !== undefined
            ? { total_tokens: promptTokens + completionTokens }
            : {}),
        } }
      : {}),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Convert one trusted feature request to Responses API without carrying API-profile headers. */
export function createChatGPTTaskAdapter(options: ChatGPTTaskAdapterOptions = {}) {
  const getPlan = options.getPlan || getChatGPTPlan;
  const providerFetch = options.fetcher || ((input, init) => fetch(input, init));

  return async function chatGPTPlanTaskFetch(
    _input: string | URL,
    init: RequestInit,
    scope: ChatGPTTaskScope,
  ): Promise<Response> {
    if (!scope?.owner || scope.selection?.source !== "chatgpt" ||
        !scope.selection.profileId || !scope.selection.modelId ||
        (init.method || "GET").toUpperCase() !== "POST" ||
        typeof init.body !== "string") {
      throw unavailable();
    }
    throwIfAborted(init.signal);

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(init.body);
    } catch {
      throw unavailable();
    }
    if (!isRecord(requestBody)) throw unavailable();

    const { payload, hasImages } = toResponsesPayload(requestBody, scope.selection.modelId);
    const plan = getPlan();
    const models = await plan.models(scope.owner, scope.selection.profileId);
    const model = models.find((entry) => entry.id === scope.selection.modelId);
    if (!model || !Array.isArray(model.input) || !model.input.includes("text") ||
        hasImages && !model.input.includes("image")) {
      throw new ChatGPTPlanError("chatgpt_model_unavailable");
    }

    const fetcher = chatGPTPlanFetch(plan, scope.owner, scope.selection.profileId, {
      fetcher: providerFetch,
    });
    const responsesModel = chatGPTPlanModel(scope.selection.modelId);
    const upstream = await fetcher(responsesModel.baseUrl + "/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
      signal: init.signal,
      redirect: "error",
    });

    if (!upstream.ok) return upstream;
    const completed = await readCompletedResponse(upstream, init.signal);
    return toChatCompletion(completed, scope.selection.modelId);
  };
}

export const chatGPTPlanTaskFetch = createChatGPTTaskAdapter();
