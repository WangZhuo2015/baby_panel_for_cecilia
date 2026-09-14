import assert from "node:assert/strict";
import test from "node:test";

import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { prisma } from "../../lib/prisma";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";
import { activeChatRunManager, type ChatStreamEvent } from "../../lib/agent/session-runner";
import { setTestMockStreamFn } from "../../lib/agent/run";
import { POST as chatPOST, GET as chatGET } from "../../app/api/ai/chat/route";
import { POST as cancelPOST } from "../../app/api/ai/chat/cancel/route";
import { GET as sessionGET } from "../../app/api/ai/sessions/[id]/route";

test("Decoupled AI Session: Prompt-First Persistence", async (t) => {
  const tenant = await createTestTenant(prisma, "promptfirst");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  // 1. Create a session
  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "提问即刻入库测试",
      contextType: "general",
    },
  });

  const promptText = "宝宝今天下午体温 37.2 度正常吗？";

  // 2. Prompt-First Persistence: Insert user prompt immediately before running agent
  const userMsg = await prisma.aiChatMessage.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: promptText,
    },
  });
  assert.ok(userMsg.id, "User message should have an ID immediately");

  // Verify prompt is in DB right away
  const persistedUserMsg = await prisma.aiChatMessage.findFirst({
    where: { sessionId: session.id, role: "user" },
  });
  assert.equal(persistedUserMsg?.content, promptText);
  assert.equal(persistedUserMsg?.role, "user");

  // 3. Configure mock LLM with delay to simulate generation
  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("37.2度属于正常体温范围，建议注意室内通风与水分摄入。"),
    ]),
  ]);

  const run = activeChatRunManager.startRun({
    sessionId: session.id,
    userId: tenant.userId,
    baby,
    promptText,
    systemPrompt: "你是专业儿科助手",
    history: [],
    sessionMeta: { id: session.id, title: session.title, contextType: session.contextType },
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    getApiKey: () => "mock-key",
  });

  await run.promise;
  assert.equal(run.status, "completed");

  // Verify both user and assistant messages exist in DB
  const allMessages = await prisma.aiChatMessage.findMany({
    where: { sessionId: session.id },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(allMessages.length, 2, "Session should have exactly 2 messages (user + assistant)");
  assert.equal(allMessages[0].role, "user");
  assert.equal(allMessages[0].content, promptText);
  assert.equal(allMessages[1].role, "assistant");
  assert.match(allMessages[1].content, /37\.2度/);
});

test("Decoupled AI Session: Client Disconnect does NOT interrupt server-side agent execution", async (t) => {
  const tenant = await createTestTenant(prisma, "disconnect");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "客户端断连保活测试",
      contextType: "feeding",
    },
  });

  const promptText = "记录喝奶 160ml 配方奶，宝宝精神很好";

  // Prompt-First Persistence
  await prisma.aiChatMessage.create({
    data: {
      sessionId: session.id,
      role: "user",
      content: promptText,
    },
  });

  // Faux model that calls record_feeding tool first, then answers
  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([
      fauxToolCall("record_feeding", {
        type: "formula",
        amountMl: 160,
        notes: "断连保活测试自动记录",
      }),
    ]),
    fauxAssistantMessage([
      fauxText("已成功为您记录喂奶 160ml 配方奶，宝宝喝得很棒！"),
    ]),
  ]);

  const clientEvents: ChatStreamEvent[] = [];
  let clientDisconnected = false;

  const clientSubscriber = (event: ChatStreamEvent) => {
    clientEvents.push(event);
    // Simulate client abrupt disconnect (e.g. mobile lock screen / backgrounding) after first text or tool event
    if (!clientDisconnected && (event.type === "text" || event.type === "tool")) {
      clientDisconnected = true;
      // Client disconnects and unsubscribes from the server
      activeChatRunManager.detachSubscriber(session.id, clientSubscriber);
    }
  };

  const run = activeChatRunManager.startRun({
    sessionId: session.id,
    userId: tenant.userId,
    baby,
    promptText,
    systemPrompt: "你是专业育儿助手",
    history: [],
    sessionMeta: { id: session.id, title: session.title, contextType: session.contextType },
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    getApiKey: () => "mock-key",
  });

  activeChatRunManager.attachSubscriber(session.id, clientSubscriber, false);

  // Wait for server background execution to completely finish
  await run.promise;

  // Assertions:
  // 1. Client indeed disconnected mid-way
  assert.equal(clientDisconnected, true, "Client should have disconnected mid-stream");

  // 2. Server run was NOT aborted and finished successfully
  assert.equal(run.abortController.signal.aborted, false, "Server AbortController must NOT be aborted by client disconnect");
  assert.equal(run.status, "completed", "Server background run must complete successfully");

  // 3. Check database persistence: Assistant message must be saved
  const assistantMsg = await prisma.aiChatMessage.findFirst({
    where: { sessionId: session.id, role: "assistant" },
  });
  assert.ok(assistantMsg, "Assistant message must be persisted to database");
  assert.match(assistantMsg.content, /160ml/);
  assert.ok(assistantMsg.toolsJson, "Tool traces must be persisted");
  assert.match(assistantMsg.toolsJson, /record_feeding/);

  // 4. Check tool side-effect in database (feeding record created by background agent)
  const feedingRecord = await prisma.feedingRecord.findFirst({
    where: { babyId: baby.id, amountMl: 160 },
  });
  assert.ok(feedingRecord, "Tool execution side effect (FeedingRecord 160ml) must succeed in background");
});

test("Decoupled AI Session: Reconnection and Stream Catch-Up", async (t) => {
  const tenant = await createTestTenant(prisma, "reconnect");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "断点续连测试",
      contextType: "sleep",
    },
  });

  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("宝宝现在的清醒时间一般在2到2.5小时左右，注意捕捉睡眠信号。"),
    ]),
  ]);

  const run = activeChatRunManager.startRun({
    sessionId: session.id,
    userId: tenant.userId,
    baby,
    promptText: "宝宝清醒间隔多长合适？",
    systemPrompt: "你是专业睡眠顾问",
    history: [],
    sessionMeta: { id: session.id, title: session.title, contextType: session.contextType },
    model: faux.getModel(),
    streamFn: faux.streamSimple,
    getApiKey: () => "mock-key",
  });

  // Await run completion
  await run.promise;
  assert.equal(run.status, "completed");

  // Simulate late reconnected subscriber (e.g. user opens app after background run completed)
  const reconnectedEvents: ChatStreamEvent[] = [];
  const attached = activeChatRunManager.attachSubscriber(
    session.id,
    (event) => reconnectedEvents.push(event),
    true
  );

  assert.equal(attached, true, "Should attach to retained session run");
  assert.ok(reconnectedEvents.some((e) => e.type === "session"), "Reconnected client should receive session meta");
  assert.ok(
    reconnectedEvents.some((e) => e.type === "text" && (e as any).replay === true),
    "Reconnected client should receive accumulated text with replay: true"
  );
  assert.ok(reconnectedEvents.some((e) => e.type === "done"), "Reconnected client should receive done event");
});

test("Decoupled AI Session: Explicit Cancellation stops active run", async (t) => {
  const tenant = await createTestTenant(prisma, "cancel");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "主动取消测试",
      contextType: "general",
    },
  });

  // Setup faux that simulates slow stream with small delay so cancel happens mid-flight
  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("第一段内容生成中..."),
    ]),
  ]);

  const slowStreamFn: any = async (m: any, c: any, opts: any) => {
    await new Promise((r) => setTimeout(r, 60));
    if (opts?.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }
    return faux.streamSimple(m, c, opts);
  };

  const run = activeChatRunManager.startRun({
    sessionId: session.id,
    userId: tenant.userId,
    baby,
    promptText: "请详细分析宝宝各阶段的发育特征",
    systemPrompt: "测试助手",
    history: [],
    sessionMeta: { id: session.id, title: session.title, contextType: session.contextType },
    model: faux.getModel(),
    streamFn: slowStreamFn,
    getApiKey: () => "mock-key",
  });

  // Cancel explicitly by user while stream is in flight
  await new Promise((r) => setTimeout(r, 15));
  const cancelResult = await activeChatRunManager.cancelRun(session.id, tenant.userId);
  assert.equal(cancelResult, true, "Cancel should succeed for owner");

  await run.promise;
  assert.equal(run.status, "cancelled", "Run status must be cancelled");
  assert.equal(run.abortController.signal.aborted, true, "AbortController must be aborted");

  // IDOR check: Non-owner cannot cancel
  const foreignCancel = await activeChatRunManager.cancelRun(session.id, "different_user_id");
  assert.equal(foreignCancel, false, "Non-owner should not be able to cancel");
});

test("Decoupled AI Session: Timeout Watchdog automatically aborts hung agent", async (t) => {
  const tenant = await createTestTenant(prisma, "watchdog");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "超时守护测试",
      contextType: "general",
    },
  });

  // Hanging streamFn that never returns until aborted via opts.signal
  const hangingStreamFn: any = async (_m: any, _c: any, opts: any) => {
    return new Promise((_, reject) => {
      if (opts?.signal?.aborted) {
        const err = new Error("Aborted by watchdog");
        err.name = "AbortError";
        reject(err);
        return;
      }
      opts?.signal?.addEventListener("abort", () => {
        const err = new Error("Aborted by watchdog");
        err.name = "AbortError";
        reject(err);
      });
    });
  };

  const faux = createFauxCore({ models: [{ id: "test-model" }] });

  const run = activeChatRunManager.startRun({
    sessionId: session.id,
    userId: tenant.userId,
    baby,
    promptText: "模拟卡死的请求",
    systemPrompt: "测试助手",
    history: [],
    sessionMeta: { id: session.id, title: session.title, contextType: session.contextType },
    model: faux.getModel(),
    streamFn: hangingStreamFn,
    getApiKey: () => "mock-key",
    timeoutMs: 100, // Short timeout for test
  });

  await run.promise;
  assert.equal(run.status, "failed", "Watchdog timeout must set run status to failed");
  assert.equal(run.abortController.signal.aborted, true, "Watchdog must abort AbortController");

  const timeoutMsg = await prisma.aiChatMessage.findFirst({
    where: { sessionId: session.id, role: "assistant" },
  });
  assert.ok(timeoutMsg, "Watchdog timeout must persist fallback assistant message to database");
  assert.match(timeoutMsg.content, /超时/);
});

test("Decoupled AI Session: Route Handlers End-to-End (POST, GET, Cancel, Session Detail)", async (t) => {
  const tenant = await createTestTenant(prisma, "routes");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([
    fauxAssistantMessage([
      fauxText("路由端到端测试回答成功。"),
    ]),
  ]);
  setTestMockStreamFn(faux.streamSimple, faux.getModel());

  // 1. POST /api/ai/chat with prompt
  const postReq = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: tenant.headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: "宝宝今天喝水情况如何？" }],
      babyId: baby.id,
      contextType: "general",
    }),
  });

  const postRes = await chatPOST(postReq);
  assert.equal(postRes.status, 200);
  assert.equal(postRes.headers.get("Content-Type"), "text/event-stream; charset=utf-8");

  // Read the SSE response stream
  const reader = postRes.body?.getReader();
  const decoder = new TextDecoder();
  let sseText = "";
  let extractedSessionId: string | null = null;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseText += decoder.decode(value, { stream: true });
      for (const line of sseText.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.session?.id) extractedSessionId = data.session.id;
          } catch {}
        }
      }
      if (sseText.includes("[DONE]")) break;
    }
  }

  assert.ok(extractedSessionId, "SSE stream must return session id");

  // Wait for background persistence settle
  await new Promise((r) => setTimeout(r, 200));

  // 2. Verify Prompt-First & Assistant messages in DB
  const messages = await prisma.aiChatMessage.findMany({
    where: { sessionId: extractedSessionId },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.match(messages[1].content, /路由端到端/);

  // 3. GET /api/ai/chat?sessionId=... (status check)
  const getReq = new Request(`http://localhost/api/ai/chat?sessionId=${extractedSessionId}`, {
    method: "GET",
    headers: tenant.headers,
  });
  const getRes = await chatGET(getReq);
  assert.equal(getRes.status, 200);
  const getJson = await getRes.json();
  assert.equal(getJson.active, false);

  // 4. GET /api/ai/sessions/[id]
  const sessionDetailReq = new Request(`http://localhost/api/ai/sessions/${extractedSessionId}`, {
    method: "GET",
    headers: tenant.headers,
  });
  const sessionDetailRes = await sessionGET(sessionDetailReq, {
    params: Promise.resolve({ id: extractedSessionId }),
  });
  assert.equal(sessionDetailRes.status, 200);
  const detailJson = await sessionDetailRes.json();
  assert.equal(detailJson.session.id, extractedSessionId);
  assert.equal(detailJson.session.messages.length, 2);

  // 5. POST /api/ai/chat/cancel on idle session returns success: true, cancelled: false
  const cancelReq = new Request("http://localhost/api/ai/chat/cancel", {
    method: "POST",
    headers: tenant.headers,
    body: JSON.stringify({ sessionId: extractedSessionId }),
  });
  const cancelRes = await cancelPOST(cancelReq);
  assert.equal(cancelRes.status, 200);
  const cancelJson = await cancelRes.json();
  assert.equal(cancelJson.success, true);
  assert.equal(cancelJson.cancelled, false);
});

test("Decoupled AI Session: Concurrent POST on active session returns 409 Conflict", async (t) => {
  const tenant = await createTestTenant(prisma, "conflict");
  t.after(async () => {
    activeChatRunManager.clearAllForTest();
    setTestMockStreamFn(null, null);
    await destroyTestTenant(prisma, tenant.username);
  });

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });

  const session = await prisma.aiChatSession.create({
    data: {
      userId: tenant.userId,
      babyId: baby.id,
      title: "并发冲突测试",
      contextType: "general",
    },
  });

  // Slow stream simulation so session stays active
  const faux = createFauxCore({ models: [{ id: "test-model" }] });
  faux.setResponses([fauxAssistantMessage([fauxText("正在慢速思考...")])]);
  const slowStreamFn: any = async (m: any, c: any, opts: any) => {
    await new Promise((r) => setTimeout(r, 100));
    return faux.streamSimple(m, c, opts);
  };
  setTestMockStreamFn(slowStreamFn, faux.getModel());

  // First POST initiates background run
  const firstReq = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: tenant.headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: "第一条消息" }],
      babyId: baby.id,
      sessionId: session.id,
      contextType: "general",
    }),
  });
  const firstRes = await chatPOST(firstReq);
  assert.equal(firstRes.status, 200);

  // Second concurrent POST to same session while active must return 409 Conflict
  const secondReq = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: tenant.headers,
    body: JSON.stringify({
      messages: [{ role: "user", content: "第二条并发消息" }],
      babyId: baby.id,
      sessionId: session.id,
      contextType: "general",
    }),
  });
  const secondRes = await chatPOST(secondReq);
  assert.equal(secondRes.status, 409, "Concurrent POST while running must return 409 Conflict");
  const secondJson = await secondRes.json();
  assert.equal(secondJson.active, true);
  assert.match(secondJson.error, /正在思考生成中/);

  // Wait for background run to finish
  const activeRun = activeChatRunManager.get(session.id);
  if (activeRun) {
    await activeRun.promise;
  }
});
