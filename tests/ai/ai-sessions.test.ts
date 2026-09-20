import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

const BASE_URL = process.env.TEST_BASE_URL?.trim() || "http://127.0.0.1:3089";

test("AI Sessions: Session lifecycle, persistence, rename, and deletion", async (t) => {
  let sessionId: string | null = null;
  const tenant = await createTestTenant(prisma, "aisessions");
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const headers = tenant.headers;

  try {
    // Check if test server is running and accepts this test tenant
    const isReachable = await fetch(`${BASE_URL}/api/auth/me`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(1500),
    }).then(async (r) => {
      if (!r.ok) return false;
      const data = await r.json().catch(() => ({}));
      return Boolean(data?.user?.id);
    }).catch(() => false);

    if (!isReachable) {
      console.log(`[AI Sessions Test] Local test server at ${BASE_URL} is offline or incompatible. Skipping live HTTP roundtrip.`);
      return;
    }

    // 1. Create Session
    console.log("-> Testing Create Session API...");
    const createRes = await fetch(`${BASE_URL}/api/ai/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "宝宝辅食过敏咨询测试",
        contextType: "food",
      }),
    });
    assert.equal(createRes.status, 200, "POST /api/ai/sessions should succeed");
    const createData = await createRes.json();
    sessionId = createData.session.id;
    const sessionBabyId = createData.session.babyId;
    assert.ok(sessionId, "Created session should have an ID");
    assert.ok(sessionBabyId, "Created session should be bound to the default baby");

    // A session must not be readable through a different domain scope.
    const mismatchedScopeRes = await fetch(
      `${BASE_URL}/api/ai/sessions/${sessionId}?babyId=${encodeURIComponent(sessionBabyId)}&contextType=vaccine`,
      { headers },
    );
    assert.equal(mismatchedScopeRes.status, 409, "Session scope mismatch should be rejected");

    // 2. Chat with Session and Stream persistence
    console.log("-> Testing Chat Stream with Session persistence...");
    const chatRes = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId,
        contextType: "food",
        messages: [
          { role: "user", content: "宝宝第一次添加西蓝花需要注意什么？" }
        ],
      }),
    });
    assert.equal(chatRes.status, 200, "POST /api/ai/chat should succeed");

    const reader = chatRes.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("[DONE]")) break;
      }
    }

    // Small settle delay for async DB message writes
    await new Promise((r) => setTimeout(r, 600));

    // 3. Fetch Session Detail with Messages
    console.log("-> Testing Session Detail API...");
    const detailRes = await fetch(`${BASE_URL}/api/ai/sessions/${sessionId}`, { headers });
    assert.equal(detailRes.status, 200, "GET /api/ai/sessions/[id] should succeed");
    const detailData = await detailRes.json();
    assert.equal(detailData.session.id, sessionId);
    assert.ok(detailData.session.messages.length >= 2, "Session should persist at least user + assistant messages");

    // 4. List User Sessions
    console.log("-> Testing List Sessions API...");
    const listRes = await fetch(`${BASE_URL}/api/ai/sessions`, { headers });
    assert.equal(listRes.status, 200, "GET /api/ai/sessions should succeed");
    const listData = await listRes.json();
    assert.ok(listData.sessions.some((s: any) => s.id === sessionId));

    // 5. Rename Session
    console.log("-> Testing Rename Session API...");
    const patchRes = await fetch(`${BASE_URL}/api/ai/sessions/${sessionId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "【已改名】西蓝花添加指南" }),
    });
    assert.equal(patchRes.status, 200);
    const patchData = await patchRes.json();
    assert.equal(patchData.session.title, "【已改名】西蓝花添加指南");

    // 6. Delete Session
    console.log("-> Testing Delete Session API...");
    const deleteRes = await fetch(`${BASE_URL}/api/ai/sessions/${sessionId}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(deleteRes.status, 200);

    const check404Res = await fetch(`${BASE_URL}/api/ai/sessions/${sessionId}`, { headers });
    assert.equal(check404Res.status, 404, "Deleted session should return 404");
  } finally {
    if (sessionId) {
      await prisma.aiChatSession.delete({ where: { id: sessionId } }).catch(() => {});
    }
  }
});
