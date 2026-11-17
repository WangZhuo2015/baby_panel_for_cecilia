import test from "node:test";
import assert from "node:assert/strict";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { runBabyAgent } from "../../lib/agent/run";

test("explicit subscription session executes app tools without using a configured API backend", async t => {
  const original = globalThis.fetch;
  let externalCalls = 0, wrongKeyCalls = 0, toolCalls = 0, overrideCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error("No external APIs in this test"); };
  t.after(() => { globalThis.fetch = original; });
  const faux = createFauxCore({ models: [{ id: "test-subscription-model" }] });
  faux.setResponses([fauxAssistantMessage([fauxToolCall("test_baby_profile", {})]), fauxAssistantMessage([fauxText("合成宝宝资料已读取。")])]);
  const output: string[] = [];
  await runBabyAgent({
    systemPrompt: "Synthetic only", history: [], prompt: "读取合成宝宝资料",
    backendSession: { model: faux.getModel(), streamFn: faux.streamSimple, getApiKey: async () => "TEST-SUBSCRIPTION-TOKEN" },
    streamFn: () => { overrideCalls++; throw new Error("Wrong stream"); },
    getApiKey: () => { wrongKeyCalls++; return "TEST-API-KEY"; },
    tools: [{ name: "test_baby_profile", label: "Test baby", description: "Synthetic profile", parameters: { type: "object", properties: {} }, execute: async () => { toolCalls++; return { content: [{ type: "text", text: "test_baby_synthetic" }], details: {} }; } }],
    onEvent: event => { if (event.type === "text") output.push(event.text); },
  });
  assert.equal(toolCalls, 1); assert.equal(faux.state.callCount, 2); assert.match(output.join(""), /合成宝宝资料/);
  assert.equal(externalCalls, 0); assert.equal(wrongKeyCalls, 0); assert.equal(overrideCalls, 0);
});

test("a lazy subscription error fails the task without trying other billing providers", async t => {
  const original = globalThis.fetch; let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error("No external APIs in this test"); };
  t.after(() => { globalThis.fetch = original; });
  const faux = createFauxCore({ models: [{ id: "test-subscription-error" }] });
  faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "ChatGPT 套餐已达到用量上限" })]);
  await assert.rejects(runBabyAgent({ systemPrompt: "Synthetic only", history: [], prompt: "test", tools: [], onEvent: () => {},
    backendSession: { model: faux.getModel(), streamFn: faux.streamSimple, getApiKey: async () => "TEST-SUBSCRIPTION-TOKEN" },
  }), /ChatGPT 套餐已达到用量上限/);
  assert.equal(faux.state.callCount, 1); assert.equal(externalCalls, 0);
});
