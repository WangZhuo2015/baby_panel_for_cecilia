import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { generateAiDailySummary } from "../../lib/ai-daily-summary";
import { runDailySummaryCron } from "../../lib/cron/daily-summary";
import { GET, POST } from "../../app/api/cron/daily-summary/route";
import { getLocalDateStr, addDays } from "../../lib/date";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

test("Daily Summary Cache Freshness & Scheduled Cron Task", async (t) => {
  // 1. Create isolated test tenant
  const tenant = await createTestTenant(prisma, "cron_summary");
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const baby = await prisma.baby.findUniqueOrThrow({ where: { id: tenant.babyId } });
  const user = { id: tenant.userId, username: tenant.username };
  const today = getLocalDateStr();

  // 2. Add an initial feeding record
  const feed1 = await prisma.feedingRecord.create({
    data: {
      babyId: baby.id,
      recordedById: user.id,
      timestamp: `${today}T08:00:00+08:00`,
      type: "formula",
      amountMl: 150,
      spitUp: false,
    },
  });

  // Mock global fetch for LLM calls
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.AI_API_KEY;
  process.env.AI_API_KEY = "test_mock_ai_key";
  let llmCallCount = 0;
  const mockLLMJson = {
    overallScore: "作息规律 🌟",
    overallRating: 4.8,
    statusLevel: "excellent",
    headline: "宝宝早间奶量充足，状态稳定！",
    highlights: ["奶量达标", "情绪良好"],
    sections: {
      feeding: "早间按时摄入配方奶150ml，消化吸收平稳。",
      sleep: "作息节奏良好。",
      diaper: "排便正常。",
      growthAndCare: "发育稳健。",
      tomorrowTips: "继续保持作息节奏。",
    },
    suggestedQuestions: ["明天几点喝奶最好？"],
  };

  globalThis.fetch = async (url: any, opts: any) => {
    if (typeof url === "string" && (url.includes("/chat/completions") || url.includes("/mock-ai"))) {
      llmCallCount++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `\`\`\`json\n${JSON.stringify({
                  ...mockLLMJson,
                  headline: `LLM调用第${llmCallCount}次：状态良好`,
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
    // 3. First generation (cache miss -> triggers LLM call)
    console.log("-> Testing initial summary generation (cache miss)...");
    const summary1 = await generateAiDailySummary(
      { userId: user.id, babyId: baby.id, baby },
      today,
      { forceRefresh: true }
    );
    assert.ok(summary1.isAiGenerated);
    assert.equal(summary1.metrics.feedingCount, 1);
    assert.equal(llmCallCount, 1, "Should have called LLM once");

    // 4. Second request with unchanged data (cache hit -> no LLM call)
    console.log("-> Testing cache hit with unchanged metrics...");
    const summary2 = await generateAiDailySummary(
      { userId: user.id, babyId: baby.id, baby },
      today,
      { forceRefresh: false }
    );
    assert.ok(summary2.isAiGenerated);
    assert.equal(summary2.metrics.feedingCount, 1);
    assert.equal(llmCallCount, 1, "Should reuse cache without new LLM call");

    // 5. Add a new feeding record (cache stale -> triggers fresh LLM call)
    console.log("-> Testing automatic cache invalidation when new records arrive...");
    await prisma.feedingRecord.create({
      data: {
        babyId: baby.id,
        recordedById: user.id,
        timestamp: `${today}T12:00:00+08:00`,
        type: "formula",
        amountMl: 180,
        spitUp: false,
      },
    });

    const summary3 = await generateAiDailySummary(
      { userId: user.id, babyId: baby.id, baby },
      today,
      { forceRefresh: false }
    );
    assert.ok(summary3.isAiGenerated);
    assert.equal(summary3.metrics.feedingCount, 2, "Feeding count should now be 2");
    assert.equal(llmCallCount, 2, "Should have automatically regenerated due to stale cache");

    // 6. Test runDailySummaryCron directly
    console.log("-> Testing runDailySummaryCron...");
    const cronResults = await runDailySummaryCron({
      babyId: baby.id,
      todayOnly: true,
      forceRefresh: true,
    });
    assert.ok(cronResults.length >= 1, "Should return at least 1 cron result");
    assert.equal(cronResults[0].babyId, baby.id);
    assert.ok(cronResults[0].isAiGenerated);

    // 7. Test Cron API Route authorization
    console.log("-> Testing /api/cron/daily-summary auth & trigger...");
    // Unauthorized request with external IP and wrong secret
    const unauthReq = new Request("http://localhost:3000/api/cron/daily-summary", {
      headers: {
        "x-forwarded-for": "203.0.113.1",
        Authorization: "Bearer wrong_secret",
      },
    });
    const unauthRes = await GET(unauthReq);
    assert.equal(unauthRes.status, 401, "External unauthorized request should be 401");

    // Localhost request (loopback allowed when no CRON_SECRET is set)
    const localReq = new Request(`http://localhost:3000/api/cron/daily-summary?babyId=${baby.id}&todayOnly=1`, {
      headers: {
        "x-forwarded-for": "127.0.0.1",
      },
    });
    const localRes = await GET(localReq);
    assert.equal(localRes.status, 200, "Localhost request should be 200");
    const localData = await localRes.json();
    assert.ok(localData.success);
    assert.ok(localData.count >= 1);
    assert.equal(localData.successCount, localData.count);
    // Ensure PII (babyName, headline) is stripped from response
    assert.equal(localData.results[0].babyName, undefined, "babyName must not be exposed in cron response");
    assert.equal(localData.results[0].headline, undefined, "headline must not be exposed in cron response");
    assert.ok(localData.results[0].babyId, "babyId should be present");

    // Test strict CRON_SECRET enforcement when secret is configured
    const origCronSecret = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "test_cron_secret_key_123";

      // 1) Localhost request without secret must be rejected (no loopback bypass when secret is set)
      const secretBypassReq = new Request(`http://localhost:3000/api/cron/daily-summary?babyId=${baby.id}`, {
        headers: { "x-forwarded-for": "127.0.0.1" },
      });
      const bypassRes = await GET(secretBypassReq);
      assert.equal(bypassRes.status, 401, "Should reject unauthenticated request when CRON_SECRET is set");

      // 2) Valid Bearer secret request must be accepted
      const authorizedReq = new Request(`http://localhost:3000/api/cron/daily-summary?babyId=${baby.id}&todayOnly=1`, {
        headers: {
          Authorization: "Bearer test_cron_secret_key_123",
          "x-forwarded-for": "203.0.113.5",
        },
      });
      const authRes = await GET(authorizedReq);
      assert.equal(authRes.status, 200, "Should accept request with valid CRON_SECRET Bearer header");
    } finally {
      if (origCronSecret !== undefined) {
        process.env.CRON_SECRET = origCronSecret;
      } else {
        delete process.env.CRON_SECRET;
      }
    }

    // POST route test with localhost
    const postReq = new Request("http://localhost:3000/api/cron/daily-summary", {
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
    const postRes = await POST(postReq);
    assert.equal(postRes.status, 200, "POST request should return 200");
    const postData = await postRes.json();
    assert.ok(postData.success);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.AI_API_KEY = originalApiKey;
  }
});
