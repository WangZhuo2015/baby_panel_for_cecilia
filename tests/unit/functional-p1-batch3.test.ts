import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: medical reports imageUrl should validate /uploads/medical/ pattern (M2)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/medical/reports/route.ts"), "utf-8");
  // Should validate imageUrl starts with /uploads/medical/ and has proper extension
  assert.ok(content.includes("/uploads/medical/"), "should check /uploads/medical/");
  assert.ok(content.includes("imageUrl") && (content.includes("startsWith") || content.includes("regex") || content.includes("/uploads\\/medical") || content.includes(".test")), "should validate imageUrl pattern");
  // Should return 400 for invalid
  assert.ok(content.includes("400") && content.includes("imageUrl"), "should reject invalid imageUrl");
});

test("TDD: medical reports imageUrl update should also validate (M2)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/medical/reports/[id]/route.ts"), "utf-8");
  assert.ok(content.includes("/uploads/medical/") || content.includes("imageUrl"), "should handle imageUrl");
  // Check that it validates not just trim
  const hasValidation = content.includes("startsWith") || content.includes("regex") || content.includes("/uploads\\/medical") || content.includes(".test");
  // If file exists, should validate; if no validation, test fails (red)
  assert.ok(hasValidation, "update should validate imageUrl pattern");
});

test("TDD: vaccines POST should prefer exact vaccineId, avoid short fuzzy (V1)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/vaccines/route.ts"), "utf-8");
  // Should have strict matching logic, not just naive includes with short string
  // After fix, should check length >=3 or exact match first
  const hasStrictLogic = content.includes("length >= 3") || content.includes("=== name") || content.includes("exact") || content.includes("trim().length");
  assert.ok(hasStrictLogic, "should have strict fuzzy logic to avoid short 'Hib' mis-match");
  // Should also handle requestedVaccineId exact
  assert.ok(content.includes("requestedVaccineId") && content.includes("findUnique"), "should handle exact vaccineId");
});

test("TDD: vaccines should handle sexRestriction filtering (V3)", () => {
  // Check frontend or API handles sexRestriction
  const apiContent = fs.readFileSync(path.join(process.cwd(), "app/api/vaccines/route.ts"), "utf-8");
  const frontContent = fs.readFileSync(path.join(process.cwd(), "app/(main)/health/vaccines/page.tsx"), "utf-8");
  const hasSexCheck = apiContent.includes("sexRestriction") || frontContent.includes("sexRestriction") || frontContent.includes("gender");
  assert.ok(hasSexCheck, "should handle sexRestriction filtering");
});

test("TDD: medical reports should bump items limit to >20 (M4)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/medical/reports/route.ts"), "utf-8");
  // Currently 20, should be 40-50 per audit, but we will at least check it handles 20+ properly
  // After fix, should be 40 or at least not reject 24 items blood test
  const hasLimit = content.includes("items.length > 20") || content.includes("items.length > 40") || content.includes("items.length > 50");
  assert.ok(hasLimit, "should have items length limit");
  // Check that limit is at least 40 after fix (red if still 20)
  // This test will be updated after fix to expect 40
  if (content.includes("items.length > 40") || content.includes("items.length > 50")) {
    assert.ok(true, "limit upgraded to 40+");
  } else {
    // If still 20, this is the red phase - we expect to fail before fix, but we want to make it green by upgrading to 40
    assert.fail("items limit still 20, should upgrade to 40 for full blood test");
  }
});
