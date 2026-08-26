import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidDateStr,
  getLocalDateStr,
  getLocalTimeStr,
  addDays,
  addMonths,
  diffCalendarDays,
  diffDaysFromToday,
  getWeekdayStr,
  getLocalDayUtcRange,
  localTimeToUtcIso,
} from "../../lib/date";
import { calculateAge, calculateAgeDetail } from "../../lib/age";

test("Date utilities: validation, additions, and diffs", () => {
  // 1. Validation
  assert.equal(isValidDateStr("2026-02-01"), true);
  assert.equal(isValidDateStr("2026-02-29"), false); // Non leap year
  assert.equal(isValidDateStr("2024-02-29"), true);  // Leap year
  assert.equal(isValidDateStr("2026-13-01"), false);
  assert.equal(isValidDateStr("2026-00-01"), false);
  assert.equal(isValidDateStr("not-a-date"), false);

  // 2. getLocalDateStr & getLocalTimeStr
  const todayStr = getLocalDateStr();
  assert.match(todayStr, /^\d{4}-\d{2}-\d{2}$/);
  const nowTime = getLocalTimeStr();
  assert.match(nowTime, /^\d{2}:\d{2}$/);

  // 3. addDays
  assert.equal(addDays("2026-02-01", 0), "2026-02-01");
  assert.equal(addDays("2026-02-01", 1), "2026-02-02");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29"); // Leap year
  assert.equal(addDays("2026-02-01", 42), "2026-03-15"); // 6 weeks

  // 4. addMonths & Clamping
  assert.equal(addMonths("2026-02-01", 0), "2026-02-01");
  assert.equal(addMonths("2026-02-01", 6), "2026-08-01");
  assert.equal(addMonths("2026-02-01", 12), "2027-02-01");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28"); // Month-end clamp
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29"); // Leap year clamp
  assert.equal(addMonths("2026-03-31", 1), "2026-04-30");

  // 5. diffCalendarDays & diffDaysFromToday
  assert.equal(diffCalendarDays("2026-08-01", "2026-08-01"), 0);
  assert.equal(diffCalendarDays("2026-08-01", "2026-08-26"), 25);
  assert.equal(diffCalendarDays("2026-08-26", "2026-08-01"), -25);
  assert.equal(diffCalendarDays("2026-02-01", "2027-02-01"), 365);
  assert.equal(diffDaysFromToday(getLocalDateStr()), 0);

  // 6. Weekdays
  assert.equal(getWeekdayStr("2026-02-01"), "周日");
  assert.equal(getWeekdayStr("2026-08-26"), "周三");

  // 7. Local Day UTC Range & ISO conversions
  const range = getLocalDayUtcRange("2026-08-26");
  assert.equal(range.start, "2026-08-25T16:00:00.000Z");
  assert.equal(range.end, "2026-08-26T16:00:00.000Z");

  const utcIso = localTimeToUtcIso("08:00");
  assert.ok(utcIso.endsWith("Z"));
});

test("Age utilities: infant milestones, days, and stage calculations", () => {
  const birth = "2026-02-01";

  // Same day
  const age0 = calculateAgeDetail(birth, "2026-02-01");
  assert.equal(age0.months, 0);
  assert.equal(age0.days, 0);
  assert.equal(age0.totalDays, 0);

  // 1 month
  const age1m = calculateAgeDetail(birth, "2026-03-01");
  assert.equal(age1m.months, 1);
  assert.equal(age1m.days, 0);
  assert.equal(age1m.totalDays, 28);

  // 6 months 25 days
  const age6m = calculateAgeDetail(birth, "2026-08-26");
  assert.equal(age6m.months, 6);
  assert.equal(age6m.days, 25);
  assert.equal(age6m.totalDays, 206);

  // 1 year
  const age1y = calculateAge(birth, "2027-02-01");
  assert.equal(age1y.months, 12);
  assert.equal(age1y.days, 0);
  assert.equal(age1y.label, "12月0天");
});
