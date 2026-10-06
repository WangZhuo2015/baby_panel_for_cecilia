import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import {
  detectVoiceQueryIntent,
  formatSpokenTime,
  formatSpokenDuration,
  tryVoiceFastPath,
} from "../../lib/agent/voice-fast-path";
import { POST } from "../../app/api/agent/voice/route";
import { signAuthToken } from "../../lib/auth";

test("Voice Fast-Path Unit Tests: Intent Detection & Formatting", () => {
  // 1. Spoken Time Formatting
  assert.equal(formatSpokenTime("08:53"), "早上8点53分");
  assert.equal(formatSpokenTime("12:00"), "中午12点整");
  assert.equal(formatSpokenTime("14:37"), "下午2点37分");
  assert.equal(formatSpokenTime("21:05"), "晚上9点5分");
  assert.equal(formatSpokenTime("00:15"), "凌晨12点15分");

  // 2. Duration Formatting
  assert.equal(formatSpokenDuration(45), "45分钟");
  assert.equal(formatSpokenDuration(60), "1小时");
  assert.equal(formatSpokenDuration(190), "3小时10分钟");

  // 3. Positive Query Intent Detection
  const q1 = detectVoiceQueryIntent("宝宝今天喝了多少奶？");
  assert.ok(q1);
  assert.equal(q1.domain, "feeding");
  assert.equal(q1.dateLabel, "今天");
  assert.equal(q1.isLatestOnly, false);

  const q2 = detectVoiceQueryIntent("今天睡了几个小时");
  assert.ok(q2);
  assert.equal(q2.domain, "sleep");
  assert.equal(q2.dateLabel, "今天");

  const q3 = detectVoiceQueryIntent("今天拉了几次便便？");
  assert.ok(q3);
  assert.equal(q3.domain, "diaper_poop");

  const q4 = detectVoiceQueryIntent("今天换了几次尿布");
  assert.ok(q4);
  assert.equal(q4.domain, "diaper");

  const q5 = detectVoiceQueryIntent("上次喂奶是什么时候？");
  assert.ok(q5);
  assert.equal(q5.domain, "feeding");
  assert.equal(q5.isLatestOnly, true);

  const q6 = detectVoiceQueryIntent("昨天喝了多少奶");
  assert.ok(q6);
  assert.equal(q6.domain, "feeding");
  assert.equal(q6.dateLabel, "昨天");

  const q7 = detectVoiceQueryIntent("宝宝今天情况怎么样？");
  assert.ok(q7);
  assert.equal(q7.domain, "summary");

  // Query statements containing "记录" / "作息" / "查" / "看" / "怎么样"
  const qFeedRecord1 = detectVoiceQueryIntent("查一下今天的喂奶记录");
  assert.ok(qFeedRecord1);
  assert.equal(qFeedRecord1.domain, "feeding");

  const qFeedRecord2 = detectVoiceQueryIntent("查一下喂奶记录");
  assert.ok(qFeedRecord2);
  assert.equal(qFeedRecord2.domain, "feeding");

  const qFeedRecord3 = detectVoiceQueryIntent("今天的喂奶记录");
  assert.ok(qFeedRecord3);
  assert.equal(qFeedRecord3.domain, "feeding");

  const qSleepRecord = detectVoiceQueryIntent("查看今天的睡眠记录");
  assert.ok(qSleepRecord);
  assert.equal(qSleepRecord.domain, "sleep");

  const qSleepStatus1 = detectVoiceQueryIntent("宝宝醒了吗");
  assert.ok(qSleepStatus1);
  assert.equal(qSleepStatus1.domain, "sleep");
  assert.equal(qSleepStatus1.isLatestOnly, true);

  const qSleepStatus2 = detectVoiceQueryIntent("宝宝还在睡吗");
  assert.ok(qSleepStatus2);
  assert.equal(qSleepStatus2.domain, "sleep");
  assert.equal(qSleepStatus2.isLatestOnly, true);

  const qDiaperQuery = detectVoiceQueryIntent("查一下换尿布");
  assert.ok(qDiaperQuery);
  assert.equal(qDiaperQuery.domain, "diaper");

  const qSummaryRecord1 = detectVoiceQueryIntent("查一下记录");
  assert.ok(qSummaryRecord1);
  assert.equal(qSummaryRecord1.domain, "summary");

  const qSummaryRecord2 = detectVoiceQueryIntent("今天有什么记录");
  assert.ok(qSummaryRecord2);
  assert.equal(qSummaryRecord2.domain, "summary");

  const qSummaryRecord3 = detectVoiceQueryIntent("今天怎么样");
  assert.ok(qSummaryRecord3);
  assert.equal(qSummaryRecord3.domain, "summary");

  const qSummaryRecord4 = detectVoiceQueryIntent("今天的作息");
  assert.ok(qSummaryRecord4);
  assert.equal(qSummaryRecord4.domain, "summary");

  // 4. Negative / Bookkeeping Intent Rejection (Must fall back to Agent)
  assert.equal(detectVoiceQueryIntent("宝宝刚刚喝了120毫升配方奶"), null);
  assert.equal(detectVoiceQueryIntent("喝了150ml"), null);
  assert.equal(detectVoiceQueryIntent("宝宝喝奶了"), null);
  assert.equal(detectVoiceQueryIntent("宝宝睡着了"), null);
  assert.equal(detectVoiceQueryIntent("刚换了尿布"), null);
  assert.equal(detectVoiceQueryIntent("记一下尿布"), null);
  assert.equal(detectVoiceQueryIntent("记录喂奶"), null);
  assert.equal(detectVoiceQueryIntent("记录睡眠"), null);
  assert.equal(detectVoiceQueryIntent("帮我记一下喝奶"), null);
  assert.equal(detectVoiceQueryIntent("打卡"), null);
  assert.equal(detectVoiceQueryIntent("宝宝发烧了该怎么办"), null);
  assert.equal(detectVoiceQueryIntent("吐奶了怎么办"), null);
});

test("Voice Fast-Path Integration with Database (<100ms)", async () => {
  const timestamp = Date.now();
  const testUsername = `test_${timestamp}_fastpath_user`;

  const testFamily = await prisma.family.create({
    data: {
      name: `test_family_${timestamp}`,
      inviteCode: `FP${timestamp.toString().slice(-4)}`,
      babies: {
        create: {
          nickname: `小星星_${timestamp.toString().slice(-4)}`,
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
      displayName: "FastPath Parent",
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

  try {
    // 1. Initially no records
    const emptyReply = await tryVoiceFastPath({
      text: "宝宝今天喝了多少奶？",
      baby: testBaby,
      userId: testUser.id,
    });
    assert.ok(emptyReply);
    assert.ok(emptyReply.includes("还没有记录喝奶数据"));

    // 2. Insert test records today
    const nowIso = new Date().toISOString();
    await prisma.feedingRecord.create({
      data: {
        babyId: testBaby.id,
        type: "formula",
        amountMl: 150,
        timestamp: nowIso,
      },
    });
    await prisma.feedingRecord.create({
      data: {
        babyId: testBaby.id,
        type: "breast",
        leftMinutes: 5,
        rightMinutes: 10,
        timestamp: nowIso,
      },
    });
    await prisma.diaperRecord.create({
      data: {
        babyId: testBaby.id,
        type: "poop",
        timestamp: nowIso,
      },
    });

    // 3. Test Feeding Query via tryVoiceFastPath
    const startFast = Date.now();
    const feedReply = await tryVoiceFastPath({
      text: "宝宝今天喝了多少奶？",
      baby: testBaby,
      userId: testUser.id,
    });
    const feedDuration = Date.now() - startFast;
    console.log(`-> FastPath Feeding executed in ${feedDuration}ms: "${feedReply}"`);
    assert.ok(feedDuration < 100, `Execution should be < 100ms, got ${feedDuration}ms`);
    assert.ok(feedReply?.includes("150毫升配方奶"));
    assert.ok(feedReply?.includes("母乳亲喂了1次（共15分钟）"));

    // 4. Test Diaper Query
    const diaperReply = await tryVoiceFastPath({
      text: "今天拉了几次便便？",
      baby: testBaby,
      userId: testUser.id,
    });
    console.log(`-> FastPath Diaper: "${diaperReply}"`);
    assert.ok(diaperReply?.includes("一共拉了1次便便"));

    // 5. Test Full Route POST /api/agent/voice directly with question
    const req = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "宝宝今天喝了多少奶？" }),
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.equal(json.async, false);
    assert.equal(json.fastPath, true);
    assert.ok(json.reply.includes("150毫升配方奶"));
    console.log(`-> Route POST reply: "${json.reply}"`);

    // 6. Test Query statement with "记录": "查一下今天的喂奶记录"
    const reqRecord = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "查一下今天的喂奶记录" }),
    });
    const resRecord = await POST(reqRecord);
    assert.equal(resRecord.status, 200);
    const jsonRecord = await resRecord.json();
    assert.equal(jsonRecord.success, true);
    assert.equal(jsonRecord.fastPath, true);
    assert.ok(jsonRecord.reply.includes("150毫升配方奶"));
    console.log(`-> Route POST '查一下今天的喂奶记录' reply: "${jsonRecord.reply}"`);

    // 7. Test Summary Query statement: "今天有什么记录"
    const reqSummary = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "今天有什么记录" }),
    });
    const resSummary = await POST(reqSummary);
    assert.equal(resSummary.status, 200);
    const jsonSummary = await resSummary.json();
    assert.equal(jsonSummary.success, true);
    assert.equal(jsonSummary.fastPath, true);
    assert.ok(jsonSummary.reply.includes("概况"));
    console.log(`-> Route POST '今天有什么记录' reply: "${jsonSummary.reply}"`);

    // 8. Test Error handling guarantees spoken reply for Siri TTS
    // A. 401 Unauthorized
    const unauthReq = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "查一下记录" }),
    });
    const unauthRes = await POST(unauthReq);
    assert.equal(unauthRes.status, 401);
    const unauthJson = await unauthRes.json();
    assert.equal(unauthJson.success, false);
    assert.ok(typeof unauthJson.reply === "string" && unauthJson.reply.length > 0);
    assert.equal(unauthJson.reply, "请先在应用中配置有效的语音访问凭证。");

    // B. 400 Empty text
    const emptyReq = new Request("http://localhost:3000/api/agent/voice", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${validToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "" }),
    });
    const emptyRes = await POST(emptyReq);
    assert.equal(emptyRes.status, 400);
    const emptyJson = await emptyRes.json();
    assert.equal(emptyJson.success, false);
    assert.ok(typeof emptyJson.reply === "string" && emptyJson.reply.length > 0);
    assert.equal(emptyJson.reply, "未能听清您的指令，请再说一次。");
  } finally {
    // Cleanup
    await prisma.user.deleteMany({ where: { username: testUsername } });
    await prisma.family.deleteMany({ where: { id: testFamily.id } });
  }
});
