import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCareTrends, type CareTrends } from "../../lib/care-trends";

function day(result: CareTrends, date: string) {
  const value = result.days.find((item) => item.date === date);
  assert.ok(value, `missing trend day ${date}`);
  return value;
}

test("food trends use the recorded calendar day, including food-only days and range boundaries", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_food_trends", timeZone: "America/Los_Angeles", endDate: "2026-10-06", days: 7,
    feeding: [], sleep: [], diaper: [], food: [
      { date: "2026-09-29" }, { date: "2026-09-30" },
      { date: "2026-10-06" }, { date: "2026-10-06" }, { date: "2026-10-07" },
    ],
  });
  assert.equal(day(result, "2026-09-30").foodCount, 1);
  assert.equal(day(result, "2026-10-06").foodCount, 2);
  assert.equal(day(result, "2026-10-06").hasRecords, true);
  assert.equal(day(result, "2026-10-06").recordedMilkMl, null);
  assert.equal(day(result, "2026-10-05").hasRecords, false);
  assert.equal(result.days.reduce((sum, d) => sum + d.foodCount, 0), 3);
  assert.throws(() => aggregateCareTrends({ babyId: "test_baby_food_bad", timeZone: "Asia/Shanghai", endDate: "2026-10-06", days: 7, feeding: [], sleep: [], diaper: [], food: [{ date: "2026-02-31" }] }));
});

test("care trends uses the family-local Shanghai day boundary", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_trends_shanghai",
    timeZone: "Asia/Shanghai",
    endDate: "2026-09-19",
    days: 7,
    now: new Date("2026-09-19T04:00:00+08:00"),
    feeding: [
      { timestamp: "2026-09-12T23:59:59+08:00", amountMl: 90, leftMinutes: null, rightMinutes: null },
      { timestamp: "2026-09-13T00:00:00+08:00", amountMl: 100, leftMinutes: null, rightMinutes: null },
      { timestamp: "2026-09-18T23:59:59+08:00", amountMl: 110, leftMinutes: null, rightMinutes: null },
      { timestamp: "2026-09-19T00:00:00+08:00", amountMl: 120, leftMinutes: null, rightMinutes: null },
    ],
    sleep: [],
    diaper: [
      { timestamp: "2026-09-12T23:59:59+08:00" },
      { timestamp: "2026-09-13T00:00:00+08:00" },
      { timestamp: "2026-09-19T00:00:00+08:00" },
    ],
  });

  assert.deepEqual(result.days.map((item) => item.date), [
    "2026-09-13",
    "2026-09-14",
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
    "2026-09-18",
    "2026-09-19",
  ]);
  assert.equal(day(result, "2026-09-13").recordedMilkMl, 100);
  assert.equal(day(result, "2026-09-18").recordedMilkMl, 110);
  assert.equal(day(result, "2026-09-19").recordedMilkMl, 120);
  assert.equal(day(result, "2026-09-13").diaperCount, 1);
  assert.equal(day(result, "2026-09-19").diaperCount, 1);
  assert.equal(result.today, "2026-09-19");
});

test("care trends keeps recorded milk separate from breastfeeding duration", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_trends_milk",
    timeZone: "Asia/Shanghai",
    endDate: "2026-09-19",
    days: 7,
    now: new Date("2026-09-19T12:00:00+08:00"),
    feeding: [
      { timestamp: "2026-09-19T08:00:00+08:00", amountMl: 120, leftMinutes: 10, rightMinutes: 5 },
      { timestamp: "2026-09-19T12:00:00+08:00", amountMl: null, leftMinutes: 15, rightMinutes: 10 },
      { timestamp: "2026-09-19T16:00:00+08:00", amountMl: 0, leftMinutes: null, rightMinutes: null },
    ],
    sleep: [],
    diaper: [],
  });

  const today = day(result, "2026-09-19");
  assert.equal(today.feedingCount, 3);
  assert.equal(today.recordedMilkMl, 120);
  assert.equal(today.breastMinutes, 40);
});

test("care trends preserves null for empty days while retaining an explicit zero", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_trends_empty",
    timeZone: "Asia/Shanghai",
    endDate: "2026-09-19",
    days: 7,
    now: new Date("2026-09-19T12:00:00+08:00"),
    feeding: [
      { timestamp: "2026-09-19T10:00:00+08:00", amountMl: 0, leftMinutes: null, rightMinutes: null },
    ],
    sleep: [],
    diaper: [],
  });

  const empty = day(result, "2026-09-18");
  assert.equal(empty.recordedMilkMl, null);
  assert.equal(empty.sleepMinutes, null);
  assert.equal(empty.feedingCount, 0);
  assert.equal(empty.diaperCount, 0);
  assert.equal(empty.hasRecords, false);

  const explicitZero = day(result, "2026-09-19");
  assert.equal(explicitZero.recordedMilkMl, 0);
  assert.equal(explicitZero.hasRecords, true);
});

test("care trends clips cross-midnight sleep and de-duplicates overlaps", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_trends_sleep",
    timeZone: "Asia/Shanghai",
    endDate: "2026-09-19",
    days: 7,
    now: new Date("2026-09-19T12:00:00+08:00"),
    feeding: [],
    sleep: [
      { startTime: "2026-09-18T23:00:00+08:00", endTime: "2026-09-19T02:00:00+08:00" },
      { startTime: "2026-09-19T01:30:00+08:00", endTime: "2026-09-19T03:00:00+08:00" },
    ],
    diaper: [],
  });

  assert.equal(day(result, "2026-09-18").sleepMinutes, 60);
  assert.equal(day(result, "2026-09-19").sleepMinutes, 180);
  assert.equal(day(result, "2026-09-19").hasRecords, true);
});

test("care trends handles the 25-hour DST day using real elapsed minutes", () => {
  const result = aggregateCareTrends({
    babyId: "test_baby_trends_dst",
    timeZone: "America/New_York",
    endDate: "2024-11-03",
    days: 7,
    now: new Date("2024-11-03T12:00:00Z"),
    feeding: [],
    sleep: [
      // 01:30 EDT to 02:30 EST spans the repeated hour: 120 real minutes.
      { startTime: "2024-11-03T05:30:00Z", endTime: "2024-11-03T07:30:00Z" },
    ],
    diaper: [],
  });

  assert.equal(result.today, "2024-11-03");
  assert.equal(day(result, "2024-11-03").sleepMinutes, 120);
});

test("care trends supports both requested seven-day and thirty-day windows", () => {
  const input = {
    babyId: "test_baby_trends_ranges",
    timeZone: "Asia/Shanghai",
    endDate: "2026-09-19" as const,
    now: new Date("2026-09-19T12:00:00+08:00"),
    feeding: [],
    sleep: [],
    diaper: [],
  };
  const seven = aggregateCareTrends({ ...input, days: 7 });
  const thirty = aggregateCareTrends({ ...input, days: 30 });

  assert.equal(seven.days.length, 7);
  assert.equal(seven.startDate, "2026-09-13");
  assert.equal(thirty.days.length, 30);
  assert.equal(thirty.startDate, "2026-08-21");
  assert.equal(thirty.endDate, "2026-09-19");
  assert.equal(thirty.babyId, "test_baby_trends_ranges");
});
