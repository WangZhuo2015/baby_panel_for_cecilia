import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { withLlmFeature } from "../../lib/llm-context";
import { FileLlmPreferenceStore, getDefaultFeatureLlmSelection, saveLlmPreference } from "../../lib/llm-preferences";
import { runBabyAgent } from "../../lib/agent/run";
import { llmFetch } from "../../lib/llm-provenance";

test("saved chat effort reaches the agent stream options", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "test-gpt-agent-"));
  const keys = ["LLM_PREFERENCES_FILE", "GROWDESK_AI_API_KEY", "GROWDESK_ENABLED", "GROWDESK_API_URL"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.LLM_PREFERENCES_FILE = path.join(directory, "preferences.json");
    process.env.GROWDESK_AI_API_KEY = "test_fake_key";
    process.env.GROWDESK_ENABLED = "false";
    delete process.env.GROWDESK_API_URL;
    const store = new FileLlmPreferenceStore(process.env.LLM_PREFERENCES_FILE);
    await store.set("test_parent", {
      feature: "chat", source: "api", profileId: "openai-official", modelId: "gpt-6.2-sol", reasoningEffort: "xhigh",
    });
    await store.set("test_low", {
      feature: "chat", source: "api", profileId: "openai-official", modelId: "gpt-6.2-sol", reasoningEffort: "low",
    });
    async function execute(owner: string, feature: "chat" | "voice") {
      const faux = createFauxCore({ models: [{ id: "test-model" }] });
      faux.setResponses([fauxAssistantMessage([fauxText("test reply")])]);
      let actual: unknown;
      await withLlmFeature(owner, feature, undefined, () => runBabyAgent({
        systemPrompt: "test", history: [], prompt: "test", tools: [], model: faux.getModel(),
        streamFn: (model, context, options) => { actual = options?.reasoning; return faux.streamSimple(model, context, options); },
        getApiKey: () => "test_fake_key", onEvent: () => {},
      }));
      return actual;
    }
    assert.equal(await execute("test_parent", "chat"), "xhigh");
    assert.equal(await execute("test_default", "chat"), "xhigh");
    assert.equal(await execute("test_low", "chat"), "low");
    assert.equal(await execute("test_default", "voice"), "low");
  } finally {
    for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
});

test("daily summary effort reaches official completion requests and follows model changes", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "test-gpt-summary-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keys = ["LLM_PREFERENCES_FILE", "GROWDESK_AI_API_KEY", "AMD_API_KEY", "GROWDESK_ENABLED", "GROWDESK_API_URL"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      const original = previous[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });
  process.env.LLM_PREFERENCES_FILE = path.join(directory, "preferences.json");
  process.env.GROWDESK_AI_API_KEY = "test_fake_official_key";
  process.env.AMD_API_KEY = "test_fake_amd_key";
  process.env.GROWDESK_ENABLED = "false";
  delete process.env.GROWDESK_API_URL;

  const owner = "test_summary_owner";
  const amd = getDefaultFeatureLlmSelection("daily_summary");
  const official = { ...getDefaultFeatureLlmSelection("chat"), feature: "daily_summary" as const };
  let payload: { model: string; reasoning_effort?: string };
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    payload = JSON.parse(init?.body as string);
    return Response.json({});
  });
  async function complete(url: string) {
    await withLlmFeature(owner, "daily_summary", undefined, () => llmFetch(url, {
      method: "POST", body: JSON.stringify({ model: "test-requested-model" }),
    }));
    return payload;
  }

  await assert.rejects(saveLlmPreference(owner, { ...amd, reasoningEffort: "high" }), { code: "llm_effort_unavailable" });
  await assert.rejects(saveLlmPreference(owner, { ...official, reasoningEffort: "high" }), { code: "llm_selection_changed" });
  assert.equal((await complete("https://developer.amd.com.cn/radeon/api/v1/chat/completions")).reasoning_effort, undefined);
  await saveLlmPreference(owner, official);
  await saveLlmPreference(owner, { ...official, reasoningEffort: "high" });
  assert.deepEqual(await complete("https://api.openai.com/v1/chat/completions"), { model: official.modelId, reasoning_effort: "high" });

  await saveLlmPreference(owner, amd);
  await assert.rejects(saveLlmPreference(owner, { ...official, reasoningEffort: "low" }), { code: "llm_selection_changed" });
  assert.equal((await complete("https://developer.amd.com.cn/radeon/api/v1/chat/completions")).reasoning_effort, undefined);
  await saveLlmPreference(owner, official);
  assert.equal((await complete("https://api.openai.com/v1/chat/completions")).reasoning_effort, "high");
});
