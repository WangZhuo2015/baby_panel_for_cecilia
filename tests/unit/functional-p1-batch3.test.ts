import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { matchVaccineProduct, showVaccineReference } from "../../lib/vaccine-records";
import { toGrowDeskVaccineRecordPayload } from "../../lib/growdesk/vaccine-compat";

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
  const catalog = [{ vaccineId: "vac_hib_acthib", name: "test_Hib品牌全名", shortName: "Hib" }];
  assert.equal(matchVaccineProduct("Hib", catalog), null, "a generic abbreviation is not proof of a specific brand");
  const explicit = toGrowDeskVaccineRecordPayload({ name: "Hib", vaccineId: "vac_hib_acthib", recordStatus: "needs_review" });
  assert.equal(explicit.vaccineId, "vac_hib_acthib", "the user's explicit product choice takes precedence over raw text");
  const unassigned = toGrowDeskVaccineRecordPayload({ name: "Hib", vaccineId: null, recordStatus: "needs_review" });
  assert.equal(unassigned.vaccineId, null);
});

test("TDD: vaccines should handle sexRestriction filtering (V3)", () => {
  assert.equal(showVaccineReference({ sexRestriction: "female" }, "male"), false);
  assert.equal(showVaccineReference({ sexRestriction: "female" }, "female"), true);
  assert.equal(showVaccineReference({ sexRestriction: "male" }, "female"), false);
  assert.equal(showVaccineReference({ sexRestriction: "all" }, "female"), true);
  assert.equal(showVaccineReference({ routineHealthyChildOption: false }, "female"), false);
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
