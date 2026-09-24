import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRecordsSlice } from "@/stores/slices/records";

test("Smart Polling: RecordsSlice has pollActiveData method", () => {
  let dailySummaryFetched = false;
  let timelineFetched = false;
  let feedingFetched = false;
  let sleepFetched = false;
  let diaperFetched = false;
  let foodLogFetched = false;

  const mockState = {
    user: { id: "u1", username: "test_user" },
    baby: { id: "b1", nickname: "test_baby" },
    fetchDailySummary: async () => { dailySummaryFetched = true; },
    fetchTimeline: async () => { timelineFetched = true; },
    fetchFeedingRecords: async () => { feedingFetched = true; },
    fetchSleepRecords: async () => { sleepFetched = true; },
    fetchDiaperRecords: async () => { diaperFetched = true; },
    fetchFoodLogRecords: async () => { foodLogFetched = true; },
  };

  const slice = createRecordsSlice(
    (updater: any) => Object.assign(mockState, typeof updater === "function" ? updater(mockState) : updater),
    () => mockState
  );

  assert.strictEqual(typeof slice.pollActiveData, "function", "pollActiveData should be a function");
});

test("Smart Polling: pollActiveData invokes concurrent transactional fetches", async () => {
  let calls: string[] = [];

  const mockState = {
    user: { id: "u1", username: "test_user" },
    baby: { id: "b1", nickname: "test_baby" },
    fetchDailySummary: async () => { calls.push("dailySummary"); },
    fetchTimeline: async () => { calls.push("timeline"); },
    fetchFeedingRecords: async () => { calls.push("feeding"); },
    fetchSleepRecords: async () => { calls.push("sleep"); },
    fetchDiaperRecords: async () => { calls.push("diaper"); },
    fetchFoodLogRecords: async () => { calls.push("foodLog"); },
  };

  const slice = createRecordsSlice(
    (updater: any) => Object.assign(mockState, typeof updater === "function" ? updater(mockState) : updater),
    () => mockState
  );

  await slice.pollActiveData();

  assert.ok(calls.includes("dailySummary"), "should fetch dailySummary");
  assert.ok(calls.includes("timeline"), "should fetch timeline");
  assert.ok(calls.includes("feeding"), "should fetch feeding");
  assert.ok(calls.includes("sleep"), "should fetch sleep");
  assert.ok(calls.includes("diaper"), "should fetch diaper");
  assert.ok(calls.includes("foodLog"), "should fetch foodLog");
});

test("Smart Polling: pollActiveData returns early when no user or baby", async () => {
  let called = false;

  const mockState = {
    user: null,
    baby: null,
    fetchDailySummary: async () => { called = true; },
  };

  const slice = createRecordsSlice(
    () => {},
    () => mockState
  );

  await slice.pollActiveData();
  assert.strictEqual(called, false, "should not fetch if no user/baby");
});

test("Smart Polling: SmartPollingHost is mounted in MainLayout", () => {
  const layoutPath = path.join(process.cwd(), "app/(main)/layout.tsx");
  const content = fs.readFileSync(layoutPath, "utf-8");
  assert.ok(content.includes("SmartPollingHost"), "layout.tsx should import and render SmartPollingHost");
});

test("Smart Polling: both notification badges delegate polling and cleanup to the shared inbox", () => {
  for (const filename of ["app/(main)/page.tsx", "components/ui/BabyProfileHeader.tsx"]) {
    const content = fs.readFileSync(path.join(process.cwd(), filename), "utf-8");
    assert.match(content, /import\s*\{\s*useNotificationInbox\s*\}\s*from\s*["']@\/lib\/hooks\/useNotificationInbox["']/);
    assert.match(content, /const\s*\{\s*unreadCount\s*\}\s*=\s*useNotificationInbox\(\)/);
    assert.ok(!content.includes("calculateUnreadCount"), "persisted notifications must not use only browser-local read IDs");
  }
  const hook = fs.readFileSync(path.join(process.cwd(), "lib/hooks/useNotificationInbox.ts"), "utf-8");
  assert.match(hook, /window\.addEventListener\("baby:data-polled", refresh\)/);
  assert.match(hook, /window\.removeEventListener\("baby:data-polled", refresh\)/);
  assert.match(hook, /const refresh = \(\) => \{ void reload\(\); \}/);
  assert.ok(hook.includes("sameNotificationIdentity"), "poll results remain identity-scoped");
});
