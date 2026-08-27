import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

export type LlmBackendId = "openrouter";

export interface LlmBackendPublic {
  id: LlmBackendId;
  label: string;
  model: string;
  available: boolean;
}

export interface LlmBackendSession {
  id: LlmBackendId;
  models: ReturnType<typeof createModels>;
  model: Model<"openai-completions">;
  getApiKey: () => string | undefined;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Fetch Headers are ByteString; non-ASCII values throw before the request is sent. */
export const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://baby.zwang.fun",
  "X-Title": "Baby Panel",
} as const;

function openrouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY || "";
}

function openrouterModelId(): string {
  return process.env.OPENROUTER_MODEL || "z-ai/glm-5.2";
}

export function listLlmBackends(): LlmBackendPublic[] {
  return [
    {
      id: "openrouter",
      label: "GLM 5.2",
      model: openrouterModelId(),
      available: Boolean(openrouterApiKey()),
    },
  ];
}

export function resolveLlmBackendId(_raw?: unknown): LlmBackendId {
  return "openrouter";
}

export function createLlmBackend(_id: LlmBackendId = "openrouter"): LlmBackendSession {
  const models = createModels();
  const model: Model<"openai-completions"> = {
    id: openrouterModelId(),
    name: openrouterModelId(),
    api: "openai-completions",
    provider: "openrouter",
    baseUrl: OPENROUTER_BASE,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 4096,
    headers: { ...OPENROUTER_HEADERS },
  };
  models.setProvider(
    createProvider({
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: OPENROUTER_BASE,
      auth: {
        apiKey: envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"]),
      },
      models: [model],
      api: openAICompletionsApi(),
    })
  );
  return {
    id: "openrouter",
    models,
    model,
    getApiKey: () => openrouterApiKey() || undefined,
  };
}
