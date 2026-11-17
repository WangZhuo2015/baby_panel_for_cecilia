import path from "node:path";
import { createModels, createProvider, envApiKeyAuth, type Model } from "@earendil-works/pi-ai";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ChatGPTPlan, chatGPTPlanModel, chatGPTPlanFetch, ChatGPTPlanError } from "./core.mjs";

export { planErrorMessage, ChatGPTPlanError } from "./core.mjs";
export type ChatGPTBackend = { model: Model<any>; streamFn: StreamFn; getApiKey: (provider?: string) => Promise<string> };
const globalPlan = globalThis as typeof globalThis & { babyChatGPTPlan?: ChatGPTPlan };
export function getChatGPTPlan(): ChatGPTPlan {
  if (process.env.CHATGPT_PLAN_ENABLED === "false") throw new ChatGPTPlanError("chatgpt_not_connected");
  if (!globalPlan.babyChatGPTPlan) globalPlan.babyChatGPTPlan = new ChatGPTPlan({
    file: process.env.CHATGPT_PLAN_FILE || path.resolve(process.cwd(), process.cwd().endsWith(path.join(".next", "standalone")) ? "../.." : ".", ".data/chatgpt-plan.json"),
    appName: "Baby Panel", port: Number(process.env.CHATGPT_CALLBACK_PORT || 14622),
  });
  return globalPlan.babyChatGPTPlan;
}

export async function createChatGPTBackend(owner: string, profileId: string, modelId: string, hasImages = false): Promise<ChatGPTBackend> {
  const plan = getChatGPTPlan();
  const catalog = await plan.models(owner, profileId);
  const selected = catalog.find(model => model.id === modelId);
  if (!selected || hasImages && !selected.input.includes("image")) throw new ChatGPTPlanError("chatgpt_model_unavailable");
  const model = chatGPTPlanModel(selected.id, selected.input);
  const models = createModels();
  models.setProvider(createProvider({ id: model.provider, name: "ChatGPT plan", baseUrl: model.baseUrl,
    auth: { apiKey: envApiKeyAuth("ChatGPT authorization", []) }, models: [model], api: openAIResponsesApi() }));
  const providerFetch = chatGPTPlanFetch(plan, owner, profileId);
  return { model, getApiKey: () => plan.access(owner, profileId),
    streamFn: (m, context, options) => models.streamSimple(m, context, { ...options, fetch: providerFetch }) };
}
