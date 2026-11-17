import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import vm from "node:vm";
import { transformSync } from "esbuild";

const require = createRequire(import.meta.url);
let activeProfileId = "test_profile";
let fetchImpl: typeof fetch = fetch;
const source = readFileSync(new URL("../../lib/llm-provenance.ts", import.meta.url), "utf8");
const module = { exports: {} as Record<string, Function> };
const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
vm.runInNewContext(code, { module, exports: module.exports, URL, Response, fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args), require: (id: string) => {
  if (id === "@/lib/chatgpt-plan/task-adapter") return { chatGPTPlanTaskFetch: () => assert.fail("API tasks must not call the ChatGPT adapter") };
  if (id === "@/lib/llm-context") return { getCurrentLlmFeatureScope: () => undefined, getCurrentLlmModelInfo: () => ({ source: "api", provider: "test_provider", model: "test_alias", profileId: "test_profile" }) };
  if (id === "@/lib/llm-profiles") return {
    OPENAI_OFFICIAL_PROFILE_ID: "openai-official",
    getActiveLlmProfileId: () => activeProfileId,
    getLlmProfileScope: () => activeProfileId === "openai-official" ? { modelId: "gpt-6-luna" } : undefined,
    getActiveLlmProfile: () => ({ model: activeProfileId === "openai-official" ? "gpt-6-luna" : "test_alias" }),
  };
  if (id.startsWith("node:")) return require(id);
  throw new Error("Unexpected dependency: " + id);
} });
const { llmFetch, actualLlmModel, withLlmProvenance, recordLlmModel } = module.exports;

test("records the actual provider model without consuming the feature response", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer test_fake_key");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ model: "test_actual_model", choices: [{ message: { content: "test reply" } }] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  try {
    await withLlmProvenance(async () => {
      const response = await llmFetch(`http://127.0.0.1:${address.port}/private/test`, {
        method: "POST", headers: { authorization: "Bearer test_fake_key" }, body: JSON.stringify({ model: "test_alias" }),
      });
      assert.equal((await response.json()).choices[0].message.content, "test reply");
      const actual = actualLlmModel();
      assert.equal(actual.model, "test_actual_model"); assert.equal(actual.provider, "127.0.0.1");
      assert(!JSON.stringify(actual).includes("test_fake_key")); assert(!JSON.stringify(actual).includes("private"));
    });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("concurrent feature results keep independent provenance and rules clear model labels", async () => {
  await Promise.all(["test_chat_model", "test_ocr_model"].map((model, index) => withLlmProvenance(async () => {
    recordLlmModel({ source: "api", provider: "test_provider", model });
    await new Promise(resolve => setTimeout(resolve, index ? 2 : 8));
    assert.equal(actualLlmModel().model, model);
    recordLlmModel(null); assert.equal(actualLlmModel(), null);
  })));
  assert.equal(actualLlmModel(), null);
});


test("official GPT-6 direct requests use compatible token limits and sampling defaults", async () => {
  const priorFetch = fetchImpl;
  activeProfileId = "openai-official";
  fetchImpl = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.max_completion_tokens, 321);
    assert.equal("max_tokens" in body, false);
    assert.equal("temperature" in body, false);
    assert.deepEqual(body.response_format, { type: "json_object" });
    return Response.json({ model: "gpt-6-luna", choices: [] });
  };
  try {
    const response = await llmFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "old-model-alias",
        max_tokens: 321,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: "test prompt" }],
      }),
    });
    assert.equal(response.status, 200);
  } finally {
    fetchImpl = priorFetch;
    activeProfileId = "test_profile";
  }
});
