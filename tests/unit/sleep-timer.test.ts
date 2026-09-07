import assert from "node:assert/strict";
import test from "node:test";
import {
  getPastIsoTime,
  resolvePastStartTime,
  adjustLiveStartTime,
  formatElapsedDuration,
} from "../../lib/sleep-timer";

test("Sleep Timer: getPastIsoTime calculates past timestamps correctly", () => {
  const ref = new Date("2026-09-07T14:30:00+08:00");

  const iso5 = getPastIsoTime(5, ref);
  assert.equal(new Date(iso5).getTime(), new Date("2026-09-07T14:25:00+08:00").getTime());

  const iso15 = getPastIsoTime(15, ref);
  assert.equal(new Date(iso15).getTime(), new Date("2026-09-07T14:15:00+08:00").getTime());

  const iso30 = getPastIsoTime(30, ref);
  assert.equal(new Date(iso30).getTime(), new Date("2026-09-07T14:00:00+08:00").getTime());

  // Negative or NaN fallback to ref
  assert.equal(new Date(getPastIsoTime(-10, ref)).getTime(), ref.getTime());
  assert.equal(new Date(getPastIsoTime(NaN, ref)).getTime(), ref.getTime());
});

test("Sleep Timer: resolvePastStartTime handles same-day past time", () => {
  const ref = new Date("2026-09-07T14:30:00+08:00");
  const iso = resolvePastStartTime("13:45", ref);

  assert.equal(new Date(iso).getTime(), new Date("2026-09-07T13:45:00+08:00").getTime());
});

test("Sleep Timer: resolvePastStartTime handles midnight crossover (e.g. 00:20 picking 23:50)", () => {
  const ref = new Date("2026-09-07T00:20:00+08:00");
  const iso = resolvePastStartTime("23:50", ref);

  // 23:50 is 30 mins before 00:20, within 16h window -> correctly resolved to yesterday night (2026-09-06T23:50)
  assert.equal(new Date(iso).getTime(), new Date("2026-09-06T23:50:00+08:00").getTime());
});

test("Sleep Timer: resolvePastStartTime prevents future times from mistakenly becoming yesterday (P1 fix)", () => {
  const ref = new Date("2026-09-07T14:30:00+08:00");

  // User mistakenly enters 15:00 (which is 30 mins in the future).
  // It should NOT become yesterday 15:00 (23.5 hours ago); it must clamp to ref!
  const isoFuture = resolvePastStartTime("15:00", ref);
  assert.equal(new Date(isoFuture).getTime(), ref.getTime());

  // User mistakenly enters 20:00 at 14:30 -> clamps to ref
  const isoFarFuture = resolvePastStartTime("20:00", ref);
  assert.equal(new Date(isoFarFuture).getTime(), ref.getTime());
});

test("Sleep Timer: resolvePastStartTime clamps slight clock jitter into the future", () => {
  const ref = new Date("2026-09-07T14:30:10+08:00");
  // User selects 14:31 (within 60s ahead), it clamps to ref
  const iso = resolvePastStartTime("14:31", ref);
  assert.equal(new Date(iso).getTime(), ref.getTime());
});

test("Sleep Timer: adjustLiveStartTime shifts start time earlier or later and enforces bounds", () => {
  const currentStart = "2026-09-07T14:00:00+08:00";
  const now = new Date("2026-09-07T14:30:00+08:00");

  // Push start earlier by 15 mins (was 14:00 -> becomes 13:45)
  const earlier = adjustLiveStartTime(currentStart, -15, now);
  assert.equal(new Date(earlier).getTime(), new Date("2026-09-07T13:45:00+08:00").getTime());

  // Push start later by 10 mins (was 14:00 -> becomes 14:10)
  const later = adjustLiveStartTime(currentStart, 10, now);
  assert.equal(new Date(later).getTime(), new Date("2026-09-07T14:10:00+08:00").getTime());

  // Push start later past "now" -> clamped to now
  const tooLate = adjustLiveStartTime(currentStart, 45, now);
  assert.equal(new Date(tooLate).getTime(), now.getTime());

  // Lower bound protection: cannot push earlier than 24h ago
  const wayTooEarly = adjustLiveStartTime(currentStart, -3000, now);
  const minExpected = now.getTime() - 24 * 60 * 60 * 1000;
  assert.equal(new Date(wayTooEarly).getTime(), minExpected);
});

test("Sleep Timer: formatElapsedDuration calculates display text and shortText", () => {
  const start = "2026-09-07T13:00:00+08:00";
  const now1 = new Date("2026-09-07T13:45:30+08:00");
  const dur1 = formatElapsedDuration(start, now1);
  assert.equal(dur1.hours, 0);
  assert.equal(dur1.minutes, 45);
  assert.equal(dur1.seconds, 30);
  assert.equal(dur1.text, "45分30秒");
  assert.equal(dur1.shortText, "45分钟");

  const now2 = new Date("2026-09-07T14:05:00+08:00");
  const dur2 = formatElapsedDuration(start, now2);
  assert.equal(dur2.hours, 1);
  assert.equal(dur2.minutes, 5);
  assert.equal(dur2.text, "1小时05分00秒");
  assert.equal(dur2.shortText, "1小时05分");
});
