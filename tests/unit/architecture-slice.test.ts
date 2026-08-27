import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: stores/useBabyStore should be sliced (<800 lines) or have slices", () => {
  const storePath = path.join(process.cwd(), "stores/useBabyStore.ts");
  const content = fs.readFileSync(storePath, "utf-8");
  const lines = content.split("\n").length;
  // After split, main store should be <800 or slices should exist
  const hasSlices = fs.existsSync(path.join(process.cwd(), "stores/slices"));
  const slicesCount = hasSlices ? fs.readdirSync(path.join(process.cwd(), "stores/slices")).length : 0;
  // Either main file <800 OR has at least 3 slices
  const isSliced = hasSlices && slicesCount >= 3;
  const isSmall = lines < 800;
  assert.ok(isSmall || isSliced, `store should be sliced: lines=${lines}, slices=${slicesCount}, need <800 or >=3 slices`);
});

test("TDD: lib/agent/tools should be modularized", () => {
  const toolsPath = path.join(process.cwd(), "lib/agent/tools.ts");
  const hasModular = fs.existsSync(path.join(process.cwd(), "lib/agent/tools"));
  const isSingleFile = fs.existsSync(toolsPath) && fs.statSync(toolsPath).size > 0;
  // After modularization, should have directory with multiple files OR main file <800 lines
  if (hasModular) {
    const files = fs.readdirSync(path.join(process.cwd(), "lib/agent/tools"));
    assert.ok(files.length >= 3, `tools modular dir should have >=3 files, got ${files.length}`);
  } else {
    const lines = fs.readFileSync(toolsPath, "utf-8").split("\n").length;
    assert.ok(lines < 800, `tools.ts should be <800 lines if not modularized, got ${lines}`);
  }
});

test("TDD: lib/fetch-cache should be extracted", () => {
  const hasCache = fs.existsSync(path.join(process.cwd(), "lib/fetch-cache.ts"));
  assert.ok(hasCache, "lib/fetch-cache.ts should exist (extracted from store)");
});

test("TDD: stores slices should contain auth/records/growth", () => {
  const sliceDir = path.join(process.cwd(), "stores/slices");
  if (!fs.existsSync(sliceDir)) assert.fail("stores/slices dir missing");
  const files = fs.readdirSync(sliceDir);
  assert.ok(files.some(f => f.includes("auth")), "should have auth slice");
  assert.ok(files.some(f => f.includes("record") || f.includes("feeding")), "should have records slice");
  assert.ok(files.some(f => f.includes("growth") || f.includes("medical")), "should have growth/medical slice");
});
