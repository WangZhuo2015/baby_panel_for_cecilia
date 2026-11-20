import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import type { ChatGPTPlan } from "../../lib/chatgpt-plan/core.mjs";
import { ChatGPTPlanError } from "../../lib/chatgpt-plan/core.mjs";
import { createChatGPTTaskAdapter, type ChatGPTTaskScope } from "../../lib/chatgpt-plan/task-adapter";
import * as featureModelRules from "../../lib/llm-feature-model";

const require = createRequire(import.meta.url);
const encoder = new TextEncoder();

function sse(...events: unknown[]): Response {
  const body = events.map((event) => {
    const type = (event as { type?: string }).type || "message";
    return "event: " + type + "\ndata: " + JSON.stringify(event) + "\n\n";
  }).join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

function completedResponse(text: string, model = "test_gpt_actual") {
  return {
    type: "response.completed",
    response: {
      id: "resp_test",
      status: "completed",
      model,
      output_text: text,
      usage: { input_tokens: 11, output_tokens: 7 },
    },
  };
}

function taskScope(owner: string, profileId: string, modelId: string): ChatGPTTaskScope {
  return { owner, selection: { source: "chatgpt", profileId, modelId } };
}

function requestBody(messages: unknown[], extras: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: "test_untrusted_api_model",
    messages,
    ...extras,
  });
}

function fakePlan(
  catalogs: Record<string, Array<{ id: string; input?: string[] }>>,
  tokens: Record<string, string>,
  calls: { models: Array<[string, string]>; access: Array<[string, string]> },
): ChatGPTPlan {
  const plan = {
    async models(owner: string, profileId: string) {
      calls.models.push([owner, profileId]);
      return catalogs[owner + ":" + profileId] || [];
    },
    async access(owner: string, profileId: string) {
      calls.access.push([owner, profileId]);
      const token = tokens[owner + ":" + profileId];
      if (!token) throw new ChatGPTPlanError("chatgpt_not_connected");
      return token;
    },
  };
  return plan as unknown as ChatGPTPlan;
}

test("uses owner-scoped ChatGPT models for text and JSON image tasks without API-profile headers", async () => {
  const calls = { models: [] as Array<[string, string]>, access: [] as Array<[string, string]> };
  const catalogs = {
    "test_user_alpha:test_profile_alpha": [{ id: "test_gpt_alpha", input: ["text", "image"] }],
    "test_user_beta:test_profile_beta": [{ id: "test_gpt_beta", input: ["text", "image"] }],
  };
  const plan = fakePlan(catalogs, {
    "test_user_alpha:test_profile_alpha": "test_plan_token_alpha",
    "test_user_beta:test_profile_beta": "test_plan_token_beta",
  }, calls);
  const providerCalls: Array<{ ownerToken: string | null; payload: Record<string, any>; headers: Headers }> = [];
  const adapter = createChatGPTTaskAdapter({
    getPlan: () => plan,
    fetcher: async (input, init) => {
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      const headers = new Headers(init?.headers);
      const payload = JSON.parse(String(init?.body)) as Record<string, any>;
      providerCalls.push({ ownerToken: headers.get("authorization"), payload, headers });
      return sse(completedResponse(payload.model === "test_gpt_alpha" ? '{"result":"alpha"}' : '{"result":"beta"}'));
    },
  });

  const apiHeaders = {
    Authorization: "Bearer test_fake_api_profile_key",
    "X-API-Key": "test_fake_api_profile_key",
    "X-Profile-Secret": "test_fake_profile_secret",
  };
  const alpha = await adapter("https://ignored.invalid/chat/completions", {
    method: "POST",
    headers: apiHeaders,
    body: requestBody([
      { role: "system", content: "Return JSON." },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this test label." },
          { type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } },
        ],
      },
    ], { response_format: { type: "json_object" } }),
  }, taskScope("test_user_alpha", "test_profile_alpha", "test_gpt_alpha"));

  const beta = await adapter("https://ignored.invalid/chat/completions", {
    method: "POST",
    headers: apiHeaders,
    body: requestBody([{ role: "user", content: "Reply with one sentence." }]),
  }, taskScope("test_user_beta", "test_profile_beta", "test_gpt_beta"));

  assert.equal(alpha.status, 200);
  assert.equal(beta.status, 200);
  const alphaResult = await alpha.json();
  const betaResult = await beta.json();
  assert.equal(alphaResult.choices[0].message.content, '{"result":"alpha"}');
  assert.equal(betaResult.choices[0].message.content, '{"result":"beta"}');
  assert.equal(alphaResult.model, "test_gpt_actual");
  assert.equal(alphaResult.usage.total_tokens, 18);

  assert.deepEqual(calls.models, [
    ["test_user_alpha", "test_profile_alpha"],
    ["test_user_beta", "test_profile_beta"],
  ]);
  assert.deepEqual(calls.access, [
    ["test_user_alpha", "test_profile_alpha"],
    ["test_user_beta", "test_profile_beta"],
  ]);
  assert.equal(providerCalls[0].ownerToken, "Bearer test_plan_token_alpha");
  assert.equal(providerCalls[1].ownerToken, "Bearer test_plan_token_beta");
  assert.equal(providerCalls[0].payload.model, "test_gpt_alpha");
  assert.equal(providerCalls[1].payload.model, "test_gpt_beta");
  assert.equal(providerCalls[0].payload.store, false);
  assert.equal(providerCalls[0].payload.stream, true);
  assert.deepEqual(providerCalls[0].payload.text, { format: { type: "json_object" } });
  assert.equal(providerCalls[0].payload.response_format, undefined);
  assert.equal(providerCalls[0].payload.input[0].role, "developer");
  assert.equal(providerCalls[0].payload.input[0].content[0].type, "input_text");
  assert.equal(providerCalls[0].payload.input[1].content[1].type, "input_image");
  assert.equal(providerCalls[0].payload.input[1].content[1].image_url, "data:image/png;base64,dGVzdA==");
  assert.equal(providerCalls[1].payload.input[0].content[0].type, "input_text");
  assert.equal(providerCalls[0].headers.get("x-api-key"), null);
  assert.equal(providerCalls[0].headers.get("x-profile-secret"), null);
  assert.equal(JSON.stringify(providerCalls).includes("test_fake_api_profile_key"), false);
});

test("rejects unsupported GIF data URLs and image requests for text-only selected models", async () => {
  const calls = { models: [] as Array<[string, string]>, access: [] as Array<[string, string]> };
  const plan = fakePlan({
    "test_user_gif:test_profile_gif": [{ id: "test_gpt_gif", input: ["text", "image"] }],
    "test_user_text:test_profile_text": [{ id: "test_gpt_text", input: ["text"] }],
  }, {
    "test_user_gif:test_profile_gif": "test_plan_token_gif",
    "test_user_text:test_profile_text": "test_plan_token_text",
  }, calls);
  let providerCalls = 0;
  const adapter = createChatGPTTaskAdapter({
    getPlan: () => plan,
    fetcher: async () => {
      providerCalls += 1;
      return sse(completedResponse("test gif result"));
    },
  });

  await assert.rejects(adapter("https://ignored.invalid/chat/completions", {
    method: "POST",
    body: requestBody([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" } }] }]),
  }, taskScope("test_user_gif", "test_profile_gif", "test_gpt_gif")));

  await assert.rejects(adapter("https://ignored.invalid/chat/completions", {
    method: "POST",
    body: requestBody([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,dGVzdA==" } }] }]),
  }, taskScope("test_user_text", "test_profile_text", "test_gpt_text")), (error: unknown) => {
    return error instanceof ChatGPTPlanError && error.code === "chatgpt_model_unavailable";
  });
  assert.equal(providerCalls, 0);
});

test("rejects invalid, failed, incomplete, truncated, refused, and tool-call responses", async (t) => {
  const cases: Array<[string, (payload: Record<string, any>) => Response]> = [
    ["malformed event", () => new Response("data: {invalid}\n\n", { headers: { "Content-Type": "text/event-stream" } })],
    ["missing completed terminal", () => sse({ type: "response.output_text.delta", delta: "partial" })],
    ["incomplete terminal", () => sse({ type: "response.incomplete", response: { status: "incomplete" } })],
    ["failed terminal", () => sse({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } })],
    ["completed event with incomplete status", () => sse({
      type: "response.completed",
      response: { status: "incomplete", output_text: "partial" },
    })],
    ["refusal output", () => sse({
      type: "response.completed",
      response: { status: "completed", output_text: "do not accept", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "test refusal" }] }] },
    })],
    ["tool call mixed with text", () => sse({
      type: "response.completed",
      response: { status: "completed", output_text: "partial", output: [{ type: "function_call", name: "test_tool" }] },
    })],
  ];

  for (const [name, responseFor] of cases) {
    await t.test(name, async () => {
      const calls = { models: [] as Array<[string, string]>, access: [] as Array<[string, string]> };
      const plan = fakePlan({
        "test_user_terminal:test_profile_terminal": [{ id: "test_gpt_terminal", input: ["text", "image"] }],
      }, {
        "test_user_terminal:test_profile_terminal": "test_plan_token_terminal",
      }, calls);
      const adapter = createChatGPTTaskAdapter({ getPlan: () => plan, fetcher: async () => responseFor({}) });
      await assert.rejects(adapter("https://ignored.invalid/chat/completions", {
        method: "POST",
        body: requestBody([{ role: "user", content: "Return a test answer." }]),
      }, taskScope("test_user_terminal", "test_profile_terminal", "test_gpt_terminal")));
    });
  }
});

test("aborting a ChatGPT task rejects and a non-200 response is returned without API fallback", async (t) => {
  await t.test("abort", async () => {
    const calls = { models: [] as Array<[string, string]>, access: [] as Array<[string, string]> };
    const plan = fakePlan({
      "test_user_abort:test_profile_abort": [{ id: "test_gpt_abort", input: ["text"] }],
    }, {
      "test_user_abort:test_profile_abort": "test_plan_token_abort",
    }, calls);
    const controller = new AbortController();
    const adapter = createChatGPTTaskAdapter({
      getPlan: () => plan,
      fetcher: async (_input, init) => new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n'));
          init?.signal?.addEventListener("abort", () => {
            try { stream.error(init.signal?.reason || new DOMException("The operation was aborted", "AbortError")); } catch {}
          }, { once: true });
        },
      }), { headers: { "Content-Type": "text/event-stream" } }),
    });
    const pending = adapter("https://ignored.invalid/chat/completions", {
      method: "POST",
      body: requestBody([{ role: "user", content: "Return a test answer." }]),
      signal: controller.signal,
    }, taskScope("test_user_abort", "test_profile_abort", "test_gpt_abort"));
    setTimeout(() => controller.abort(new DOMException("The operation was aborted", "AbortError")), 10);
    await assert.rejects(pending, (error: unknown) => (error as Error)?.name === "AbortError");
  });

  await t.test("non-200", async () => {
    const calls = { models: [] as Array<[string, string]>, access: [] as Array<[string, string]> };
    const plan = fakePlan({
      "test_user_limit:test_profile_limit": [{ id: "test_gpt_limit", input: ["text"] }],
    }, {
      "test_user_limit:test_profile_limit": "test_plan_token_limit",
    }, calls);
    let providerCalls = 0;
    const adapter = createChatGPTTaskAdapter({
      getPlan: () => plan,
      fetcher: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify({ error: { code: "subscription_sharing_usage_limit_exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    const response = await adapter("https://ignored.invalid/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test_fake_api_key" },
      body: requestBody([{ role: "user", content: "Return a test answer." }]),
    }, taskScope("test_user_limit", "test_profile_limit", "test_gpt_limit"));
    assert.equal(response.status, 429);
    assert.equal(providerCalls, 1);
    assert.equal((await response.json()).error.code, "chatgpt_usage_limit");
  });
});

test("llmFetch routes trusted ChatGPT scopes and keeps ChatGPT provenance", async () => {
  const scope = taskScope("test_user_provenance", "test_profile_provenance", "test_gpt_selected");
  const adapterCalls: Array<{ input: string | URL; owner: string; model: string }> = [];
  const source = readFileSync(new URL("../../lib/llm-provenance.ts", import.meta.url), "utf8");
  const module = { exports: {} as Record<string, Function> };
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    Response,
    fetch,
    require: (id: string) => {
      if (id === "@/lib/llm-context") {
        return {
          getCurrentLlmFeatureScope: () => scope,
          getCurrentLlmModelInfo: () => ({
            source: "chatgpt",
            provider: "openai",
            model: scope.selection.modelId,
            profileId: scope.selection.profileId,
          }),
        };
      }
      if (id === "@/lib/chatgpt-plan/task-adapter") {
        return {
          chatGPTPlanTaskFetch: async (input: string | URL, _init: RequestInit, trustedScope: ChatGPTTaskScope) => {
            adapterCalls.push({ input, owner: trustedScope.owner, model: trustedScope.selection.modelId });
            return new Response(JSON.stringify({
              model: "test_gpt_actual",
              choices: [{ message: { content: "test result" } }],
            }), { headers: { "Content-Type": "application/json" } });
          },
        };
      }
      if (id === "@/lib/llm-profiles") return {};
      if (id.startsWith("node:")) return require(id);
      throw new Error("Unexpected dependency: " + id);
    },
  });

  const api = module.exports as {
    llmFetch: (input: string | URL, init: RequestInit) => Promise<Response>;
    actualLlmModel: () => { source: string; provider: string; model: string; profileId?: string } | null;
    withLlmProvenance: (work: () => Promise<unknown>) => Promise<unknown>;
  };
  await api.withLlmProvenance(async () => {
    const response = await api.llmFetch("https://ignored.invalid/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test_api_profile_key" },
      body: requestBody([{ role: "user", content: "Return test text." }]),
    });
    assert.equal((await response.json()).choices[0].message.content, "test result");
    assert.deepEqual(adapterCalls, [{
      input: "https://ignored.invalid/v1/chat/completions",
      owner: "test_user_provenance",
      model: "test_gpt_selected",
    }]);
    const actual = api.actualLlmModel();
    assert.equal(actual?.source, "chatgpt");
    assert.equal(actual?.provider, "openai");
    assert.equal(actual?.model, "test_gpt_actual");
    assert.equal(actual?.profileId, "test_profile_provenance");
  });
});

test("ChatGPT selection accepts text features, requires image capability for vision features, and stays owner-bound", async () => {
  const source = readFileSync(new URL("../../lib/llm-preferences.ts", import.meta.url), "utf8");
  const module = { exports: {} as Record<string, Function> };
  const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const modelCalls: Array<[string, string]> = [];
  const catalogs: Record<string, Array<{ id: string; input: string[] }>> = {
    "test_user_alpha:test_profile_alpha": [
      { id: "test_gpt_text", input: ["text"] },
      { id: "test_gpt_vision", input: ["text", "image"] },
      { id: "test_gpt_image_only", input: ["image"] },
    ],
  };
  const plan = {
    models: async (owner: string, profileId: string) => {
      modelCalls.push([owner, profileId]);
      return catalogs[owner + ":" + profileId] || [];
    },
  };

  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    URL,
    Buffer,
    process,
    require: (id: string) => {
      if (id === "@/lib/config") return { GROWDESK_CONFIG: { enabled: false } };
      if (id === "@/lib/llm-profiles") {
        return {
          getActiveLlmProfile: () => ({ baseUrl: "https://test-provider.invalid/v1", apiKey: "test_fake_api_key", model: "test_api_model" }),
          getActiveLlmProfileId: () => "test_api_profile",
          getLlmProfileById: () => null,
          getLlmProfileProvider: () => "test_provider",
          listLlmProfileEntries: () => [],
          resolveLlmProfileModel: () => "test_api_model",
        };
      }
      if (id === "@/lib/llm-feature-model") return featureModelRules;
      if (id === "@/lib/chatgpt-plan") return { getChatGPTPlan: () => plan };
      if (id === "@/lib/growdesk/client") return { growdeskFetch: async () => ({}) };
      if (id === "@/lib/growdesk/bridge-protocol") return { requireData: (value: unknown) => value };
      if (id.startsWith("node:")) return require(id);
      throw new Error("Unexpected dependency: " + id);
    },
  });

  const { validateLlmSelection, LlmPreferenceError } = module.exports as {
    validateLlmSelection: (owner: string, value: unknown) => Promise<{ feature: string; modelId: string }>;
    LlmPreferenceError: new (...args: unknown[]) => Error & { code: string };
  };
  const tips = await validateLlmSelection("test_user_alpha", {
    feature: "tips",
    source: "chatgpt",
    profileId: "test_profile_alpha",
    modelId: "test_gpt_text",
  });
  assert.equal(tips.feature, "tips");
  assert.equal(tips.modelId, "test_gpt_text");

  await validateLlmSelection("test_user_alpha", {
    feature: "growth_ocr",
    source: "chatgpt",
    profileId: "test_profile_alpha",
    modelId: "test_gpt_vision",
  });
  await assert.rejects(validateLlmSelection("test_user_alpha", {
    feature: "growth_ocr",
    source: "chatgpt",
    profileId: "test_profile_alpha",
    modelId: "test_gpt_text",
  }), (error: unknown) => (error as { code?: string })?.code === "chatgpt_model_unavailable");
  await assert.rejects(validateLlmSelection("test_user_alpha", {
    feature: "tips",
    source: "chatgpt",
    profileId: "test_profile_alpha",
    modelId: "test_gpt_image_only",
  }), (error: unknown) => (error as { code?: string })?.code === "chatgpt_model_unavailable");
  await assert.rejects(validateLlmSelection("test_user_beta", {
    feature: "tips",
    source: "chatgpt",
    profileId: "test_profile_alpha",
    modelId: "test_gpt_text",
  }), (error: unknown) => (error as { code?: string })?.code === "chatgpt_model_unavailable");

  assert.deepEqual(modelCalls.slice(-1), [["test_user_beta", "test_profile_alpha"]]);
  assert.equal(typeof LlmPreferenceError, "function");
});
