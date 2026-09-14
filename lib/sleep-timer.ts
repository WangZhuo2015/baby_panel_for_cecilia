import { getLocalDateStr, addDays } from "./date";

/**
 * Returns an ISO timestamp representing N minutes before the reference date.
 */
export function getPastIsoTime(minutesAgo: number, referenceDate: Date = new Date()): string {
  const refTime = referenceDate.getTime();
  const safeMinutes = typeof minutesAgo === "number" && !Number.isNaN(minutesAgo) ? Math.max(0, minutesAgo) : 0;
  return new Date(refTime - safeMinutes * 60 * 1000).toISOString();
}

/**
 * Resolves a local 24h time string ("HH:mm") into a full ISO string.
 * If the time falls into the future compared to referenceDate:
 * - If it's within a 60s jitter tolerance: clamp to referenceDate.
 * - If treating it as yesterday yields a reasonable baby sleep duration (e.g. <= 16 hours),
 *   it is treated as having occurred yesterday (e.g. current time 00:20 selecting 23:50 -> 30 mins ago).
 * - If treating it as yesterday would mean an unrealistic duration (> 16 hours, e.g. current 14:30 selecting 15:00),
 *   it is considered an invalid future input and clamped to referenceDate.
 */
export function resolvePastStartTime(hhmm: string, referenceDate: Date = new Date()): string {
  if (!hhmm || typeof hhmm !== "string") {
    return referenceDate.toISOString();
  }

  const parts = hhmm.trim().split(":");
  if (parts.length < 2) {
    return referenceDate.toISOString();
  }

  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return referenceDate.toISOString();
  }

  const todayStr = getLocalDateStr(referenceDate);
  const paddedTime = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  let candidate = new Date(`${todayStr}T${paddedTime}:00+08:00`);

  if (Number.isNaN(candidate.getTime())) {
    return referenceDate.toISOString();
  }

  const refTime = referenceDate.getTime();
  const candidateTime = candidate.getTime();

  // If candidate time is in the future
  if (candidateTime > refTime + 60 * 1000) {
    const yesterdayStr = addDays(todayStr, -1);
    const yesterdayCandidate = new Date(`${yesterdayStr}T${paddedTime}:00+08:00`);
    const yesterdayElapsedMs = refTime - yesterdayCandidate.getTime();
    const MAX_CROSS_MIDNIGHT_SLEEP_MS = 16 * 60 * 60 * 1000; // max 16 hours

    // Only treat as yesterday's cross-midnight sleep if within realistic sleep duration
    if (yesterdayElapsedMs > 0 && yesterdayElapsedMs <= MAX_CROSS_MIDNIGHT_SLEEP_MS) {
      return yesterdayCandidate.toISOString();
    }
    // Otherwise it's an erroneous future time on today (e.g. 14:30 selecting 15:00) -> clamp to now
    return referenceDate.toISOString();
  } else if (candidateTime > refTime) {
    // Within 60 seconds tolerance into the future, clamp to refTime
    return referenceDate.toISOString();
  }

  return candidate.toISOString();
}

/**
 * Adjusts an ongoing sleep timer start ISO by deltaMinutes (negative = earlier, positive = later).
 * Clamps between [now - 24h, now].
 */
export function adjustLiveStartTime(
  startIso: string,
  deltaMinutes: number,
  maxDate: Date = new Date()
): string {
  const current = new Date(startIso).getTime();
  if (Number.isNaN(current)) return maxDate.toISOString();

  const safeDelta = typeof deltaMinutes === "number" && !Number.isNaN(deltaMinutes) ? deltaMinutes : 0;
  const adjusted = current + safeDelta * 60 * 1000;
  const maxMs = maxDate.getTime();
  const minMs = maxMs - 24 * 60 * 60 * 1000; // Maximum 24 hours ago

  const clamped = Math.min(maxMs, Math.max(minMs, adjusted));
  return new Date(clamped).toISOString();
}

/**
 * Calculates and formats elapsed duration for sleep timer display.
 */
export function formatElapsedDuration(startIso: string, now: Date = new Date()): {
  hours: number;
  minutes: number;
  seconds: number;
  text: string;
  shortText: string;
} {
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) {
    return { hours: 0, minutes: 0, seconds: 0, text: "0秒", shortText: "0分" };
  }

  const totalSec = Math.max(0, Math.floor((now.getTime() - start) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  let text = "";
  if (hours > 0) {
    text = `${hours}小时${String(minutes).padStart(2, "0")}分${String(seconds).padStart(2, "0")}秒`;
  } else {
    text = `${minutes}分${String(seconds).padStart(2, "0")}秒`;
  }

  const shortText = hours > 0 ? `${hours}小时${String(minutes).padStart(2, "0")}分` : `${minutes}分钟`;

  return { hours, minutes, seconds, text, shortText };
}
