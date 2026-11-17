import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLlmProfilesConfig } from "../../lib/llm-profiles";

test("an immutable release reads the explicit profile file; cache includes its path", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "test_llm_profile_location_"));
  const previous = process.env.LLM_PROFILES_FILE;
  try {
    const files = ["alpha", "beta"].map((id) => {
      const file = path.join(directory, id + ".json");
      writeFileSync(file, JSON.stringify({ activeProfile: id, profiles: {
        [id]: { baseUrl: "http://127.0.0.1:1", apiKey: "test_virtual_key", model: "test_" + id },
      }}));
      utimesSync(file, 1700000000, 1700000000);
      return file;
    });
    process.env.LLM_PROFILES_FILE = files[0];
    assert.equal(loadLlmProfilesConfig()?.activeProfile, "alpha");
    process.env.LLM_PROFILES_FILE = files[1];
    assert.equal(loadLlmProfilesConfig()?.activeProfile, "beta");
    process.env.LLM_PROFILES_FILE = path.join(directory, "missing.json");
    assert.equal(loadLlmProfilesConfig(), null, "missing explicit file never falls back to the repository");
  } finally {
    if (previous === undefined) delete process.env.LLM_PROFILES_FILE;
    else process.env.LLM_PROFILES_FILE = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
