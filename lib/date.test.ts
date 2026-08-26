import assert from "node:assert/strict";
import {
  isValidDateStr,
  addDays,
  addMonths,
  diffCalendarDays,
  getWeekdayStr,
} from "./date";

function runDateTests() {
  console.log("=== Testing isValidDateStr ===");
  assert.equal(isValidDateStr("2026-02-01"), true);
  assert.equal(isValidDateStr("2026-02-29"), false); // 2026 is not a leap year
  assert.equal(isValidDateStr("2024-02-29"), true);  // 2024 is a leap year
  assert.equal(isValidDateStr("invalid"), false);

  console.log("=== Testing addDays ===");
  assert.equal(addDays("2026-02-01", 0), "2026-02-01");
  assert.equal(addDays("2026-02-01", 1), "2026-02-02");
  assert.equal(addDays("2026-02-01", 27), "2026-02-28");
  assert.equal(addDays("2026-02-01", 28), "2026-03-01");
  assert.equal(addDays("2026-02-01", 42), "2026-03-15"); // 6周龄 (42天)
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");

  console.log("=== Testing addMonths (Month arithmetic & Clamping) ===");
  // Normal cases
  assert.equal(addMonths("2026-02-01", 0), "2026-02-01");
  assert.equal(addMonths("2026-02-01", 1), "2026-03-01");
  assert.equal(addMonths("2026-02-01", 2), "2026-04-01");
  assert.equal(addMonths("2026-02-01", 3), "2026-05-01");
  assert.equal(addMonths("2026-02-01", 4), "2026-06-01");
  assert.equal(addMonths("2026-02-01", 6), "2026-08-01");
  assert.equal(addMonths("2026-02-01", 8), "2026-10-01");
  assert.equal(addMonths("2026-02-01", 9), "2026-11-01");
  assert.equal(addMonths("2026-02-01", 12), "2027-02-01");
  assert.equal(addMonths("2026-02-01", 18), "2027-08-01");
  assert.equal(addMonths("2026-02-01", 24), "2028-02-01");
  assert.equal(addMonths("2026-02-01", 36), "2029-02-01");
  assert.equal(addMonths("2026-02-01", 48), "2030-02-01");
  assert.equal(addMonths("2026-02-01", 72), "2032-02-01");

  // Critical Month-end Clamping edge cases (No overflow bugs)
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); // Jan 31 + 1m -> Feb 28
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29"); // Jan 31 + 1m in leap year -> Feb 29
  assert.equal(addMonths("2026-01-31", 2), "2026-03-31"); // Jan 31 + 2m -> Mar 31
  assert.equal(addMonths("2026-01-31", 3), "2026-04-30"); // Jan 31 + 3m -> Apr 30
  assert.equal(addMonths("2026-05-31", 1), "2026-06-30"); // May 31 + 1m -> Jun 30
  assert.equal(addMonths("2026-08-31", 1), "2026-09-30"); // Aug 31 + 1m -> Sep 30
  assert.equal(addMonths("2026-10-31", 1), "2026-11-30"); // Oct 31 + 1m -> Nov 30

  console.log("=== Testing diffCalendarDays ===");
  assert.equal(diffCalendarDays("2026-08-01", "2026-08-01"), 0);
  assert.equal(diffCalendarDays("2026-08-01", "2026-08-26"), 25);
  assert.equal(diffCalendarDays("2026-08-26", "2026-08-01"), -25);
  assert.equal(diffCalendarDays("2026-08-26", "2026-10-01"), 36);
  assert.equal(diffCalendarDays("2026-02-01", "2027-02-01"), 365);

  console.log("=== Testing getWeekdayStr ===");
  assert.equal(getWeekdayStr("2026-02-01"), "周日");
  assert.equal(getWeekdayStr("2026-08-26"), "周三");
  assert.equal(getWeekdayStr("2026-10-01"), "周四");

  console.log("🎉 ALL DATE & VACCINE SCHEDULE ARITHMETIC UNIT TESTS PASSED!");
}

runDateTests();
