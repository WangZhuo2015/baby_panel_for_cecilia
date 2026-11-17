import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createBackendStreamFn } from "../../lib/agent/run";
import { createRetryingModelStreamFn } from "../../lib/agent/stream-retry";

const primaryModel: Model<"openai-completions"> = {
  id: "test_primary_model",
  name: "test_primary_model",
  api: "openai-completions",
  provider: "test_primary_provider",
  baseUrl: "https://primary-provider.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
  headers: { Authorization: "Bearer test_primary_header", "X-Source": "primary" },
};
const fallbackModel: Model<"openai-completions"> = {
  ...primaryModel,
  id: "test_fallback_model",
  name: "test_fallback_model",
  provider: "test_fallback_provider",
  baseUrl: "https://fallback-provider.invalid/v1",
  headers: { Authorization: "Bearer test_fallback_header", "X-Source": "fallback" },
};

function assistant(model: Model<any>, text: string, stopReason: "stop" | "error"): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: { input: 1, output: text.length, cacheRead: 0, cacheWrite: 0, totalTokens: 1 + text.length, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    ...(stopReason === "error" ? { errorMessage: "503 Service Unavailable" } : {}),
    timestamp: 1,
  };
}

function providerStream(model: Model<any>, shouldFail: boolean): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = assistant(model, shouldFail ? "test partial" : "test fallback success", shouldFail ? "error" : "stop");
  if (shouldFail) stream.push({ type: "error", reason: "error", error: message });
  else stream.push({ type: "done", reason: "stop", message });
  return stream;
}

function fakeBackend(model: Model<any>, key: string, shouldFail: boolean, seen: Array<{ model: string; key?: string; headers?: Record<string, string> }>) {
  const streamSimple = ((actualModel: Model<any>, _context: Context, options?: SimpleStreamOptions) => {
    seen.push({ model: actualModel.id, key: options?.apiKey, headers: options?.headers as Record<string, string> });
    return providerStream(actualModel, shouldFail);
  }) as StreamFn;
  return { model, getApiKey: () => key, models: { streamSimple } };
}

test("fallback candidate streams use their own API key and headers, never inherited credentials", async () => {
  const seen: Array<{ model: string; key?: string; headers?: Record<string, string> }> = [];
  const primary = createBackendStreamFn(fakeBackend(primaryModel, "test_primary_key", true, seen));
  const fallback = createBackendStreamFn(fakeBackend(fallbackModel, "test_fallback_key", false, seen));
  const retrying = createRetryingModelStreamFn(primary, {
    maxRetries: 0,
    fallbacks: [{ model: fallbackModel, invoke: fallback }],
  });

  const output = await retrying(primaryModel, { messages: [] } as Context, {
    apiKey: "test_inherited_secret",
    headers: { Authorization: "Bearer test_inherited_secret", "X-Inherited": "test_bad" },
  });
  const final = await output.result();

  assert.equal(final.stopReason, "stop");
  assert.deepEqual(seen.map((call) => [call.model, call.key]), [
    ["test_primary_model", "test_primary_key"],
    ["test_fallback_model", "test_fallback_key"],
  ]);
  assert.deepEqual(seen[0].headers, primaryModel.headers);
  assert.deepEqual(seen[1].headers, fallbackModel.headers);
  assert.equal(JSON.stringify(seen).includes("test_inherited_secret"), false);
});
