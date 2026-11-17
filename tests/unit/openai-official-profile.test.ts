import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OPENAI_OFFICIAL_PROFILE_ID,
  resolveOfficialOpenAiKey,
  runWithLlmProfileScope,
} from "../../lib/llm-profiles";
import { createLlmBackend, resolveLlmBackendId } from "../../lib/agent/model";

const KEY_ENV = ["GROWDESK_AI_API_KEY", "OPENAI_API_KEY", "GROWDESK_AI_API_KEY_FILE"] as const;
type KeyEnv = (typeof KEY_ENV)[number];
type SavedEnv = Record<KeyEnv, string | undefined>;

function saveEnv(): SavedEnv {
  return Object.fromEntries(KEY_ENV.map(key => [key, process.env[key]])) as SavedEnv;
}
function restoreEnv(saved: SavedEnv): void {
  for (const key of KEY_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}
function clearInlineKeys(): void {
  process.env.GROWDESK_AI_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
}

test("official key resolver prioritizes inline keys and reads only an explicit key file", async () => {
  const prior = saveEnv();
  const directory = await mkdtemp(path.join(os.tmpdir(), "test-openai-key-"));
  const filename = path.join(directory, "virtual-key");
  try {
    await writeFile(filename, "  test_file_key_value  \n", { mode: 0o600 });
    process.env.GROWDESK_AI_API_KEY = " test_growdesk_inline_key ";
    process.env.OPENAI_API_KEY = "test_openai_inline_key";
    process.env.GROWDESK_AI_API_KEY_FILE = filename;
    assert.equal(resolveOfficialOpenAiKey(), "test_growdesk_inline_key");

    process.env.GROWDESK_AI_API_KEY = "";
    assert.equal(resolveOfficialOpenAiKey(), "test_openai_inline_key");

    clearInlineKeys();
    assert.equal(resolveOfficialOpenAiKey(), "test_file_key_value");

    delete process.env.GROWDESK_AI_API_KEY_FILE;
    assert.equal(resolveOfficialOpenAiKey(), "");
  } finally {
    restoreEnv(prior);
    await rm(directory, { recursive: true, force: true });
  }
});

test("official key resolver rejects missing, non-file, and oversized explicit files generically", async () => {
  const prior = saveEnv();
  const directory = await mkdtemp(path.join(os.tmpdir(), "test-openai-key-invalid-"));
  const directoryPath = path.join(directory, "a-directory");
  const oversizedPath = path.join(directory, "oversized-key");
  try {
    await mkdir(directoryPath);
    await writeFile(oversizedPath, Buffer.alloc(16_385, 0x61), { mode: 0o600 });
    clearInlineKeys();
    for (const badPath of [path.join(directory, "missing-key"), directoryPath, oversizedPath]) {
      process.env.GROWDESK_AI_API_KEY_FILE = badPath;
      assert.throws(() => resolveOfficialOpenAiKey(), (error: unknown) => {
        assert(error instanceof Error);
        assert.equal(error.message, "Official OpenAI API key configuration is invalid");
        assert.equal(error.message.includes(badPath), false);
        assert.equal(error.message.includes("test_file"), false);
        return true;
      });
    }
  } finally {
    restoreEnv(prior);
    await rm(directory, { recursive: true, force: true });
  }
});

test("official profile selects the OpenAI Responses adapter and never resolves to OpenRouter", () => {
  const prior = saveEnv();
  try {
    process.env.GROWDESK_AI_API_KEY = "test_virtual_official_key";
    process.env.OPENAI_API_KEY = "";
    delete process.env.GROWDESK_AI_API_KEY_FILE;
    runWithLlmProfileScope(OPENAI_OFFICIAL_PROFILE_ID, "gpt-6-luna", () => {
      assert.equal(resolveLlmBackendId(), "opencode");
      const backend = createLlmBackend("opencode", { isVision: true });
      assert.equal(backend.model.id, "gpt-6-luna");
      assert.equal(backend.model.api, "openai-responses");
      assert.equal(backend.model.provider, "openai");
      assert.equal(backend.model.baseUrl, "https://api.openai.com/v1");
      assert.deepEqual(backend.model.input, ["text", "image"]);
      assert.equal(backend.getApiKey(), "test_virtual_official_key");
    });
  } finally {
    restoreEnv(prior);
  }
});
