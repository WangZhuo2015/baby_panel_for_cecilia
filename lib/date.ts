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

/** 返回 ISO 日期字符串加 n 天后的 YYYY-MM-DD（纯日历计算，无时区漂移） */
export function addDays(dateStr: string, days: number): string {
  if (!isValidDateStr(dateStr)) return dateStr;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10) - 1;
  const d = parseInt(dayStr, 10);
  const date = new Date(Date.UTC(y, m, d + days));
  const resY = String(date.getUTCFullYear());
  const resM = String(date.getUTCMonth() + 1).padStart(2, "0");
  const resD = String(date.getUTCDate()).padStart(2, "0");
  return `${resY}-${resM}-${resD}`;
}

/**
 * 为指定 YYYY-MM-DD 日期加减自然月（支持月末自动对其，如 1月31日 + 1月 -> 2月28/29日，无月份溢出 Bug）
 */
export function addMonths(dateStr: string, months: number): string {
  if (!isValidDateStr(dateStr)) return dateStr;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);

  const totalMonths = month + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;

  // 目标月份的最大天数（UTC 0 号即上月末日）
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, daysInTargetMonth);

  const y = String(targetYear);
  const m = String(targetMonth + 1).padStart(2, "0");
  const d = String(targetDay).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 计算两个 YYYY-MM-DD 日期的日历天数差（toDate - fromDate）
 */
export function diffCalendarDays(fromDateStr: string, toDateStr: string): number {
  if (!isValidDateStr(fromDateStr) || !isValidDateStr(toDateStr)) return 0;
  const [y1, m1, d1] = fromDateStr.split("-").map(Number);
  const [y2, m2, d2] = toDateStr.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

/**
 * 计算目标日期距离今天（上海时区）的天数差（未来为正，今天为0，过去为负）
 */
export function diffDaysFromToday(targetDateStr: string): number {
  return diffCalendarDays(getLocalDateStr(), targetDateStr);
}

/**
 * 获取指定 YYYY-MM-DD 日期的中文星期几（如 "周一"、"周日"）
 */
export function getWeekdayStr(dateStr: string): string {
  if (!isValidDateStr(dateStr)) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayIndex = date.getUTCDay();
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return weekDays[dayIndex];
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
