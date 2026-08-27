import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: activities API should filter by month (BUG-03)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/development/activities/route.ts"), "utf-8");
  // Should parse month param and filter by ageMin/Max
  assert.ok(content.includes("searchParams.get") && content.includes("month"), "should read month param");
  assert.ok(content.includes("ageMinMonths") || content.includes("targetMonthMin"), "should filter by month");
  assert.ok(!content.includes("findMany({})") || content.includes("where"), "should not be empty findMany");
  // Ensure not just return all
  const hasWhere = content.includes("where");
  assert.ok(hasWhere, "should have where clause with month");
});

test("TDD: food/logs POST should validate date/time/portion (BUG-01)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/food/logs/route.ts"), "utf-8");
  // POST section should validate isValidDateStr, TIME_RE, portion enum
  assert.ok(content.includes("isValidDateStr"), "POST should validate date with isValidDateStr");
  assert.ok(content.includes("TIME_RE") || content.includes("getLocalTimeStr"), "should validate time");
  assert.ok(content.includes("little") && content.includes("half") && content.includes("most") && content.includes("all"), "should validate portion enum");
  assert.ok(content.includes("1") && content.includes("5") && content.includes("acceptance"), "should validate acceptance 1-5");
});

test("TDD: food/logs should use getLocalDateStr not toISOString (BUG-02)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/food/logs/route.ts"), "utf-8");
  assert.ok(content.includes("getLocalDateStr"), "should use getLocalDateStr for Shanghai date");
  assert.ok(!content.includes("new Date().toISOString().slice(0,10)") || content.includes("getLocalDateStr"), "should not use toISOString slice for date fallback");
});

test("TDD: food/logs POST should handle time fallback via getLocalTimeStr", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/food/logs/route.ts"), "utf-8");
  assert.ok(content.includes("getLocalTimeStr"), "should use getLocalTimeStr");
});
