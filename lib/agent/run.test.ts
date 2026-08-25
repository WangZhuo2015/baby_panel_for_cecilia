import assert from "node:assert/strict";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { runBabyAgent, type AgentStreamEvent } from "@/lib/agent/run";
import { hhmmToIso } from "@/lib/agent/tools";
import { createLlmBackend, resolveLlmBackendId } from "@/lib/agent/model";

async function testHhmmToIso() {
  const iso = hhmmToIso("14:30", "2026-08-25");
  assert.equal(new Date(iso).toISOString(), "2026-08-25T06:30:00.000Z");
}

async function testAgentLoopUsesTools() {
  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("get_baby_profile", {})]),
    fauxAssistantMessage([fauxText("档案已读取，宝宝叫 Cecilia。")]),
  ]);

  let profileCalls = 0;
  const tools: AgentTool[] = [
    {
      name: "get_baby_profile",
      label: "宝宝档案",
      description: "获取宝宝档案",
      parameters: Type.Object({}),
      execute: async () => {
        profileCalls += 1;
        return {
          content: [{ type: "text", text: JSON.stringify({ nickname: "Cecilia" }) }],
          details: {},
        };
      },
    },
  ];

  const events: AgentStreamEvent[] = [];
  await runBabyAgent({
    systemPrompt: "你是测试助手，必须先调用 get_baby_profile。",
    history: [],
    prompt: "宝宝叫什么名字？",
    tools,
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    getApiKey: () => "test",
    onEvent: (e) => events.push(e),
  });

  assert.equal(profileCalls, 1, "tool should execute once");
  const toolEvents = events.filter((e) => e.type === "tool");
  assert.ok(toolEvents.some((e) => e.type === "tool" && e.status === "start"));
  assert.ok(toolEvents.some((e) => e.type === "tool" && e.status === "end" && !e.isError));
  const text = events
    .filter((e): e is Extract<AgentStreamEvent, { type: "text" }> => e.type === "text")
    .map((e) => e.text)
    .join("");
  assert.match(text, /Cecilia/);
}

async function testBackendCatalog() {
  const openrouter = createLlmBackend("openrouter");
  assert.equal(openrouter.id, "openrouter");
  assert.equal(openrouter.model.provider, "openrouter");
  assert.equal(openrouter.model.baseUrl, "https://openrouter.ai/api/v1");
  assert.equal(openrouter.model.headers?.["X-Title"], "Baby Panel");
  assert.equal(resolveLlmBackendId("hermes"), "openrouter");
  assert.equal(resolveLlmBackendId("not-a-backend"), "openrouter");
}

async function main() {
  await testHhmmToIso();
  await testAgentLoopUsesTools();
  await testBackendCatalog();
  console.log("agent tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
