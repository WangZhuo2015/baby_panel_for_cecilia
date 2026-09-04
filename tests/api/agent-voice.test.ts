import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { signAuthToken } from "../../lib/auth";
import { POST } from "../../app/api/agent/voice/route";
import { setTestMockStreamFn } from "../../lib/agent";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

test("Voice Agent MVP API: /api/agent/voice", async () => {
  const timestamp = Date.now();
  const testUsername = `test_${timestamp}_voice_user`;

  // 1. Setup isolated test user and baby
  const testFamily = await prisma.family.create({
    data: {
      name: `test_family_${timestamp}`,
      inviteCode: `TV${timestamp.toString().slice(-4)}`,
      babies: {
        create: {
          nickname: `test_baby_${timestamp}`,
          gender: "female",
          birthDate: "2025-06-01",
        },
      },
    },
    include: { babies: true },
  });

  const testBaby = testFamily.babies[0];

  const testUser = await prisma.user.create({
    data: {
      username: testUsername,
      passwordHash: "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.PxHqXn5rJQWvFPGf1PVLfZGmOB7a",
      displayName: "Test Voice Parent",
      memberships: {
        create: {
          familyId: testFamily.id,
          role: "admin",
          relation: "mother",
        },
      },
    },
  });

  const validToken = await signAuthToken({
    userId: testUser.id,
    username: testUser.username,
  });

  const originalEnvSecret = process.env.VOICE_MVP_SECRET;
  const originalEnvUser = process.env.VOICE_MVP_USER_ID;
  const originalEnvBaby = process.env.VOICE_MVP_BABY_ID;

  const mvpSecret = "voice_mvp_test_secret_abc123";
  process.env.VOICE_MVP_SECRET = mvpSecret;
  process.env.VOICE_MVP_USER_ID = testUser.id;
  process.env.VOICE_MVP_BABY_ID = testBaby.id;

  try {
    // -------------------------------------------------------------------------
    // Test 1: Validation - missing body / missing text (HTTP 400)
    // -------------------------------------------------------------------------
    console.log("-> Test 1: Missing text validation...");
    const resEmpty = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      })
    );
    assert.equal(resEmpty.status, 400);
    const jsonEmpty = await resEmpty.json();
    assert.equal(jsonEmpty.success, false);
    assert.equal(jsonEmpty.error, "text is required");

    // -------------------------------------------------------------------------
    // Test 2: Validation - whitespace only text (HTTP 400)
    // -------------------------------------------------------------------------
    console.log("-> Test 2: Whitespace text validation...");
    const resWhitespace = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "    " }),
      })
    );
    assert.equal(resWhitespace.status, 400);
    const jsonWhitespace = await resWhitespace.json();
    assert.equal(jsonWhitespace.success, false);
    assert.equal(jsonWhitespace.error, "text is required");

    // -------------------------------------------------------------------------
    // Test 3: Unauthorized request (HTTP 401)
    // -------------------------------------------------------------------------
    console.log("-> Test 3: Unauthorized without token or secret...");
    const resUnauth = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "宝宝今天喝了多少奶？" }),
      })
    );
    assert.equal(resUnauth.status, 401);
    const jsonUnauth = await resUnauth.json();
    assert.equal(jsonUnauth.success, false);

    // -------------------------------------------------------------------------
    // Test 4: Natural Language Query via Standard PWA Auth Token
    // -------------------------------------------------------------------------
    console.log("-> Test 4: Query via standard PWA Token...");
    const resQuery = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: "宝宝今天喝了多少奶？" }),
      })
    );
    assert.equal(resQuery.status, 200);
    const jsonQuery = await resQuery.json();
    assert.equal(jsonQuery.success, true);
    assert.ok(typeof jsonQuery.reply === "string" && jsonQuery.reply.length > 0);
    assert.ok(!jsonQuery.reply.includes("```json:action"), "Should not contain raw action code blocks");
    console.log("   Query Reply:", jsonQuery.reply);

    // -------------------------------------------------------------------------
    // Test 5: Natural Language Write via VOICE_MVP_SECRET
    // -------------------------------------------------------------------------
    console.log("-> Test 5: Write feeding record via VOICE_MVP_SECRET...");
    const fauxWrite = createFauxCore({ models: [{ id: "mock-model" }] });
    fauxWrite.setResponses([
      fauxAssistantMessage([
        fauxToolCall("record_feeding", { type: "formula", amountMl: 120 }),
      ]),
      fauxAssistantMessage([fauxText("好的，已为宝宝记录喝了120毫升配方奶。")]),
    ]);
    setTestMockStreamFn(fauxWrite.streamSimple, fauxWrite.getModel());

    const resWrite = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mvpSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "宝宝刚刚喝了120毫升配方奶",
          timeoutMs: 60000,
        }),
      })
    );
    assert.equal(resWrite.status, 200);
    const jsonWrite = await resWrite.json();
    assert.equal(jsonWrite.success, true);
    assert.ok(typeof jsonWrite.reply === "string" && jsonWrite.reply.length > 0);
    console.log("   Write Reply:", jsonWrite.reply);

    // Verify DB record creation
    const feedingRecord = await prisma.feedingRecord.findFirst({
      where: { babyId: testBaby.id },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(feedingRecord, "Feeding record must be created in DB");
    assert.equal(feedingRecord.amountMl, 120);

    // -------------------------------------------------------------------------
    // Test 6: Incomplete information scenario (should ask for clarification)
    // -------------------------------------------------------------------------
    console.log("-> Test 6: Incomplete information follow-up...");
    const fauxIncomplete = createFauxCore({ models: [{ id: "mock-model" }] });
    fauxIncomplete.setResponses([
      fauxAssistantMessage([fauxText("宝宝喝了多少毫升配方奶呢？还是母乳亲喂？")]),
    ]);
    setTestMockStreamFn(fauxIncomplete.streamSimple, fauxIncomplete.getModel());

    const resIncomplete = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "宝宝喝奶了",
          timeoutMs: 60000,
        }),
      })
    );
    assert.equal(resIncomplete.status, 200);
    const jsonIncomplete = await resIncomplete.json();
    assert.equal(jsonIncomplete.success, true);
    assert.ok(typeof jsonIncomplete.reply === "string" && jsonIncomplete.reply.length > 0);
    console.log("   Incomplete Info Clarification:", jsonIncomplete.reply);

    // -------------------------------------------------------------------------
    // Test 7: Configurable Timeout Race (immediate fallback on low timeout)
    // -------------------------------------------------------------------------
    console.log("-> Test 7: Configurable Timeout Race (10ms timeout)...");
    const fauxTimeout = createFauxCore({ models: [{ id: "mock-model" }] });
    fauxTimeout.setResponses([
      fauxAssistantMessage([fauxText("建议适量温水擦浴，注意观察宝宝精神状态。")]),
    ]);
    const slowStreamSimple = async (...args: Parameters<typeof fauxTimeout.streamSimple>) => {
      await new Promise((r) => setTimeout(r, 60));
      return fauxTimeout.streamSimple(...args);
    };
    setTestMockStreamFn(slowStreamSimple, fauxTimeout.getModel());

    const resTimeout = await POST(
      new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "宝宝发烧了有什么物理降温方法？",
          timeoutMs: 10,
          timeoutReply: "正在后台为您加速计算，稍后将通过通知发送给您。",
        }),
      })
    );
    assert.equal(resTimeout.status, 200);
    const jsonTimeout = await resTimeout.json();
    assert.equal(jsonTimeout.success, true);
    assert.equal(jsonTimeout.async, true);
    assert.equal(jsonTimeout.reply, "正在后台为您加速计算，稍后将通过通知发送给您。");
    console.log("   Timeout Fallback Reply:", jsonTimeout.reply);

    // Allow background async task to safely write voice log before cleanup
    await new Promise((r) => setTimeout(r, 400));

  } finally {
    setTestMockStreamFn(null);
    // Restore environment variables
    process.env.VOICE_MVP_SECRET = originalEnvSecret;
    process.env.VOICE_MVP_USER_ID = originalEnvUser;
    process.env.VOICE_MVP_BABY_ID = originalEnvBaby;

    // Cleanup test data to prevent database pollution
    console.log("-> Cleaning up test user and family data...");
    await prisma.user.deleteMany({
      where: { username: testUsername },
    });
    await prisma.family.deleteMany({
      where: { id: testFamily.id },
    });
  }
});
