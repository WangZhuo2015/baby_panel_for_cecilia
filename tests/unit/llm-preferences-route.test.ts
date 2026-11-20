import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const require = createRequire(import.meta.url);

function loadRoute(mocks: Record<string, unknown>) {
  const filename = path.resolve(import.meta.dirname, "../../app/api/ai/preferences/route.ts");
  const code = transformSync(fs.readFileSync(filename, "utf8"), { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} as Record<string, any> };
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith("node:")) return require(id);
      throw new Error("Unmocked import: " + id);
    },
    process,
    Request,
    Response,
    URL,
    TextEncoder,
    console,
  });
  return module.exports as {
    GET(request: Request): Promise<Response>;
    PUT(request: Request): Promise<Response>;
  };
}

function preferencesRoute(options: { authenticated?: boolean } = {}) {
  const calls: unknown[][] = [];
  const selection = {
    feature: "chat",
    source: "api",
    profileId: "test-profile",
    modelId: "test-model",
  };
  const route = loadRoute({
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/api-helpers": {
      requireAuth: async () => {
        calls.push(["legacyAuth"]);
        throw new Error("Shared mode must not invoke legacy auth or Prisma");
      },
    },
    "@/lib/config": { GROWDESK_CONFIG: { enabled: true } },
    "@/lib/llm-preferences": {
      LlmPreferenceError: class LlmPreferenceError extends Error {
        status = 400;
        code = "test_invalid_preference";
      },
      getLlmPreferences: async (owner: string, token?: string) => {
        calls.push(["preferences", owner, token]);
        return [selection];
      },
      getLlmProfileCatalog: () => [{ id: "test-profile", name: "Test", provider: "test", textModel: "test-model", visionModel: "test-model", available: true }],
      getDefaultLlmModelInfo: () => ({ source: "api", provider: "test", model: "test-model", profileId: "test-profile" }),
      saveLlmPreference: async (owner: string, body: unknown, token?: string) => {
        calls.push(["save", owner, body, token]);
        return selection;
      },
    },
    "@/lib/growdesk/bridge-protocol": {
      BridgeError: class BridgeError extends Error {},
      bridgeErrorResponse: () => Response.json({ error: "bridge_error" }, { status: 500 }),
    },
    "@/lib/growdesk/csrf": {
      verifyBffCsrf: () => {
        calls.push(["csrf"]);
        return null;
      },
    },
    "@/lib/growdesk/session": {
      resolveBffSession: async () => {
        calls.push(["bff"]);
        return options.authenticated === false
          ? null
          : { user: { id: "test_shared_user" }, accessToken: "test_access_token" };
      },
    },
  });
  return { route, calls };
}

test("shared preference GET uses the validated BFF principal without legacy auth", async () => {
  const { route, calls } = preferencesRoute();
  const response = await route.GET(new Request("https://test.invalid/api/ai/preferences"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    data: {
      preferences: [{ feature: "chat", source: "api", profileId: "test-profile", modelId: "test-model" }],
      profiles: [{ id: "test-profile", name: "Test", provider: "test", textModel: "test-model", visionModel: "test-model", available: true }],
      activeProfileId: "test-profile",
      defaultModelInfo: { source: "api", provider: "test", model: "test-model", profileId: "test-profile" },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["bff"],
    ["preferences", "test_shared_user", "test_access_token"],
  ]);
});

test("shared preference PUT verifies CSRF and writes only for the BFF principal", async () => {
  const { route, calls } = preferencesRoute();
  const body = { feature: "chat", source: "api", profileId: "test-profile", modelId: "test-model" };
  const response = await route.PUT(new Request("https://test.invalid/api/ai/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://test.invalid" },
    body: JSON.stringify(body),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: body });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["csrf"],
    ["bff"],
    ["save", "test_shared_user", body, "test_access_token"],
  ]);
});

test("missing shared session fails closed without legacy auth fallback", async () => {
  const { route, calls } = preferencesRoute({ authenticated: false });
  const response = await route.GET(new Request("https://test.invalid/api/ai/preferences"));
  assert.equal(response.status, 401);
  assert.deepEqual(calls, [["bff"]]);
});
