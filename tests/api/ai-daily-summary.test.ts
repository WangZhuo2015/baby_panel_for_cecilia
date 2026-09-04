import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import {
  fetchDailyComprehensiveMetrics,
  generateCuratedDailySummary,
  generateAiDailySummary,
} from "../../lib/ai-daily-summary";
import { getLocalDateStr, addDays } from "../../lib/date";
import { GET, POST } from "../../app/api/ai/daily-summary/route";
import { signAuthToken } from "../../lib/auth";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

test("AI Daily Summary Service & Metrics Aggregator", async (t) => {
  // 隔离租户：禁止 findFirst 抓取真实用户/宝宝（AGENTS.md）
  const tenant = await createTestTenant(prisma, "summary");
  t.after(() => destroyTestTenant(prisma, tenant.username));
  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });
  const user = { id: tenant.userId, username: tenant.username };

  const today = getLocalDateStr();
  const createdRecordIds: { type: string; id: string }[] = [];

  // Create mock records for today
  const feed = await prisma.feedingRecord.create({
    data: {
      babyId: baby.id,
      recordedById: user.id,
      timestamp: `${today}T08:00:00+08:00`,
      type: "formula",
      amountMl: 160,
      spitUp: false,
      notes: "晨起喝奶",
    },
  });
  createdRecordIds.push({ type: "feeding", id: feed.id });

  const sleep = await prisma.sleepRecord.create({
    data: {
      babyId: baby.id,
      recordedById: user.id,
      startTime: `${today}T13:00:00+08:00`,
      endTime: `${today}T14:30:00+08:00`,
      type: "day",
      nightWakingCount: 0,
      notes: "午睡充足",
    },
  });
  createdRecordIds.push({ type: "sleep", id: sleep.id });

  const diaper = await prisma.diaperRecord.create({
    data: {
      babyId: baby.id,
      recordedById: user.id,
      timestamp: `${today}T09:30:00+08:00`,
      type: "both",
      poopColor: "yellow",
      poopConsistency: "paste",
      notes: "便便金黄软便",
    },
  });
  createdRecordIds.push({ type: "diaper", id: diaper.id });

  const food = await prisma.foodLogRecord.create({
    data: {
      babyId: baby.id,
      recordedById: user.id,
      date: today,
      time: "11:30",
      foods: JSON.stringify(["南瓜米糊", "西兰花泥"]),
      portion: "most",
      acceptance: 5,
      babyState: "happy",
      hasAbnormal: false,
    },
  });
  createdRecordIds.push({ type: "food", id: food.id });

  const suppProduct = await prisma.supplementProduct.create({
    data: {
      familyId: tenant.familyId,
      name: "测试维生素D3",
      brand: "测试品牌",
      dosageForm: "drops",
      unitName: "滴",
      defaultDose: 1,
      nutrientsJson: JSON.stringify({ vitamin_d: { amount: 400, unit: "IU" } }),
      isActive: true,
    },
  });
  if (suppProduct) {
    const supp = await prisma.supplementRecord.create({
      data: {
        babyId: baby.id,
        productId: suppProduct.id,
        recordedById: user.id,
        date: today,
        time: "09:00",
        dose: 1,
        unitName: suppProduct.unitName,
        notes: "D3打卡",
      },
    });
    createdRecordIds.push({ type: "supplement", id: supp.id });
  }

  try {
    // 1. Test fetchDailyComprehensiveMetrics
    console.log("-> Testing fetchDailyComprehensiveMetrics...");
    const metrics = await fetchDailyComprehensiveMetrics({ userId: user.id, babyId: baby.id }, today);
    assert.equal(metrics.date, today);
    assert.ok(metrics.totalFeedingMl >= 160, "Should include at least 160ml formula");
    assert.ok(metrics.feedingCount >= 1, "Should have at least 1 feeding");
    assert.ok(metrics.totalSleepMinutes >= 90, "Should include at least 90m sleep");
    assert.ok(metrics.diaperCount >= 1, "Should have at least 1 diaper record");
    assert.ok(metrics.peeCount >= 1, "Should count pee");
    assert.ok(metrics.poopCount >= 1, "Should count poop");
    assert.ok(metrics.foodCount >= 1, "Should have at least 1 food log");
    assert.ok(metrics.foodsTried.includes("南瓜米糊") || metrics.foodsTried.includes("西兰花泥"), "Should parse food names");

    // 2. Test generateCuratedDailySummary
    console.log("-> Testing generateCuratedDailySummary...");
    const curated = generateCuratedDailySummary(baby, metrics);
    assert.equal(curated.date, today);
    assert.equal(curated.babyName, baby.nickname);
    assert.ok(curated.overallScore.length > 0, "Overall score should not be empty");
    assert.ok(curated.headline.length > 0, "Headline should not be empty");
    assert.ok(Array.isArray(curated.highlights) && curated.highlights.length > 0, "Highlights should be array");
    assert.ok(curated.sections.feeding.length > 0, "Feeding section should exist");
    assert.ok(curated.sections.sleep.length > 0, "Sleep section should exist");
    assert.ok(curated.sections.diaper.length > 0, "Diaper section should exist");
    assert.ok(curated.sections.growthAndCare.length > 0, "Growth section should exist");
    assert.ok(curated.sections.tomorrowTips.length > 0, "Tomorrow tips should exist");
    assert.ok(Array.isArray(curated.suggestedQuestions) && curated.suggestedQuestions.length > 0, "Suggested questions should exist");

    // 3. Test generateAiDailySummary
    console.log("-> Testing generateAiDailySummary...");
    const aiSummary = await generateAiDailySummary({ userId: user.id, babyId: baby.id, baby }, today);
    assert.ok(aiSummary, "AI summary result should be returned");
    assert.equal(aiSummary.babyName, baby.nickname);
    assert.ok(aiSummary.headline.length > 0);

    // 4. Test API GET Route
    console.log("-> Testing GET /api/ai/daily-summary...");
    const token = await signAuthToken({ userId: user.id, username: user.username });
    const authHeaders = { Cookie: `baby_auth_token=${token}` };

    const getReq = new Request(`http://localhost:3000/api/ai/daily-summary?date=${today}&babyId=${baby.id}`, {
      headers: authHeaders,
    });
    const getRes = await GET(getReq);
    assert.equal(getRes.status, 200, "GET route should return status 200");
    const getData = await getRes.json();
    assert.ok(getData.summary, "GET response should contain summary object");
    assert.equal(getData.summary.date, today);

    // 5. Test API POST Route (force refresh)
    console.log("-> Testing POST /api/ai/daily-summary...");
    const postReq = new Request("http://localhost:3000/api/ai/daily-summary", {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ date: today, babyId: baby.id, force: true }),
    });
    const postRes = await POST(postReq);
    assert.equal(postRes.status, 200, "POST route should return status 200");
    const postData = await postRes.json();
    assert.ok(postData.summary, "POST response should contain summary");

    // 6. Test invalid date handling
    console.log("-> Testing invalid date validation...");
    const invalidReq = new Request(`http://localhost:3000/api/ai/daily-summary?date=invalid-date&babyId=${baby.id}`, {
      headers: authHeaders,
    });
    const invalidRes = await GET(invalidReq);
    assert.equal(invalidRes.status, 400, "Invalid date should return status 400");

    // 7. Test LLM generation with mocked successful AI response
    console.log("-> Testing LLM JSON parsing with mock fetch...");
    const originalFetch = globalThis.fetch;
    try {
      const mockLLMJson = {
        overallScore: "作息规律 🌟",
        overallRating: 4.9,
        statusLevel: "excellent",
        headline: "今日宝宝奶量充足，午睡安稳，整体状态非常出色！",
        highlights: ["奶量达标", "午睡1.5小时", "D3已打卡"],
        sections: {
          feeding: "🍼 喂养评估：今日奶量摄入充足，喂养时间规律。",
          sleep: "😴 睡眠评估：昼夜睡眠分布理想，清醒间隔把控适度。",
          diaper: "💩 排便评估：排尿充分，大便金黄软糊。",
          growthAndCare: "📈 生长与补剂：D3已补充，发育稳定。",
          tomorrowTips: "💡 明日建议：可继续保持当前作息，清醒时安排俯卧抬头练习。",
        },
        suggestedQuestions: ["明天几点安排午睡最好？", "辅食需要注意什么？"],
      };

      globalThis.fetch = async (url: any, opts: any) => {
        if (typeof url === "string" && url.includes("/chat/completions")) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: `\`\`\`json\n${JSON.stringify(mockLLMJson)}\n\`\`\``,
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return originalFetch(url, opts);
      };

      const result = await generateAiDailySummary(
        { userId: user.id, babyId: baby.id, baby },
        today,
        { forceRefresh: true }
      );
      assert.ok(result.isAiGenerated, "Result should be marked as AI generated");
      assert.equal(result.overallScore, "作息规律 🌟");
      assert.equal(result.headline, "今日宝宝奶量充足，午睡安稳，整体状态非常出色！");
      assert.equal(result.sections.feeding, "🍼 喂养评估：今日奶量摄入充足，喂养时间规律。");
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    // Clean up created records
    for (const item of createdRecordIds) {
      if (item.type === "feeding") await prisma.feedingRecord.delete({ where: { id: item.id } }).catch(() => {});
      if (item.type === "sleep") await prisma.sleepRecord.delete({ where: { id: item.id } }).catch(() => {});
      if (item.type === "diaper") await prisma.diaperRecord.delete({ where: { id: item.id } }).catch(() => {});
      if (item.type === "food") await prisma.foodLogRecord.delete({ where: { id: item.id } }).catch(() => {});
      if (item.type === "supplement") await prisma.supplementRecord.delete({ where: { id: item.id } }).catch(() => {});
    }
  }
});
