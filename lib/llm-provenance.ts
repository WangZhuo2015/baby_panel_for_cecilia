import { AsyncLocalStorage } from "node:async_hooks";
import type { LlmModelInfo } from "@/lib/llm-preferences";
import { getCurrentLlmFeatureScope, getCurrentLlmModelInfo } from "@/lib/llm-context";
import {
  getActiveLlmProfile,
  getActiveLlmProfileId,
  getLlmProfileScope,
  OPENAI_OFFICIAL_PROFILE_ID,
} from "@/lib/llm-profiles";
import { chatGPTPlanTaskFetch } from "@/lib/chatgpt-plan/task-adapter";

const executions = new AsyncLocalStorage<{ llm: LlmModelInfo | null }>();
export function withLlmProvenance<T>(work: () => T): T {
  return executions.run({ llm: null }, work);
}
export function recordLlmModel(info: LlmModelInfo | null): void {
  const execution = executions.getStore();
  if (execution) execution.llm = info;
}
export function actualLlmModel(): LlmModelInfo | null {
  return executions.getStore()?.llm ?? null;
}

function normalizeOfficialChatRequest(input: string | URL, init: RequestInit): RequestInit {
  if (getActiveLlmProfileId() !== OPENAI_OFFICIAL_PROFILE_ID || typeof init.body !== "string") return init;
  let url: URL;
  let body: unknown;
  try {
    url = new URL(input);
    if (url.hostname.toLowerCase() !== "api.openai.com" || !url.pathname.endsWith("/chat/completions")) return init;
    body = JSON.parse(init.body);
  } catch {
    return init;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return init;
  const payload = { ...(body as Record<string, unknown>) };
  const scope = getLlmProfileScope();
  const profile = getActiveLlmProfile();
  payload.model = scope?.modelId || profile.model || "gpt-6-luna";
  if (payload.max_completion_tokens === undefined && typeof payload.max_tokens === "number") {
    payload.max_completion_tokens = payload.max_tokens;
  }
  delete payload.max_tokens;
  // GPT-6 reasoning models use their default sampling settings.
  delete payload.temperature;
  return { ...init, body: JSON.stringify(payload) };
}

/** Record the model sent, then prefer the provider's actual model identifier. */
export async function llmFetch(input: string | URL, init: RequestInit): Promise<Response> {
  const scope = getCurrentLlmFeatureScope();
  const selected = getCurrentLlmModelInfo();
  if (scope?.selection?.source === "chatgpt") {
    const info: LlmModelInfo = {
      ...selected,
      source: "chatgpt",
      provider: "openai",
      model: scope.selection.modelId,
      profileId: scope.selection.profileId,
    };
    recordLlmModel(info);
    const response = await chatGPTPlanTaskFetch(input, init, {
      owner: scope.owner,
      selection: {
        source: "chatgpt",
        profileId: scope.selection.profileId,
        modelId: scope.selection.modelId,
      },
    });
    if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
      const payload: unknown = await response.clone().json().catch(() => null);
      if (payload && typeof payload === "object" && "model" in payload && typeof payload.model === "string" && payload.model.trim()) {
        recordLlmModel({ ...info, model: payload.model });
      }
    }
    return response;
  }

  let model = "";
  try {
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (body && typeof body === "object" && "model" in body && typeof body.model === "string") model = body.model;
  } catch { /* The upstream handler remains responsible for its request body. */ }
  const info: LlmModelInfo = {
    ...selected, source: "api", provider: new URL(input).hostname, model: model || selected?.model || "unknown",
  };
  recordLlmModel(info);
  const response = await fetch(input, normalizeOfficialChatRequest(input, init));
  if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
    // Do not consume or replace the response that the feature parser receives.
    const payload: unknown = await response.clone().json().catch(() => null);
    if (payload && typeof payload === "object" && "model" in payload && typeof payload.model === "string" && payload.model.trim()) {
      recordLlmModel({ ...info, model: payload.model });
    }
  }
  return response;
}
