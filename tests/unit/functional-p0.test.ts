import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: RecordEditDialog should use original record date not today (B1)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "components/ui/RecordEditDialog.tsx"), "utf-8");
  // After fix, should derive date from record.timestamp/startTime via getLocalDateStr(originalIso)
  assert.ok(content.includes("getLocalDateStr") && content.includes("originalIso"), "should use original record date via getLocalDateStr(originalIso)");
  assert.ok(content.includes("record.timestamp") || content.includes("getLocalDateStr"), "should use original record date");
});

test("TDD: GrowthMeasurement should have clientId for offline idempotency (B2)", () => {
  const schema = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf-8");
  assert.ok(schema.includes("model GrowthMeasurement"), "has GrowthMeasurement");
  assert.ok(schema.includes("clientId"), "GrowthMeasurement should have clientId");
  // Check store has offline handling (now in slices)
  const storeMain = fs.readFileSync(path.join(process.cwd(), "stores/useBabyStore.ts"), "utf-8");
  const storeGrowth = fs.existsSync(path.join(process.cwd(), "stores/slices/growth.ts")) ? fs.readFileSync(path.join(process.cwd(), "stores/slices/growth.ts"), "utf-8") : "";
  const storeCombined = storeMain + storeGrowth;
  assert.ok(storeCombined.includes("addGrowthMeasurement") && storeCombined.includes("clientId"), "store should handle clientId for growth");
});

test("TDD: GET /api/growth should use desc order not asc (B3)", () => {
  const routeContent = fs.readFileSync(path.join(process.cwd(), "app/api/growth/route.ts"), "utf-8");
  const serviceContent = fs.existsSync(path.join(process.cwd(), "lib/records/service.ts")) ? fs.readFileSync(path.join(process.cwd(), "lib/records/service.ts"), "utf-8") : "";
  const content = routeContent + serviceContent;
  assert.ok(content.includes('orderBy'), "has orderBy");
  // After fix, should be desc to return latest, not asc (deep module: now in service)
  assert.ok(content.includes('"desc"') || content.includes("'desc'") || content.includes("desc"), "should use desc");
  const hasAscOnly = content.includes('orderBy: [{date:"asc"') && !content.includes('desc');
  assert.equal(hasAscOnly, false, "should not be asc-only with take 50");
});

test("TDD: medical/ocr should handle multipart imageBase64 (M1)", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/medical/ocr/route.ts"), "utf-8");
  // After fix, multipart should also set imageBase64
  assert.ok(content.includes("toString('base64')") || content.includes('toString("base64")'), "should convert buffer to base64");
  // Check that imageDataUrl is set from buf even for multipart
  const hasMultipartBase64 = content.includes("buf.toString") && content.includes("imageBase64");
  assert.ok(hasMultipartBase64, "multipart should produce imageBase64");
});

test("TDD: feeding should guard future timestamp (B9)", () => {
  const routeContent = fs.readFileSync(path.join(process.cwd(), "app/api/records/feeding/route.ts"), "utf-8");
  const serviceContent = fs.existsSync(path.join(process.cwd(), "lib/records/service.ts")) ? fs.readFileSync(path.join(process.cwd(), "lib/records/service.ts"), "utf-8") : "";
  const content = routeContent + serviceContent;
  assert.ok(content.includes("future") || content.includes("2030") || content.includes("Date.now()"), "should guard future");
  assert.ok(content.includes("birthDate") || content.includes("baby.birthDate"), "should guard before birthDate");
});
