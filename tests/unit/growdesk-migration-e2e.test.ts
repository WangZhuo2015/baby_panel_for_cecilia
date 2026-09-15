import test from "node:test";
import assert from "node:assert/strict";
import {
  transformFeedingToGrowDesk,
  transformSleepToGrowDesk,
  transformDiaperToGrowDesk,
  transformFoodLogToGrowDesk,
  transformGrowthToGrowDesk,
  reconcileTableRecords,
  generateFullMigrationReport,
} from "../../lib/growdesk/migration";

test("Issue #8: GrowDesk Migration Transforms, Reconciliation & Rollback Verification", async (t) => {
  await t.test("1. Feeding record transform preserves mixed feeding, ml, and minutes", () => {
    const legacyMixed = {
      id: "feed_mix_1",
      babyId: "baby_test_1",
      type: "mixed",
      amountMl: 85,
      leftMinutes: 10,
      rightMinutes: 5,
      spitUp: false,
      timestamp: "2026-09-12T08:30:00.000Z",
      notes: "Morning mixed feeding",
      version: 3,
    };

    const target = transformFeedingToGrowDesk(legacyMixed);
    assert.equal(target.id, "feed_mix_1");
    assert.equal(target.feedingType, "mixed");
    assert.equal(target.amountMl, "85");
    assert.equal(target.leftMinutes, 10);
    assert.equal(target.rightMinutes, 5);
    assert.equal(target.spitUp, false);
    assert.equal(target.occurredAt, "2026-09-12T08:30:00.000Z");
    assert.equal(target.baseVersion, 3);
  });

  await t.test("2. Sleep record transform handles start/end times and night waking count", () => {
    const legacySleep = {
      id: "sleep_1",
      babyId: "baby_test_1",
      type: "night",
      startTime: "2026-09-12T20:00:00.000Z",
      endTime: "2026-09-13T06:30:00.000Z",
      nightWakingCount: 2,
      notes: "Good night sleep",
      version: 1,
    };

    const target = transformSleepToGrowDesk(legacySleep);
    assert.equal(target.id, "sleep_1");
    assert.equal(target.sleepType, "night");
    assert.equal(target.startedAt, "2026-09-12T20:00:00.000Z");
    assert.equal(target.endedAt, "2026-09-13T06:30:00.000Z");
    assert.equal(target.nightWakingCount, 2);
    assert.equal(target.baseVersion, 1);
  });

  await t.test("3. Diaper record transform correctly handles pee, poop, and colors", () => {
    const legacyDiaper = {
      id: "diaper_1",
      babyId: "baby_test_1",
      type: "both",
      poopColor: "yellow",
      poopConsistency: "paste",
      timestamp: "2026-09-12T14:15:00.000Z",
      version: 2,
    };

    const target = transformDiaperToGrowDesk(legacyDiaper);
    assert.equal(target.id, "diaper_1");
    assert.equal(target.diaperType, "both");
    assert.equal(target.poopColor, "yellow");
    assert.equal(target.poopConsistency, "paste");
    assert.equal(target.occurredAt, "2026-09-12T14:15:00.000Z");
  });

  await t.test("4. Food log transform normalizes string and array formats", () => {
    // Array format
    const legacyFoodArr = {
      id: "food_1",
      babyId: "baby_test_1",
      date: "2026-09-12",
      time: "12:00",
      mealType: "lunch",
      foods: ["胡萝卜泥", "米糊"],
      portion: "半碗",
      version: 1,
    };
    const targetArr = transformFoodLogToGrowDesk(legacyFoodArr);
    assert.deepEqual(targetArr.foods, ["胡萝卜泥", "米糊"]);
    assert.equal(targetArr.mealType, "lunch");

    // JSON string format
    const legacyFoodStr = {
      id: "food_2",
      babyId: "baby_test_1",
      date: "2026-09-12",
      foods: JSON.stringify(["苹果泥"]),
    };
    const targetStr = transformFoodLogToGrowDesk(legacyFoodStr);
    assert.deepEqual(targetStr.foods, ["苹果泥"]);
  });

  await t.test("5. Growth record transform serializes decimals cleanly", () => {
    const legacyGrowth = {
      id: "growth_1",
      babyId: "baby_test_1",
      date: "2026-09-01",
      weightKg: 7.25,
      heightCm: 68.5,
      headCircumferenceCm: 43.0,
      version: 1,
    };

    const target = transformGrowthToGrowDesk(legacyGrowth);
    assert.equal(target.id, "growth_1");
    assert.equal(target.weightKg, "7.25");
    assert.equal(target.heightCm, "68.5");
    assert.equal(target.headCircumferenceCm, "43");
    assert.equal(target.measuredAt, "2026-09-01T00:00:00.000Z");
  });

  await t.test("6. Table reconciliation engine verifies 100% parity and detects mismatches", () => {
    const sourceRows = [
      { id: "1", val: "A" },
      { id: "2", val: "B" },
      { id: "3", val: "C" },
    ];

    // Perfect match
    const targetRows = [
      { id: "1", val: "A" },
      { id: "2", val: "B" },
      { id: "3", val: "C" },
    ];

    const matchSummary = reconcileTableRecords("test_table", sourceRows, targetRows, (s, t) =>
      s.val !== t.val ? `value mismatch: ${s.val} != ${t.val}` : null
    );
    assert.equal(matchSummary.status, "matched");
    assert.equal(matchSummary.matchedCount, 3);
    assert.equal(matchSummary.mismatchedCount, 0);

    // Discrepancy (missing ID 3 and mismatched ID 2)
    const badTargetRows = [
      { id: "1", val: "A" },
      { id: "2", val: "WRONG" },
    ];

    const badSummary = reconcileTableRecords("test_table", sourceRows, badTargetRows, (s, t) =>
      s.val !== t.val ? `value mismatch: ${s.val} != ${t.val}` : null
    );
    assert.equal(badSummary.status, "discrepancy");
    assert.equal(badSummary.matchedCount, 1);
    assert.equal(badSummary.mismatchedCount, 2);
    assert.ok(badSummary.discrepancies.some((d) => d.includes("Missing in target")));
    assert.ok(badSummary.discrepancies.some((d) => d.includes("value mismatch")));
  });

  await t.test("7. Full migration report with Go/No-Go decision and verified rollback safety", () => {
    const perfectSummaries = [
      {
        table: "feedings",
        sourceCount: 150,
        targetCount: 150,
        matchedCount: 150,
        mismatchedCount: 0,
        discrepancies: [],
        status: "matched" as const,
      },
      {
        table: "sleep_logs",
        sourceCount: 80,
        targetCount: 80,
        matchedCount: 80,
        mismatchedCount: 0,
        discrepancies: [],
        status: "matched" as const,
      },
    ];

    const reportGo = generateFullMigrationReport(perfectSummaries, []);
    assert.equal(reportGo.isConsistent, true);
    assert.equal(reportGo.goNoGo, "GO");
    assert.equal(reportGo.rollbackPlan.isSafe, true);
    assert.ok(reportGo.rollbackPlan.steps.length > 0);

    // Report with orphans -> NO-GO
    const reportNoGo = generateFullMigrationReport(perfectSummaries, [
      "Orphaned record: feeding feed_orphan has non-existent babyId baby_ghost",
    ]);
    assert.equal(reportNoGo.isConsistent, false);
    assert.equal(reportNoGo.goNoGo, "NO-GO");
  });
});
