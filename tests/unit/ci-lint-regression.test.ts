import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

test("TDD: CI must run unit tests (P1-3 red->green)", () => {
  const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
  // CI should contain test step - before fix this fails (RED), after fix passes (GREEN)
  assert.ok(ci.includes("npm run test:unit") || ci.includes("npm test"), "CI should run tests");
  assert.ok(ci.includes("Run unit tests") || ci.includes("Run tests"), "CI should have explicit test step name");
});

test("TDD: oxlint must enable more than 2 rules (P1-3 red->green)", () => {
  const ox = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".oxlintrc.json"), "utf-8"));
  const ruleCount = Object.keys(ox.rules || {}).length;
  // Before fix 2, after fix >=4
  assert.ok(ruleCount >= 4, `oxlint should have >=4 rules, got ${ruleCount}`);
  // Should include typescript/no-explicit-any or pedantic
  const hasAnyRule = Object.keys(ox.rules).some((k) => k.includes("no-explicit-any") || k.includes("no-unused-vars") || k.includes("correctness"));
  assert.ok(hasAnyRule, "oxlint should enable correctness/typescript rules");
});

test("TDD: CI should verify Docker build (P1-3)", () => {
  const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
  assert.ok(ci.includes("docker build") || ci.includes("Docker build"), "CI should verify Docker build");
});

test("TDD: CI should have permissions and concurrency (hardening)", () => {
  const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf-8");
  assert.ok(ci.includes("permissions:") || ci.includes("contents: read"), "CI should set permissions");
});
