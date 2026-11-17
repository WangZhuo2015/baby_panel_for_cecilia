import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { runDailySummaryCron } from "../../lib/cron/daily-summary";
import { GET as getAiDailySummary } from "../../app/api/ai/daily-summary/route";
import { POST as postCronDailySummary } from "../../app/api/cron/daily-summary/route";
import { getLocalDateStr } from "../../lib/date";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

test("End-to-End Daily Summary Journey: Cron Pre-generation -> Instant User Cache Hit -> Invalidation on New Records", async (t) => {
  // 1. Create isolated test tenant
  const tenant = await createTestTenant(prisma, "cron_journey");
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });
  const today = getLocalDateStr();

  // 2. Populate morning care records
  await prisma.feedingRecord.create({
    data: {
      babyId: baby.id,
      recordedById: tenant.userId,
      timestamp: `${today}T08:00:00+08:00`,
      type: "formula",
      amountMl: 150,
      spitUp: false,
    },
  });

  await prisma.sleepRecord.create({
    data: {
      babyId: baby.id,
      recordedById: tenant.userId,
      startTime: `${today}T09:30:00+08:00`,
      endTime: `${today}T10:30:00+08:00`,
      type: "day",
      nightWakingCount: 0,
    },
  });

  await prisma.diaperRecord.create({
    data: {
      babyId: baby.id,
      recordedById: tenant.userId,
      timestamp: `${today}T10:35:00+08:00`,
      type: "pee",
    },
  });

  // Mock global fetch for LLM
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "test_e2e_ai_key";
  let llmCalls = 0;

  globalThis.fetch = async (url: any, opts: any) => {
    if (typeof url === "string" && (url.includes("/chat/completions") || url.includes("/mock-ai"))) {
      llmCalls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify({
                  overallScore: "作息规律 🌟",
                  overallRating: 4.9,
                  statusLevel: "excellent",
                  headline: `第${llmCalls}次生成：上午作息非常规律，各项指标达标！`,
                  highlights: ["奶量充沛", "小睡安稳", "排尿正常"],
                  sections: {
                    feeding: "早间奶量150ml充足。",
                    sleep: "上午小睡1小时，作息规律。",
                    diaper: "排尿正常。",
                    growthAndCare: "精神状态佳。",
                    tomorrowTips: "继续保持当前节奏。",
                  },
                  suggestedQuestions: ["下午建议几点小睡？"],
                })}\n\`\`\``,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return originalFetch(url, opts);
  };

  try {
    // --------------------------------------------------------------------------
    // Step 1: Background Cron runs (e.g. at 12:00 or 00:05 via scheduled timer)
    // --------------------------------------------------------------------------
    console.log("-> [Step 1] Running background scheduled cron task...");
    const cronResults = await runDailySummaryCron({
      babyId: baby.id,
      todayOnly: true,
      forceRefresh: true,
    });

    assert.equal(cronResults.length, 1, "Cron should process the baby");
    assert.equal(cronResults[0].babyId, baby.id);
    assert.equal(cronResults[0].isAiGenerated, true, "Summary should be AI-generated");
    assert.equal(llmCalls, 1, "LLM must be called exactly once during cron pre-generation");

    // Verify persistence in AiArchive
    const cacheKey = `ai_daily_summary_${baby.id}_${today}`;
    const archived = await prisma.aiArchive.findFirst({
      where: { kind: "output_json", content: { startsWith: `{"_cacheKey":"${cacheKey}"` } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(archived, "Pre-generated summary must be saved in AiArchive table");
    assert.ok(archived.content, "Pre-generated summary must contain JSON content");
    const parsedArchived = JSON.parse(archived.content);
    assert.equal(parsedArchived.summary.headline, "第1次生成：上午作息非常规律，各项指标达标！");

    // --------------------------------------------------------------------------
    // Step 2: User clicks into the Daily Summary page in the UI
    // --------------------------------------------------------------------------
    console.log("-> [Step 2] Simulating user opening /daily-summary page...");
    const userReq = new Request(`http://localhost:3000/api/ai/daily-summary?babyId=${baby.id}&date=${today}`, {
      headers: {
        Authorization: `Bearer ${tenant.token}`,
      },
    });

    const userRes = await getAiDailySummary(userReq);
    assert.equal(userRes.status, 200, "User request must succeed with 200");
    const userData = await userRes.json();
    assert.ok(userData.summary, "Must return summary object");
    assert.equal(userData.summary.headline, "第1次生成：上午作息非常规律，各项指标达标！");
    assert.equal(userData.summary.metrics.feedingCount, 1);
    assert.equal(userData.summary.metrics.totalFeedingMl, 150);

    // CRITICAL ASSERTION: llmCalls MUST STILL BE 1!
    assert.equal(
      llmCalls,
      1,
      "Zero additional LLM calls when user visits: Pre-generated summary must be served directly from cache!"
    );

    // --------------------------------------------------------------------------
    // Step 3: Afternoon arrives, new records added (stale cache detection)
    // --------------------------------------------------------------------------
    console.log("-> [Step 3] Adding afternoon feeding record (180ml)...");
    await prisma.feedingRecord.create({
      data: {
        babyId: baby.id,
        recordedById: tenant.userId,
        timestamp: `${today}T14:30:00+08:00`,
        type: "formula",
        amountMl: 180,
        spitUp: false,
      },
    });

    console.log("-> [Step 3] User re-visits page: stale cache automatically refreshes...");
    const userReqAfternoon = new Request(
      `http://localhost:3000/api/ai/daily-summary?babyId=${baby.id}&date=${today}`,
      {
        headers: { Authorization: `Bearer ${tenant.token}` },
      }
    );
    const userResAfternoon = await getAiDailySummary(userReqAfternoon);
    assert.equal(userResAfternoon.status, 200);
    const userDataAfternoon = await userResAfternoon.json();
    assert.equal(userDataAfternoon.summary.headline, "第2次生成：上午作息非常规律，各项指标达标！");
    assert.equal(userDataAfternoon.summary.metrics.feedingCount, 2, "Must show 2 feedings now");
    assert.equal(userDataAfternoon.summary.metrics.totalFeedingMl, 330, "Total ml must be 150 + 180 = 330");
    assert.equal(llmCalls, 2, "Must have called LLM for fresh synthesis due to updated records");

    // --------------------------------------------------------------------------
    // Step 4: User refreshes page again without new records -> Cache Hit!
    // --------------------------------------------------------------------------
    console.log("-> [Step 4] User refreshes page again with unchanged data -> Cache Hit!");
    const userReqRepeat = new Request(
      `http://localhost:3000/api/ai/daily-summary?babyId=${baby.id}&date=${today}`,
      {
        headers: { Authorization: `Bearer ${tenant.token}` },
      }
    );
    const userResRepeat = await getAiDailySummary(userReqRepeat);
    assert.equal(userResRepeat.status, 200);
    assert.equal(llmCalls, 2, "No LLM call on repeat visit with same data!");

    // --------------------------------------------------------------------------
    // Step 5: Test POST /api/cron/daily-summary (Systemd Timer Trigger)
    // --------------------------------------------------------------------------
    console.log("-> [Step 5] Testing POST /api/cron/daily-summary via localhost...");
    const cronPostReq = new Request("http://localhost:3000/api/cron/daily-summary", {
      method: "POST",
      headers: {
        "x-forwarded-for": "127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        babyId: baby.id,
        todayOnly: true,
        force: true,
      }),
    });
    const cronPostRes = await postCronDailySummary(cronPostReq);
    assert.equal(cronPostRes.status, 200);
    const cronPostData = await cronPostRes.json();
    assert.equal(cronPostData.success, true);
    assert.equal(cronPostData.count, 1);
    assert.equal(cronPostData.successCount, 1);
    assert.equal(llmCalls, 3, "Forced refresh via cron endpoint triggers new synthesis");

    console.log("-> ✅ All steps in Daily Summary Journey verified successfully!");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_API_KEY = originalApiKey;
  }
});
