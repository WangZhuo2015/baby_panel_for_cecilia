import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { bffAiSessionStore } from "../../lib/growdesk/ai-sessions";
import { bffAiJobStore } from "../../lib/growdesk/ai-jobs";
import { bffVoiceLogStore } from "../../lib/growdesk/voice-logs";
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
    bffAiSessionStore.clearAllForTest();
    bffAiJobStore.clearAllForTest();
    bffVoiceLogStore.clearAllForTest();
    summaryMemoryCache.clear();
  });

  afterEach(() => {
    bffAiSessionStore.clearAllForTest();
    bffAiJobStore.clearAllForTest();
    bffVoiceLogStore.clearAllForTest();
    summaryMemoryCache.clear();
  });

  await t.test("1. BffAiSessionStore: CRUD, Message Appending, Isolation & Ordering", async () => {
    const userA = "user_test_a";
    const userB = "user_test_b";

    // Create session for user A
    const sessionA1 = await bffAiSessionStore.createSession({
      userId: userA,
      babyId: "baby_1",
      title: "宝宝辅食咨询",
      contextType: "food",
    });

    assert.ok(sessionA1.id);
    assert.equal(sessionA1.userId, userA);
    assert.equal(sessionA1.title, "宝宝辅食咨询");
    assert.equal(sessionA1.contextType, "food");
    assert.equal(sessionA1.messages.length, 0);

    // Create session for user B
    const sessionB = await bffAiSessionStore.createSession({
      userId: userB,
      title: "睡眠倒退期分析",
    });
    assert.equal(sessionB.userId, userB);

    // Isolation: user B cannot access user A's session
    const fetchedByB = await bffAiSessionStore.getSession(sessionA1.id, userB);
    assert.equal(fetchedByB, null);

    // Append messages for user A
    const userMsg = await bffAiSessionStore.addMessage(sessionA1.id, userA, {
      role: "user",
      content: "6个月宝宝可以吃牛油果吗？",
    });
    assert.ok(userMsg);
    assert.equal(userMsg.role, "user");
    assert.equal(userMsg.content, "6个月宝宝可以吃牛油果吗？");

    const assistantMsg = await bffAiSessionStore.addMessage(sessionA1.id, userA, {
      role: "assistant",
      content: "可以的，牛油果富含有益脂肪酸，质地软糯，是非常理想的辅食泥材料。",
    });
    assert.ok(assistantMsg);
    assert.equal(assistantMsg.role, "assistant");

    // Re-fetch session A1
    const refetched = await bffAiSessionStore.getSession(sessionA1.id, userA);
    assert.ok(refetched);
    assert.equal(refetched.messages.length, 2);
    assert.equal(refetched.messages[0].content, "6个月宝宝可以吃牛油果吗？");
    assert.equal(refetched.messages[1].role, "assistant");

    // Update title
    const updated = await bffAiSessionStore.updateSessionTitle(
      sessionA1.id,
      userA,
      "牛油果辅食咨询"
    );
    assert.ok(updated);
    assert.equal(updated.title, "牛油果辅食咨询");

    // List sessions for user A
    const listA = await bffAiSessionStore.listSessions(userA);
    assert.equal(listA.total, 1);
    assert.equal(listA.sessions[0].title, "牛油果辅食咨询");
    assert.equal(listA.sessions[0].messageCount, 2);
    assert.ok(listA.sessions[0].lastMessage);
    assert.equal(listA.sessions[0].lastMessage.role, "assistant");

    // User B list should only contain B's session
    const listB = await bffAiSessionStore.listSessions(userB);
    assert.equal(listB.total, 1);
    assert.equal(listB.sessions[0].id, sessionB.id);

    // Delete session
    const deletedByWrongUser = await bffAiSessionStore.deleteSession(sessionA1.id, userB);
    assert.equal(deletedByWrongUser, false);

    const deleted = await bffAiSessionStore.deleteSession(sessionA1.id, userA);
    assert.equal(deleted, true);

    const afterDelete = await bffAiSessionStore.getSession(sessionA1.id, userA);
    assert.equal(afterDelete, null);
  });

  await t.test("2. BffAiJobStore: 5-State Machine, Cancellation, Retry & Idempotency", async () => {
    const userA = "user_job_a";
    const userB = "user_job_b";

    // 1. Create job with idempotencyKey
    const job1 = bffAiJobStore.createJob({
      userId: userA,
      familyId: "fam_1",
      babyId: "baby_1",
      type: "medical_report",
      idempotencyKey: "idem_report_123",
      imageUrl: "data:image/jpeg;base64,mock",
    });

    assert.ok(job1.id);
    assert.equal(job1.userId, userA);
    assert.equal(job1.status, "running");
    assert.equal(job1.attempt, 1);
    assert.equal(job1.claimed, false);

    // Idempotent duplicate create returns existing job
    const jobDup = bffAiJobStore.createJob({
      userId: userA,
      type: "medical_report",
      idempotencyKey: "idem_report_123",
    });
    assert.equal(jobDup.id, job1.id);

    // Isolation: user B cannot see or manipulate user A's job
    assert.equal(bffAiJobStore.getJob(job1.id, userB), null);
    assert.equal(bffAiJobStore.cancelJob(job1.id, userB), false);

    // 2. Update job status to succeeded
    const updatedJob = bffAiJobStore.updateJob(job1.id, userA, {
      status: "succeeded",
      resultJson: JSON.stringify({ diagnosis: "小儿湿疹", severity: "mild" }),
    });
    assert.ok(updatedJob);
    assert.equal(updatedJob.status, "succeeded");
    assert.ok(updatedJob.finishedAt);
    assert.equal(updatedJob.resultJson?.includes("小儿湿疹"), true);

    // Verify pendingClaim count
    const list1 = bffAiJobStore.listJobs(userA);
    assert.equal(list1.pendingClaim, 1);
    assert.equal(list1.jobs.length, 1);

    // Claim job
    assert.equal(bffAiJobStore.claimJob(job1.id, userA), true);
    const listAfterClaim = bffAiJobStore.listJobs(userA);
    assert.equal(listAfterClaim.pendingClaim, 0);

    // 3. Test cancellation
    const job2 = bffAiJobStore.createJob({
      userId: userA,
      type: "food_plate",
    });
    assert.equal(job2.status, "running");
    assert.equal(bffAiJobStore.cancelJob(job2.id, userA), true);

    const cancelledJob = bffAiJobStore.getJob(job2.id, userA);
    assert.ok(cancelledJob);
    assert.equal(cancelledJob.status, "cancelled");

    // Cannot cancel already cancelled job
    assert.equal(bffAiJobStore.cancelJob(job2.id, userA), false);

    // 4. Test retry
    const retriedJob = bffAiJobStore.retryJob(job2.id, userA);
    assert.ok(retriedJob);
    assert.equal(retriedJob.attempt, 2);
    assert.equal(retriedJob.status, "running");
  });

  await t.test("3. BffAiJobStore Watchdog: >3 minutes running auto-transitions to failed", async () => {
    const userA = "user_watchdog";

    const job = bffAiJobStore.createJob({
      userId: userA,
      type: "stool_analysis",
    });
    assert.equal(job.status, "running");

    // Simulate creation 4 minutes ago (240 seconds > 180 seconds TIMEOUT_MS)
    const fourMinutesAgo = new Date(Date.now() - 240_000).toISOString();
    job.createdAt = fourMinutesAgo;
    job.startedAt = fourMinutesAgo;

    // getJob triggers watchdog check
    const timedOutJob = bffAiJobStore.getJob(job.id, userA);
    assert.ok(timedOutJob);
    assert.equal(timedOutJob.status, "failed");
    assert.ok(timedOutJob.errorMessage?.includes("超时"));
    assert.ok(timedOutJob.finishedAt);
  });

  await t.test("4. BffVoiceLogStore: Multitenancy, Unread Async & Acknowledgement", async () => {
    const userA = "user_voice_a";
    const userB = "user_voice_b";

    // Create async voice log for user A
    const log1 = bffVoiceLogStore.createLog({
      userId: userA,
      babyId: "baby_a",
      prompt: "宝宝今天喝了多少奶？",
      reply: "今天一共喝了350毫升配方奶。",
      isAsync: true,
      isFastPath: true,
      acknowledged: false,
    });

    assert.ok(log1.id);
    assert.equal(log1.isAsync, true);
    assert.equal(log1.acknowledged, false);

    // Query unread async logs for user A
    const unreadA = bffVoiceLogStore.listLogs(userA, { unreadAsyncOnly: true });
    assert.ok(unreadA.unreadLog);
    assert.equal(unreadA.unreadLog.id, log1.id);

    // Isolation: user B has no unread voice logs
    const unreadB = bffVoiceLogStore.listLogs(userB, { unreadAsyncOnly: true });
    assert.equal(unreadB.unreadLog, null);

    // Acknowledge voice log
    assert.equal(bffVoiceLogStore.acknowledgeLog(log1.id, userA, true), true);
    const unreadAfterAck = bffVoiceLogStore.listLogs(userA, { unreadAsyncOnly: true });
    assert.equal(unreadAfterAck.unreadLog, null);

    // List all logs for user A
    const allA = bffVoiceLogStore.listLogs(userA);
    assert.equal(allA.logs.length, 1);
    assert.equal(allA.logs[0].acknowledged, true);
  });

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
