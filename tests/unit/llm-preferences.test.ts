import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FileLlmPreferenceStore,
  getLlmPreferences,
  validateLlmSelection,
  LlmPreferenceError,
  type LlmSelection,
} from "../../lib/llm-preferences";
import {
  getActiveLlmProfile,
  getActiveLlmProfileId,
  listLlmProfileEntries,
  runWithLlmProfileScope,
} from "../../lib/llm-profiles";
import { AI_CONFIG } from "../../lib/config";
import {
  getCurrentLlmCacheKey,
  getCurrentLlmModelInfo,
  withLlmFeature,
} from "../../lib/llm-context";

const chatSelection: LlmSelection = {
  feature: "chat",
  source: "api",
  profileId: "test-profile",
  modelId: "test-model",
};

test("legacy preference file survives reopen and concurrent owner/feature writes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-panel-test-llm-preferences-"));
  const filename = path.join(directory, "preferences.json");
  try {
    const firstStore = new FileLlmPreferenceStore(filename);
    await firstStore.set("test_user_alpha", chatSelection);
    await Promise.all([
      firstStore.set("test_user_alpha", {
        ...chatSelection,
        feature: "tips",
        modelId: "test-tips-model",
      }),
      firstStore.set("test_user_alpha", {
        ...chatSelection,
        feature: "daily_summary",
        modelId: "test-summary-model",
      }),
      firstStore.set("test_user_beta", {
        ...chatSelection,
        modelId: "test-beta-model",
      }),
    ]);

    const reopened = new FileLlmPreferenceStore(filename);
    assert.deepEqual(
      (await reopened.list("test_user_alpha")).map((selection) => selection.feature).sort(),
      ["chat", "daily_summary", "tips"],
    );
    assert.deepEqual(await reopened.list("test_user_beta"), [{ ...chatSelection, modelId: "test-beta-model" }]);
    assert.deepEqual(await reopened.list("test_user_missing"), []);

    const contents = await readFile(filename, "utf8");
    assert.equal(contents.includes("apiKey"), false);
    assert.equal(contents.includes("baseUrl"), false);
    assert.equal(contents.includes("headers"), false);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preference file rejects secret or unknown fields instead of persisting them", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-panel-test-llm-preferences-"));
  const filename = path.join(directory, "preferences.json");
  try {
    const store = new FileLlmPreferenceStore(filename);
    await assert.rejects(
      store.set("test_user_alpha", { ...chatSelection, apiKey: "test_secret" }),
      (error: unknown) => error instanceof LlmPreferenceError && error.code === "invalid_selection",
    );
    await assert.rejects(access(filename));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("test profile resolution ignores repository profile data and uses only environment config", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-panel-test-profile-scope-"));
  const previous = {
    cwd: process.cwd(),
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    officialKey: process.env.GROWDESK_AI_API_KEY,
    openAiKey: process.env.OPENAI_API_KEY,
    officialKeyFile: process.env.GROWDESK_AI_API_KEY_FILE,
    amdKey: process.env.AMD_API_KEY,
  };
  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(
      path.join(directory, "llm-profiles.json"),
      JSON.stringify({
        activeProfile: "sentinel_profile",
        profiles: { sentinel_profile: { baseUrl: "https://sentinel.invalid/v1", apiKey: "test_virtual_openai_profile_key", model: "sentinel_model" } },
      }),
    ));
    process.chdir(directory);
    process.env.AI_API_KEY = "test_fake_key";
    process.env.AI_BASE_URL = "https://test-provider.invalid/v1";
    process.env.AI_MODEL = "test-env-model";
    process.env.GROWDESK_AI_API_KEY = "test_virtual_official_key";
    process.env.OPENAI_API_KEY = "test_virtual_openai_key";
    process.env.AMD_API_KEY = "test_virtual_amd_key";
    delete process.env.GROWDESK_AI_API_KEY_FILE;

    const entries = listLlmProfileEntries();
    assert.deepEqual(entries.map((entry) => entry.id), ["openai-official", "amd-v4.1-flash", "default"]);
    assert.equal(entries.find((entry) => entry.id === "amd-v4.1-flash")?.profile.apiKey, "test_virtual_amd_key");
    assert.equal(getActiveLlmProfileId(), "default");
    assert.equal(getActiveLlmProfile().name, "Legacy Environment");
    const scoped = runWithLlmProfileScope("default", "test-scope-model", () => ({
      profile: getActiveLlmProfile(),
      id: getActiveLlmProfileId(),
    }));
    assert.equal(scoped.profile.model, "test-scope-model");
    assert.equal(scoped.profile.visionModel, "test-scope-model");
    assert.equal(scoped.id, "default");
  } finally {
    process.chdir(previous.cwd);
    if (previous.apiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous.apiKey;
    if (previous.baseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = previous.model;
    if (previous.officialKey === undefined) delete process.env.GROWDESK_AI_API_KEY;
    else process.env.GROWDESK_AI_API_KEY = previous.officialKey;
    if (previous.openAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.openAiKey;
    if (previous.officialKeyFile === undefined) delete process.env.GROWDESK_AI_API_KEY_FILE;
    else process.env.GROWDESK_AI_API_KEY_FILE = previous.officialKeyFile;
    if (previous.amdKey === undefined) delete process.env.AMD_API_KEY;
    else process.env.AMD_API_KEY = previous.amdKey;
    await rm(directory, { recursive: true, force: true });
  }
});

test("parallel feature scopes pin selected models and isolate cache keys by owner and feature", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-panel-test-llm-scope-"));
  const filename = path.join(directory, "preferences.json");
  const envKeys = [
    "AI_API_KEY",
    "AI_BASE_URL",
    "AI_MODEL",
    "AI_VISION_MODEL",
    "GROWDESK_AI_API_KEY",
    "OPENAI_API_KEY",
    "GROWDESK_AI_API_KEY_FILE",
    "AMD_API_KEY",
    "LLM_PREFERENCES_FILE",
    "GROWDESK_ENABLED",
    "GROWDESK_API_URL",
  ] as const;
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>;

  try {
    process.env.AI_API_KEY = "test_fake_api_key";
    process.env.AI_BASE_URL = "https://test-provider.invalid/v1";
    process.env.AI_MODEL = "test-chat-model";
    process.env.AI_VISION_MODEL = "test-vision-model";
    process.env.GROWDESK_AI_API_KEY = "test_virtual_official_key";
    process.env.OPENAI_API_KEY = "test_virtual_openai_key";
    process.env.AMD_API_KEY = "test_virtual_amd_key";
    delete process.env.GROWDESK_AI_API_KEY_FILE;
    process.env.LLM_PREFERENCES_FILE = filename;
    process.env.GROWDESK_ENABLED = "false";
    delete process.env.GROWDESK_API_URL;

    const store = new FileLlmPreferenceStore(filename);
    await store.set("test_user_scope", {
      feature: "chat",
      source: "api",
      profileId: "default",
      modelId: "test-chat-model",
    });
    await store.set("test_user_scope", {
      feature: "medical_ocr",
      source: "api",
      profileId: "default",
      modelId: "test-vision-model",
    });

    const [chat, medical, otherOwner, dailySummary] = await Promise.all([
      withLlmFeature("test_user_scope", "chat", undefined, () => ({
        model: AI_CONFIG.model,
        visionModel: AI_CONFIG.visionModel,
        info: getCurrentLlmModelInfo(),
        cacheKey: getCurrentLlmCacheKey(),
      })),
      withLlmFeature("test_user_scope", "medical_ocr", undefined, () => ({
        model: AI_CONFIG.model,
        visionModel: AI_CONFIG.visionModel,
        info: getCurrentLlmModelInfo(true),
        cacheKey: getCurrentLlmCacheKey(),
      })),
      withLlmFeature("test_user_other", "chat", undefined, () => ({
        model: AI_CONFIG.model,
        info: getCurrentLlmModelInfo(),
        cacheKey: getCurrentLlmCacheKey(),
      })),
      withLlmFeature("test_user_scope", "daily_summary", undefined, () => ({
        model: AI_CONFIG.model,
        info: getCurrentLlmModelInfo(),
      })),
    ]);

    assert.equal(chat.model, "test-chat-model");
    assert.equal(chat.visionModel, "test-chat-model");
    assert.deepEqual(chat.info, {
      source: "api",
      provider: "custom",
      model: "test-chat-model",
      profileId: "default",
    });
    assert.equal(medical.model, "test-vision-model");
    assert.equal(medical.visionModel, "test-vision-model");
    assert.equal(medical.info?.model, "test-vision-model");
    assert.equal(otherOwner.model, "gpt-6-luna");
    assert.equal(otherOwner.info?.profileId, "openai-official");
    assert.equal(dailySummary.model, "DeepSeek-V4.1-Flash");
    assert.equal(dailySummary.info?.profileId, "amd-v4.1-flash");
    assert.notEqual(chat.cacheKey, medical.cacheKey);
    assert.notEqual(chat.cacheKey, otherOwner.cacheKey);
    assert.notEqual(medical.cacheKey, otherOwner.cacheKey);
    const visionChat = await validateLlmSelection("test_user_scope", {
      feature: "chat", source: "api", profileId: "default", modelId: "test-vision-model",
    });
    assert.equal(visionChat.modelId, "test-vision-model");
    await assert.rejects(validateLlmSelection("test_user_scope", {
      feature: "medical_ocr", source: "api", profileId: "default", modelId: "test-chat-model",
    }), (error: unknown) => error instanceof LlmPreferenceError && error.code === "llm_model_unavailable");
    await assert.rejects(validateLlmSelection("test_user_scope", {
      feature: "chat", source: "api", profileId: "default", modelId: "test_unknown_model",
    }), (error: unknown) => error instanceof LlmPreferenceError && error.code === "llm_model_unavailable");
  } finally {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared mode uses only the authenticated GrowDesk preference endpoint and never falls back locally", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "baby-panel-test-llm-preferences-"));
  const filename = path.join(directory, "must-not-exist.json");
  const prior = {
    enabled: process.env.GROWDESK_ENABLED,
    apiUrl: process.env.GROWDESK_API_URL,
    preferencePath: process.env.LLM_PREFERENCES_FILE,
    fetch: globalThis.fetch,
  };
  const calls: Array<{ url: string; authorization: string | null }> = [];

  try {
    process.env.GROWDESK_ENABLED = "true";
    process.env.GROWDESK_API_URL = "https://growdesk-test.invalid";
    process.env.LLM_PREFERENCES_FILE = filename;

    await assert.rejects(
      getLlmPreferences("test_user_alpha"),
      (error: unknown) => error instanceof LlmPreferenceError && error.status === 401,
    );

    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json(
        { data: { preferences: [chatSelection] } },
        { headers: { "content-type": "application/json" } },
      );
    };

    assert.deepEqual(await getLlmPreferences("test_user_alpha", "test_access_token"), [chatSelection]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://growdesk-test.invalid/api/v1/web/ai/preferences");
    assert.equal(calls[0]?.authorization, "Bearer test_access_token");

    globalThis.fetch = async () => Response.json(
      { error: { code: "TEST_UPSTREAM_UNAVAILABLE", message: "test failure" } },
      { status: 503, headers: { "content-type": "application/json" } },
    );
    await assert.rejects(getLlmPreferences("test_user_alpha", "test_access_token"));
    await assert.rejects(access(filename));
  } finally {
    globalThis.fetch = prior.fetch;
    if (prior.enabled === undefined) delete process.env.GROWDESK_ENABLED;
    else process.env.GROWDESK_ENABLED = prior.enabled;
    if (prior.apiUrl === undefined) delete process.env.GROWDESK_API_URL;
    else process.env.GROWDESK_API_URL = prior.apiUrl;
    if (prior.preferencePath === undefined) delete process.env.LLM_PREFERENCES_FILE;
    else process.env.LLM_PREFERENCES_FILE = prior.preferencePath;
    await rm(directory, { recursive: true, force: true });
  }
});
