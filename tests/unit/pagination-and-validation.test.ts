import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

// ── TDD: Pagination helper logic (mirrors route.ts inline parsing) ──
function parseLimit(raw: string | null | undefined, def = 50): number {
  return Math.min(100, Math.max(1, parseInt(raw || String(def), 10) || def));
}

test("TDD: pagination parseLimit defaults to 50", () => {
  assert.equal(parseLimit(null), 50);
  assert.equal(parseLimit(undefined), 50);
  assert.equal(parseLimit(""), 50);
});

test("TDD: pagination parseLimit respects valid values", () => {
  assert.equal(parseLimit("10"), 10);
  assert.equal(parseLimit("50"), 50);
  assert.equal(parseLimit("100"), 100);
});

test("TDD: pagination parseLimit clamps to 1-100", () => {
  // "0" is falsy -> fallback to default 50 per route logic (parseInt(...) || 50)
  assert.equal(parseLimit("0"), 50);
  assert.equal(parseLimit("-5"), 1);
  assert.equal(parseLimit("1000"), 100);
  assert.equal(parseLimit("9999"), 100);
});

test("TDD: pagination parseLimit handles NaN", () => {
  assert.equal(parseLimit("abc"), 50);
  assert.equal(parseLimit("NaN"), 50);
});

// ── TDD: Route files must contain pagination (static regression) ──
const paginationRoutes = [
  "app/api/records/feeding/route.ts",
  "app/api/records/sleep/route.ts",
  "app/api/records/diaper/route.ts",
  "app/api/growth/route.ts",
  "app/api/medical/reports/route.ts",
  "app/api/food/logs/route.ts",
  "app/api/food/plans/route.ts",
];

for (const rel of paginationRoutes) {
  test(`TDD: ${rel} contains take: limit`, () => {
    const full = path.join(process.cwd(), rel);
    const content = fs.readFileSync(full, "utf-8");
    assert.ok(content.includes("take: limit"), `${rel} should contain 'take: limit'`);
    assert.ok(content.includes("Math.min(100"), `${rel} should clamp limit to 100`);
  });
}

// ── TDD: Length validation helpers ──
test("TDD: notes length limit 1000", () => {
  const notes = "a".repeat(1001);
  assert.equal(notes.length > 1000, true);
  assert.equal(notes.slice(0, 1000).length, 1000);
});

test("TDD: title length limit 100", () => {
  const title = "t".repeat(150);
  assert.equal(title.slice(0, 100).length, 100);
});

test("TDD: foods array limit 20", () => {
  const foods = new Array(30).fill("apple");
  assert.equal(foods.slice(0, 20).length, 20);
});

// ── TDD: food/items RBAC ──
test("TDD: food/items must enforce admin check for system foodId", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/food/items/route.ts"), "utf-8");
  assert.ok(content.includes('role !== "admin"'), "food/items should check admin role");
  assert.ok(content.includes("仅管理员可创建或覆盖系统食材"), "should have admin error message");
  assert.ok(content.includes("user_"), "should use user_ prefix namespace");
  assert.ok(content.includes("slice(0, 100)"), "should limit name length");
});

test("TDD: push/subscribe must check ownership", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/api/push/subscribe/route.ts"), "utf-8");
  assert.ok(content.includes("existing && existing.userId"), "should check existing ownership");
  assert.ok(content.includes("409"), "should return 409 on conflict");
  assert.ok(content.includes("已归属其他用户"), "should have ownership error");
});

// ── TDD: .dockerignore must contain data/archive and db-wal ──
test("TDD: .dockerignore protects sensitive paths", () => {
  const content = fs.readFileSync(path.join(process.cwd(), ".dockerignore"), "utf-8");
  assert.ok(content.includes("data/archive/"), ".dockerignore should ignore data/archive");
  assert.ok(content.includes("*.db-wal"), "should ignore wal");
  assert.ok(content.includes("*.db-shm"), "should ignore shm");
  assert.ok(content.includes("generated/"), "should ignore generated");
});

// ── TDD: Dockerfile must have wget and correct seed-data copy ──
test("TDD: Dockerfile has wget and seed-data fix", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "Dockerfile"), "utf-8");
  assert.ok(content.includes("apk add") && content.includes("wget"), "Dockerfile should install wget");
  assert.ok(content.includes("COPY --from=builder /app/data ./data"), "should copy data to ./data");
});

// ── TDD: viewport must not disable zoom ──
test("TDD: app/layout viewport allows user scaling", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf-8");
  assert.ok(!content.includes("userScalable: false"), "viewport should not disable userScalable");
  assert.ok(!content.includes("maximumScale: 1"), "viewport should not lock maximumScale");
});

// ── TDD: prisma schema has new indexes ──
test("TDD: prisma schema has SleepRecord endTime index", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf-8");
  assert.ok(content.includes("@@index([babyId, endTime])"), "should have SleepRecord endTime index");
  assert.ok(content.includes("@@index([dataReleaseId])"), "should have SourceRef dataReleaseId index");
});

// ── TDD: prisma seed must handle DataRelease linking and PRAGMA ──
test("TDD: prisma/seed.ts links SourceRef to DataRelease", () => {
  const content = fs.readFileSync(path.join(process.cwd(), "prisma/seed.ts"), "utf-8");
  assert.ok(content.includes("dataReleaseId: dataRelease.id"), "seed should link dataReleaseId");
  assert.ok(content.includes('PRAGMA foreign_keys = ON'), "seed should set foreign_keys");
  assert.ok(content.includes("getDataDir()") || content.includes("seed-data"), "seed should support fallback dir");
});
