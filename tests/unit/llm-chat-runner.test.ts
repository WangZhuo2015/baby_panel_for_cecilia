import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { transformSync } from "esbuild";
import * as receipts from "../../lib/agent/chat-retry";

const require = createRequire(import.meta.url);
const selected = { source: "api" as const, provider: "test_provider", model: "test_selected_model", profileId: "test_profile" };
function fixture(agent: (options: any) => Promise<void>, failSave = false) {
  const persisted: any[] = [];
  const module = { exports: {} as any };
  const mocks: Record<string, unknown> = {
    "@/lib/prisma": { prisma: new Proxy({}, { get() { assert.fail("Shared runner must never access SQLite"); } }) },
    "@/lib/archive": { archiveText: async () => undefined },
    "@/lib/agent/tools": { createBabyPanelTools: () => [] },
    "@/lib/agent/images": { resolveImageContent: async () => undefined },
    "@/lib/agent/run": { runBabyAgent: agent },
    "@/lib/growdesk/config": { isGrowDeskEnabled: () => true },
    "@/lib/growdesk/ai-sessions": { bffAiSessionStore: { addMessage: async (_session: string, owner: string, body: any, token: string) => {
      assert.equal(owner, "test_owner"); assert.equal(token, "test_access_token"); persisted.push(body);
      if (failSave) throw new Error("test_save_unavailable");
      return body;
    } } },
    "@/lib/agent/chat-retry": receipts,
  };
  const code = transformSync(readFileSync(new URL("../../lib/agent/session-runner.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith("node:")) return require(id);
    throw new Error("Unexpected dependency: " + id);
  }, AbortController, setTimeout, clearTimeout, console });
  const manager = new module.exports.ActiveChatRunManager();
  const params = {
    sessionId: "00000000-0000-4000-8000-000000000001", userId: "test_owner",
    turnId: "00000000-0000-4000-8000-000000000002", attempt: 1, requestFingerprint: "test_fingerprint",
    baby: { id: "test_baby" }, promptText: "test_prompt", systemPrompt: "test_system", history: [],
    sessionMeta: { id: "00000000-0000-4000-8000-000000000001", title: "test_chat", contextType: "general" },
    accessToken: "test_access_token", llmInfo: selected,
  };
  return { manager, params, persisted };
}

test("failed dialogue persists its attempted model and a retryable turn receipt", async () => {
  const f = fixture(async () => { throw new Error("test_provider_unavailable"); });
  const run = f.manager.startRun(f.params); await run.promise;
  assert.equal(run.status, "failed"); assert.equal(run.retryable, true);
  const tools = JSON.parse(f.persisted[0].toolsJson);
  assert.deepEqual(receipts.readChatLlmModelInfo(tools), selected);
  assert.equal(receipts.readChatTurnReceipt(tools)?.retryable, true);
  const events: any[] = []; f.manager.attachRunSubscriber(run, (event: any) => events.push(event));
  assert(events.some(event => event.type === "error" && event.retryable)); assert.equal(events.at(-1).type, "done");
  f.manager.clearAllForTest();
});

test("a started write tool makes whole-turn retry unsafe even without a tool result", async () => {
  const f = fixture(async options => {
    options.onEvent({ type: "tool", name: "record_feeding", status: "start" });
    throw new Error("test_connection_lost_after_write_started");
  });
  const run = f.manager.startRun(f.params); await run.promise;
  assert.equal(run.status, "failed"); assert.equal(run.writeToolStarted, true); assert.equal(run.retryable, false);
  assert.equal(receipts.readChatTurnReceipt(JSON.parse(f.persisted[0].toolsJson))?.retryable, false);
  f.manager.clearAllForTest();
});

test("persistence failure is a visible terminal error and never reports success or retries the model", async () => {
  let calls = 0;
  const f = fixture(async options => { calls++; options.onModelUsed({ ...selected, model: "test_actual_model" }); options.onEvent({ type: "text", text: "test reply" }); }, true);
  const run = f.manager.startRun(f.params); await run.promise;
  assert.equal(calls, 1); assert.equal(f.persisted.length, 1); assert.equal(run.status, "failed"); assert.equal(run.retryable, false);
  assert.match(run.errorMessage, /保存失败/);
  const events: any[] = []; f.manager.attachRunSubscriber(run, (event: any) => events.push(event));
  assert(events.some(event => event.type === "error" && event.retryable === false)); assert.equal(events.at(-1).type, "done");
  f.manager.clearAllForTest();
});

test("repeated in-flight turns reuse the run; timeout cannot advertise retry before execution settles", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const f = fixture(async options => { calls++; await gate; options.onEvent({ type: "tool", name: "record_feeding", status: "start" }); });
  const run = f.manager.startRun({ ...f.params, timeoutMs: 10 });
  assert.equal(f.manager.startRun(f.params), run);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(run.retryable, false); assert.equal(f.persisted.length, 0); assert.equal(calls, 1);
  release(); await run.promise;
  assert.equal(run.status, "failed"); assert.equal(run.retryable, false);
  f.manager.clearAllForTest();
});
