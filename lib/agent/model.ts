import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";

export type LlmBackendId = "openrouter" | "opencode";

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
const OPENCODE_BASE = "https://opencode.ai/zen/go/v1";

/** Fetch Headers are ByteString; non-ASCII values throw before the request is sent. */
export const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://baby.zwang.fun",
  "X-Title": "Baby Panel",
} as const;

function openrouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY || "";
}

function openrouterModelId(): string {
  return process.env.OPENROUTER_MODEL || "opencode-go/muse-spark-1.2-contributor";
}

function opencodeBaseUrl(): string {
  return process.env.AI_BASE_URL || OPENCODE_BASE;
}

function opencodeApiKey(): string {
  return process.env.AI_API_KEY || "";
}

function opencodeModelId(): string {
  return process.env.AI_MODEL || "muse-spark-1.2-contributor";
}

function opencodeVisionModelId(): string {
  const v = process.env.AI_VISION_MODEL;
  if (v && v !== "hermes-agent") return v;
  return "deepseek-v4-flash-vision-exp";
}

export function listLlmBackends(): LlmBackendPublic[] {
  return [
    {
      id: "opencode",
      label: "Opencode Muse Spark",
      model: opencodeModelId(),
      available: Boolean(opencodeApiKey()),
    },
    {
      id: "openrouter",
      label: "OpenRouter Muse Spark",
      model: openrouterModelId(),
      available: Boolean(openrouterApiKey()),
    },
  ];
}

export function resolveLlmBackendId(_raw?: unknown): LlmBackendId {
  if (opencodeApiKey()) return "opencode";
  return "openrouter";
}

export function createLlmBackend(
  _id: LlmBackendId = "openrouter",
  options?: { isVision?: boolean }
): LlmBackendSession {
  const isVision = Boolean(options?.isVision);

  // Opencode provider (primary)
  if (_id === "opencode" || (opencodeApiKey() && _id !== "openrouter")) {
    const models = createModels();
    const modelId = isVision ? opencodeVisionModelId() : opencodeModelId();
    const usesResponsesApi = modelId.includes("muse-spark") && !isVision;

    if (usesResponsesApi) {
      const model: Model<"openai-responses"> = {
        id: modelId,
        name: modelId,
        api: "openai-responses",
        provider: "opencode",
        baseUrl: opencodeBaseUrl(),
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1_048_576,
        maxTokens: 4096,
        headers: {},
      };
      models.setProvider(
        createProvider({
          id: "opencode",
          name: "Opencode",
          baseUrl: opencodeBaseUrl(),
          auth: {
            apiKey: envApiKeyAuth("Opencode API key", ["AI_API_KEY"]),
          },
          models: [model as unknown as Model<"openai-completions">],
          api: openAIResponsesApi(),
        })
      );
      return {
        id: "opencode",
        models,
        model: model as unknown as Model<"openai-completions">,
        getApiKey: () => opencodeApiKey() || undefined,
      };
    }

    const model: Model<"openai-completions"> = {
      id: modelId,
      name: modelId,
      api: "openai-completions",
      provider: "opencode",
      baseUrl: opencodeBaseUrl(),
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_050_000,
      maxTokens: 4096,
      headers: {},
    };
    models.setProvider(
      createProvider({
        id: "opencode",
        name: "Opencode",
        baseUrl: opencodeBaseUrl(),
        auth: {
          apiKey: envApiKeyAuth("Opencode API key", ["AI_API_KEY"]),
        },
        models: [model],
        api: openAICompletionsApi(),
      })
    );
    return {
      id: "opencode",
      models,
      model,
      getApiKey: () => opencodeApiKey() || undefined,
    };
  }

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

export function createOpencodeResponsesBackend(): LlmBackendSession {
  const models = createModels();
  const model: Model<"openai-responses"> = {
    id: opencodeModelId(),
    name: opencodeModelId(),
    api: "openai-responses",
    provider: "opencode",
    baseUrl: opencodeBaseUrl(),
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_048_576,
    maxTokens: 4096,
    headers: {},
  };
  models.setProvider(
    createProvider({
      id: "opencode",
      name: "Opencode",
      baseUrl: opencodeBaseUrl(),
      auth: {
        apiKey: envApiKeyAuth("Opencode API key", ["AI_API_KEY"]),
      },
      models: [model],
      api: openAIResponsesApi(),
    })
  );
  return {
    id: "opencode",
    models,
    model: model as unknown as Model<"openai-completions">,
    getApiKey: () => opencodeApiKey() || undefined,
  };
}
