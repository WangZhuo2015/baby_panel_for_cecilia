import assert from "node:assert/strict";
import test from "node:test";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "../../lib/prisma";
import { getLocalDateStr } from "../../lib/date";
import { createTestTenant, destroyTestTenant } from "../helpers/tenant";

const BASE_URL = process.env.BABY_PANEL_URL || "http://127.0.0.1:3088";

test("API: Core Records (Feeding, Sleep, Diaper, Daily Summary, Timeline)", async (t) => {
  // 隔离租户：禁止 findFirst 抓取真实用户/宝宝（AGENTS.md）
  const tenant = await createTestTenant(prisma, "records");
  const baby = { id: tenant.babyId };
  t.after(() => destroyTestTenant(prisma, tenant.username));

  const headers = tenant.headers;
  const today = getLocalDateStr();
  let feedRecordId: string | undefined;
  let sleepRecordId: string | undefined;
  let diaperRecordId: string | undefined;

  try {

  // 1. Feeding Record Test
  console.log("-> Testing Feeding API...");
  const feedRes = await fetch(`${BASE_URL}/api/records/feeding`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      type: "formula",
      amountMl: 160,
      timestamp: `${today}T08:30:00+08:00`,
      notes: "自动化测试配方奶记录",
    }),
  });
  assert.ok(feedRes.status === 200 || feedRes.status === 201, `POST /api/records/feeding status ${feedRes.status}`);
  const feedData = await feedRes.json();
  feedRecordId = feedData.id || feedData.record?.id;
  assert.ok(feedRecordId, "Feeding record ID should exist");

  const feedListRes = await fetch(`${BASE_URL}/api/records/feeding?babyId=${baby.id}&date=${today}`, { headers });
  assert.equal(feedListRes.status, 200);
  const feedList = await feedListRes.json();
  const feeds = Array.isArray(feedList) ? feedList : feedList.records || [];
  assert.ok(feeds.some((f: any) => f.id === feedRecordId), "Created feed record should appear in list");

  // 2. Sleep Record Test
  console.log("-> Testing Sleep API...");
  const sleepRes = await fetch(`${BASE_URL}/api/records/sleep`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      type: "nap",
      startTime: `${today}T13:00:00+08:00`,
      endTime: `${today}T15:00:00+08:00`,
      notes: "自动化测试午睡记录",
    }),
  });
  assert.ok(sleepRes.status === 200 || sleepRes.status === 201, `POST /api/records/sleep status ${sleepRes.status}`);
  const sleepData = await sleepRes.json();
  sleepRecordId = sleepData.id || sleepData.record?.id;
  assert.ok(sleepRecordId, "Sleep record ID should exist");

  // 3. Diaper Record Test
  console.log("-> Testing Diaper API...");
  const diaperRes = await fetch(`${BASE_URL}/api/records/diaper`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      babyId: baby.id,
      type: "both",
      poopColor: "yellow",
      poopConsistency: "normal",
      timestamp: `${today}T15:30:00+08:00`,
      notes: "自动化测试换尿布记录",
    }),
  });
  assert.ok(diaperRes.status === 200 || diaperRes.status === 201, `POST /api/records/diaper status ${diaperRes.status}`);
  const diaperData = await diaperRes.json();
  diaperRecordId = diaperData.id || diaperData.record?.id;
  assert.ok(diaperRecordId, "Diaper record ID should exist");

  // 4. Daily Summary Test
  console.log("-> Testing Daily Summary API...");
  const summaryRes = await fetch(`${BASE_URL}/api/records/daily-summary?babyId=${baby.id}&date=${today}`, { headers });
  assert.equal(summaryRes.status, 200, "GET /api/records/daily-summary should succeed");
  const summary = await summaryRes.json();
  assert.ok(summary !== null && typeof summary === "object");
  assert.ok(summary.totalFeedingMl >= 160, `Daily summary totalFeedingMl expected >= 160, got ${summary.totalFeedingMl}`);
  assert.ok(summary.totalSleepMinutes >= 120, `Daily summary totalSleepMinutes expected >= 120, got ${summary.totalSleepMinutes}`);
  assert.ok(summary.diaperCount >= 1, `Daily summary diaperCount expected >= 1, got ${summary.diaperCount}`);

  // 5. Timeline Test
  console.log("-> Testing Timeline API...");
  const timelineRes = await fetch(`${BASE_URL}/api/records/timeline?babyId=${baby.id}&date=${today}`, { headers });
  assert.equal(timelineRes.status, 200, "GET /api/records/timeline should succeed");
  const timeline = await timelineRes.json();
  const items = Array.isArray(timeline) ? timeline : timeline.items || [];
  assert.ok(items.length >= 3, "Timeline should contain all record types");
  } finally {
    // assert 失败也必须清理，避免污染租户库
    if (feedRecordId) await prisma.feedingRecord.delete({ where: { id: feedRecordId } }).catch(() => {});
    if (sleepRecordId) await prisma.sleepRecord.delete({ where: { id: sleepRecordId } }).catch(() => {});
    if (diaperRecordId) await prisma.diaperRecord.delete({ where: { id: diaperRecordId } }).catch(() => {});
  }
});
