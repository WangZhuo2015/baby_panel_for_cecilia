import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const runner = path.resolve("scripts/test-growdesk-e2e-all.py");

test("retired GrowDesk E2E entry point fails closed before importing dependencies", () => {
  const result = spawnSync("python3", ["-S", runner], {
    encoding: "utf8",
    timeout: 10_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /\[RETIRED\]\[FAIL-CLOSED\]/);
  assert.match(result.stderr, /scripts\/test-e2e\.sh 3089/);
  assert.match(result.stderr, /dev_test\.db/);
  assert.match(result.stderr, /test_\/e2e_/);
  assert.match(result.stderr, /not implemented/i);
  assert.doesNotMatch(result.stderr, /ModuleNotFoundError|No module named/);
});

test("retired GrowDesk E2E entry point has no credentials or write/network logic", () => {
  const source = readFileSync(runner, "utf8");

  assert.doesNotMatch(source, /^\s*(?:from|import)\s+/m);
  assert.doesNotMatch(source, /\b(?:requests|urllib|httpx|socket)\b/i);
  assert.doesNotMatch(source, /\b(?:post|get|delete|put|patch)\s*\(/i);
  assert.doesNotMatch(source, /\b(?:username|password|babyId|familyId)\s*[:=]/i);
  assert.doesNotMatch(source, /wangzhuo|Cecilia|好好/i);
});
