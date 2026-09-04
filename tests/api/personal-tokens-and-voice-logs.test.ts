import dotenv from "dotenv";
dotenv.config();
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../lib/prisma";
import {
  createPersonalAccessToken,
  verifyPersonalAccessToken,
  revokePersonalAccessToken,
  listPersonalAccessTokens,
} from "../../lib/tokens";
import { POST as voicePost } from "../../app/api/agent/voice/route";
import { GET as logsGet } from "../../app/api/agent/voice/logs/route";
import { PATCH as logPatch } from "../../app/api/agent/voice/logs/[id]/route";

test("Personal Access Tokens & Agent Voice Logs Lifecycle", async (t) => {
  const timestamp = Date.now();
  const testUsername = `test_token_user_${timestamp}`;
  const testFamilyName = `test_family_${timestamp}`;
  const testBabyName = `test_baby_${timestamp}`;

  // 1. Setup isolated test user, family and baby
  const testUser = await prisma.user.create({
    data: {
      username: testUsername,
      passwordHash: "dummy_hash",
      displayName: "Test Token Parent",
      memberships: {
        create: {
          role: "admin",
          relation: "father",
          family: {
            create: {
              name: testFamilyName,
              inviteCode: `TEST_${timestamp}`,
              babies: {
                create: {
                  nickname: testBabyName,
                  gender: "female",
                  birthDate: "2024-01-01",
                },
              },
            },
          },
        },
      },
    },
    include: {
      memberships: {
        include: {
          family: {
            include: { babies: true },
          },
        },
      },
    },
  });

  const testBaby = testUser.memberships[0].family.babies[0];

  t.after(async () => {
    // Cleanup test user and cascade-deleted data
    await prisma.user.deleteMany({
      where: { username: testUsername },
    });
  });

  await t.test("1. Create and verify personal access token", async () => {
    const created = await createPersonalAccessToken(testUser.id, "测试 iPhone");
    assert.ok(created.id);
    assert.ok(created.token.startsWith("bp_pat_"));
    assert.equal(created.name, "测试 iPhone");

    const verified = await verifyPersonalAccessToken(created.token);
    assert.ok(verified);
    assert.equal(verified?.user.id, testUser.id);
    assert.equal(verified?.user.username, testUsername);

    const list = await listPersonalAccessTokens(testUser.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, created.id);
    // 新契约：列表只给 hint（前后缀），绝不含原文
    assert.ok(list[0].maskedToken.startsWith("bp_pat_"));
    assert.ok(list[0].maskedToken.endsWith(created.token.slice(-4)));
    assert.ok(!list[0].maskedToken.includes(created.token.slice(10, -4)));
  });

  await t.test("2. Call /api/agent/voice using Personal Access Token (No .env needed)", async () => {
    try {
      const created = await createPersonalAccessToken(testUser.id, "Siri 专属");

      const req = new Request("http://localhost:3000/api/agent/voice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${created.token}`,
        },
        body: JSON.stringify({
          text: "宝宝今天喝了多少奶？",
        }),
      });

      const res = await voicePost(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.fastPath, true);
      assert.ok(data.reply.includes(testBabyName));

      // Verify AgentVoiceLog was created in DB
      const logs = await prisma.agentVoiceLog.findMany({
        where: { userId: testUser.id },
      });
      assert.ok(logs.length >= 1);
      const latestLog = logs[logs.length - 1];
      assert.equal(latestLog.babyId, testBaby.id);
      assert.equal(latestLog.prompt, "宝宝今天喝了多少奶？");
    } catch (e) {
      console.error("Test 2 error:", e);
      throw e;
    }
  });

  await t.test("3. Async Voice Log retrieval and acknowledge", async () => {
    try {
      // Manually create an unacknowledged async voice log to test popup flow
      const asyncLog = await prisma.agentVoiceLog.create({
        data: {
          userId: testUser.id,
          babyId: testBaby.id,
          prompt: "今天睡觉了",
          reply: "好的，请问是刚入睡还是已经睡醒了？",
          isAsync: true,
          isFastPath: false,
          acknowledged: false,
        },
      });

      // Mock authenticated request to GET /api/agent/voice/logs?unreadAsync=true
      const { signAuthToken } = await import("../../lib/auth");
      const token = await signAuthToken({ userId: testUser.id, username: testUser.username });

      const reqGet = new Request("http://localhost:3000/api/agent/voice/logs?unreadAsync=true", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const resGet = await logsGet(reqGet);
      assert.equal(resGet.status, 200);
      const dataGet = await resGet.json();
      assert.equal(dataGet.success, true);
      assert.ok(dataGet.unreadLog);
      assert.equal(dataGet.unreadLog.id, asyncLog.id);
      assert.equal(dataGet.unreadLog.prompt, "今天睡觉了");

      // Test PATCH acknowledge
      const reqPatch = new Request(`http://localhost:3000/api/agent/voice/logs/${asyncLog.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ acknowledged: true }),
      });

      const resPatch = await logPatch(reqPatch, { params: Promise.resolve({ id: asyncLog.id }) });
      assert.equal(resPatch.status, 200);

      // Verify it is no longer returned as unreadAsync
      const resGetAfter = await logsGet(reqGet);
      const dataGetAfter = await resGetAfter.json();
      assert.equal(dataGetAfter.unreadLog, null);
    } catch (e) {
      console.error("Test 3 error:", e);
      throw e;
    }
  });

  await t.test("4. Revoke token and verify access is denied", async () => {
    const created = await createPersonalAccessToken(testUser.id, "即将删除的令牌");
    const ok = await revokePersonalAccessToken(testUser.id, created.id);
    assert.equal(ok, true);

    const verified = await verifyPersonalAccessToken(created.token);
    assert.equal(verified, null);

    // Calling voice API with revoked token must return 401
    const req = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${created.token}`,
      },
      body: JSON.stringify({ text: "宝宝今天喝了多少奶？" }),
    });

    const res = await voicePost(req);
    assert.equal(res.status, 401);
  });
});
