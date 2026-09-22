import test from "node:test";
import assert from "node:assert/strict";
import { bffAiJobStore } from "../../lib/growdesk/ai-jobs";

test("retry watchdog measures the current attempt rather than original creation", t => {
  bffAiJobStore.clearAllForTest();
  t.after(() => bffAiJobStore.clearAllForTest());
  const userId = "test_retry_clock_owner";
  const job = bffAiJobStore.createJob({ userId, type: "test_medical_ocr" });
  const original = new Date(Date.now() - 240_000).toISOString();
  job.createdAt = original;
  job.startedAt = original;
  assert.equal(bffAiJobStore.getJob(job.id, userId)?.status, "failed");
  const before = Date.now();
  const retry = bffAiJobStore.retryJob(job.id, userId);
  assert.ok(retry);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.createdAt, original, "creation history must not be rewritten");
  assert.ok(Date.parse(retry.startedAt!) >= before);
  assert.equal(bffAiJobStore.getJob(job.id, userId)?.status, "running");
  assert.equal(bffAiJobStore.listJobs(userId).jobs[0]?.status, "running");
  retry.startedAt = new Date(Date.now() - 180_001).toISOString();
  assert.equal(bffAiJobStore.getJob(job.id, userId)?.status, "failed");
});

test("legacy jobs without startedAt retain the creation-time fallback", t => {
  bffAiJobStore.clearAllForTest();
  t.after(() => bffAiJobStore.clearAllForTest());
  const job = bffAiJobStore.createJob({ userId: "test_old_clock", type: "test_ocr" });
  job.createdAt = new Date(Date.now() - 240_000).toISOString();
  job.startedAt = null;
  assert.equal(bffAiJobStore.listJobs("test_old_clock").jobs[0]?.status, "failed");
});
