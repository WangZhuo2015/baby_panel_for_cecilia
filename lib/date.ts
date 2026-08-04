// Shared date/time helpers. The app's target audience is in China, so all
// "today" / time-of-day logic uses Asia/Shanghai regardless of server TZ.

const TZ = "Asia/Shanghai";

function partsInTz(
  date: Date,
  opts: Intl.DateTimeFormatOptions
): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    ...opts,
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
}

/** Local (Asia/Shanghai) date as YYYY-MM-DD. */
export function getLocalDateStr(date = new Date()): string {
  const p = partsInTz(date, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local (Asia/Shanghai) time as HH:MM (24h). */
export function getLocalTimeStr(date = new Date()): string {
  const p = partsInTz(date, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${p.hour}:${p.minute}`;
}

/** Format an ISO timestamp as local (Asia/Shanghai) HH:MM. */
export function formatIsoToLocalTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  return getLocalTimeStr(parsed);
}

/**
 * UTC ISO bounds for a local (Asia/Shanghai) calendar day, so that records
 * stored as UTC ISO strings can be queried with gte/lt string comparison.
 */
export function getLocalDayUtcRange(dayStr: string): {
  start: string;
  end: string;
} {
  const start = new Date(`${dayStr}T00:00:00+08:00`).getTime();
  if (Number.isNaN(start)) {
    return { start: "", end: "" };
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** UTC ISO bounds for today (Asia/Shanghai). */
export function getTodayUtcRange(date = new Date()): {
  start: string;
  end: string;
} {
  return getLocalDayUtcRange(getLocalDateStr(date));
}

/** Combine today's local date with an HH:MM input and store as UTC ISO. */
export function localTimeToUtcIso(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    return new Date().toISOString();
  }
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  return local.toISOString();
}
