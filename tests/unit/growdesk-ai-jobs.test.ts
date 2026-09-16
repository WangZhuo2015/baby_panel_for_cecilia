import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { remoteAiStateCases } from "./growdesk-remote-state-cases";


import {
  getFoodsData,
  getMilestonesData,
  getWarningSignsData,
  getBooksData,
  getActivitiesData,
  getVaccinesData,
} from "../../lib/growdesk/knowledge";
import {
  summaryMemoryCache,
  generateCuratedDailySummary,
  fetchDailyComprehensiveMetrics,
} from "../../lib/ai-daily-summary";
import { dayBoundsInTimeZone } from "../../lib/growdesk/record-list";
import { detectVoiceQueryIntent, tryVoiceFastPath } from "../../lib/agent/voice-fast-path";

test("Issue #4: GrowDesk AI Sessions, Jobs, Voice Logs, Knowledge & Daily Summary", async (t) => {
  beforeEach(() => {
    summaryMemoryCache.clear();
  });

  afterEach(() => {
    summaryMemoryCache.clear();
  });

  // State-machine/SQL isolation cases now live in the backend real PostgreSQL suite.
  // Here validate the actual stateless Web transport, including failure propagation.
  await remoteAiStateCases(t);

  await t.test("5. Knowledge Base: Singleton loading & integrity of curated pediatric datasets", async () => {
    const foods = getFoodsData();
    assert.ok(Array.isArray(foods));
    assert.ok(foods.length > 0);

    const milestones = getMilestonesData();
    assert.ok(Array.isArray(milestones));
    assert.ok(milestones.length > 0);

    const warningSigns = getWarningSignsData();
    assert.ok(Array.isArray(warningSigns));

    const books = getBooksData();
    assert.ok(Array.isArray(books));
    assert.ok(books.length > 0);

    const activities = getActivitiesData();
    assert.ok(Array.isArray(activities));

    const vaccines = getVaccinesData();
    assert.ok(Array.isArray(vaccines.entries));
    assert.ok(Array.isArray(vaccines.vaccines));

    // Verify cache stability: second call returns same array instance
    assert.equal(getFoodsData(), foods);
  });

  await t.test("6. Daily Summary: Rule-based curated summary & Timezone Bounds", async () => {
    // 1. Test dayBoundsInTimeZone for Shanghai timezone
    const bounds = dayBoundsInTimeZone("2026-09-15", "Asia/Shanghai");
    assert.equal(bounds.timeZone, "Asia/Shanghai");
    // Shanghai UTC+8: 2026-09-15 00:00 local is 2026-09-14 16:00:00Z
    assert.equal(bounds.start.toISOString(), "2026-09-14T16:00:00.000Z");
    assert.equal(bounds.end.toISOString(), "2026-09-15T16:00:00.000Z");

    // 2. Generate curated daily summary without LLM
    const mockBaby = {
      id: "baby_curated_1",
      nickname: "小葡萄",
      birthDate: "2026-03-15",
      gender: "female",
    };

    const mockMetrics = {
      date: "2026-09-15",
      totalFeedingMl: 650,
      totalBreastMinutes: 0,
      feedingCount: 4,
      formulaCount: 4,
      breastCount: 0,
      spitUpCount: 0,
      feedings: [],
      totalSleepMinutes: 720,
      daySleepMinutes: 180,
      nightSleepMinutes: 540,
      nightWakingCount: 1,
      sleepCount: 3,
      sleeps: [],
      diaperCount: 6,
      peeCount: 5,
      poopCount: 1,
      poopColors: ["yellow"],
      poopConsistencies: ["paste"],
      diapers: [],
      foodCount: 1,
      foodsTried: ["南瓜泥"],
      foodLogs: [],
      supplementsCount: 1,
      supplements: [],
      hasAbnormal: false,
      growthMeasurement: null,
      medicalReportsCount: 0,
    };

    const curated = generateCuratedDailySummary(mockBaby, mockMetrics as any);
    assert.ok(curated);
    assert.equal(curated.babyName, "小葡萄");
    assert.equal(curated.date, "2026-09-15");
    assert.equal(curated.statusLevel, "excellent");
    assert.ok(curated.highlights.includes("奶量达标充沛"));
    assert.ok(curated.headline.includes("小葡萄"));
    assert.equal(curated.isAiGenerated, false);

    // 3. Test summaryMemoryCache set and get
    const cacheKey = `ai_daily_summary_${mockBaby.id}_2026-09-15`;
    summaryMemoryCache.set(cacheKey, { summary: curated, timestamp: Date.now() });
    assert.ok(summaryMemoryCache.has(cacheKey));
    assert.equal(summaryMemoryCache.get(cacheKey)?.summary.babyName, "小葡萄");
  });

  await t.test("7. Voice Fast Path Intent Detection & Formatting", () => {
    // Intent detection
    const intentFeeding = detectVoiceQueryIntent("宝宝今天喝了多少奶？");
    assert.ok(intentFeeding);
    assert.equal(intentFeeding.domain, "feeding");
    assert.equal(intentFeeding.isLatestOnly, false);

    const intentLatestFeeding = detectVoiceQueryIntent("宝宝上次喂奶是什么时候？");
    assert.ok(intentLatestFeeding);
    assert.equal(intentLatestFeeding.domain, "feeding");
    assert.equal(intentLatestFeeding.isLatestOnly, true);

    const intentSleep = detectVoiceQueryIntent("宝宝今天睡了多久？");
    assert.ok(intentSleep);
    assert.equal(intentSleep.domain, "sleep");

    const intentSummary = detectVoiceQueryIntent("今天宝宝整体情况怎么样？");
    assert.ok(intentSummary);
    assert.equal(intentSummary.domain, "summary");

    const nonVoiceQuery = detectVoiceQueryIntent("给宝宝讲个关于小兔子的故事吧");
    assert.equal(nonVoiceQuery, null);
  });
});
