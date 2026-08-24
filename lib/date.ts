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

/** Validate whether a date string is a valid calendar date in YYYY-MM-DD format */
export function isValidDateStr(dateStr: string): boolean {
  if (typeof dateStr !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const parsed = new Date(`${dateStr}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return false;
  const parts = partsInTz(parsed, { year: "numeric", month: "2-digit", day: "2-digit" });
  return Number(parts.year) === year && Number(parts.month) === month && Number(parts.day) === day;
}

/** Local (Asia/Shanghai) date as YYYY-MM-DD. */
export function getLocalDateStr(date: Date = new Date()): string {
  const validDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = partsInTz(validDate, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Local (Asia/Shanghai) time as HH:MM (24h). */
export function getLocalTimeStr(date = new Date()): string {
  const validDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const p = partsInTz(validDate, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${p.hour}:${p.minute}`;
}

/** Format an ISO timestamp as local (Asia/Shanghai) HH:MM. */
export function formatIsoToLocalTime(iso: string): string {
  if (!iso) return "";
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
  if (!dayStr || !isValidDateStr(dayStr)) {
    // Impossible range so gte: start, lt: end returns 0 rows instead of full-table scan
    return { start: "9999-12-31T23:59:59.999Z", end: "1970-01-01T00:00:00.000Z" };
  }
  const start = new Date(`${dayStr}T00:00:00+08:00`).getTime();
  if (Number.isNaN(start)) {
    return { start: "9999-12-31T23:59:59.999Z", end: "1970-01-01T00:00:00.000Z" };
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
  if (!hhmm || typeof hhmm !== "string") {
    return new Date().toISOString();
  }
  const parts = hhmm.trim().split(":");
  if (parts.length < 2) {
    return new Date().toISOString();
  }
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return new Date().toISOString();
  }
  const padded = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const isoStr = `${getLocalDateStr()}T${padded}:00+08:00`;
  const parsed = new Date(isoStr);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}
