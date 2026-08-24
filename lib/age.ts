// Age calculation utilities shared across client and server components.
// Uses Asia/Shanghai timezone consistently for date calculations.

export interface AgeDetail {
  months: number;
  days: number;
  totalDays: number;
  label: string;
}

export interface AgeSummary {
  months: number;
  days: number;
  totalDays: number;
  label: string;
}

/**
 * Robust, authoritative age detail calculation from birth date (YYYY-MM-DD).
 * Returns months, days, totalDays, and formatted label e.g. "5个月20天 (第173天)".
 */
export function calculateAgeDetail(
  birthDate: string,
  targetDate?: string | Date
): AgeDetail {
  if (!birthDate || typeof birthDate !== "string") {
    return { months: 0, days: 0, totalDays: 0, label: "0个月0天 (第0天)" };
  }

  const cleanBirth = birthDate.slice(0, 10);
  const [by, bm, bd] = cleanBirth.split("-").map(Number);
  if (!by || !bm || !bd || Number.isNaN(by) || Number.isNaN(bm) || Number.isNaN(bd)) {
    return { months: 0, days: 0, totalDays: 0, label: "0个月0天 (第0天)" };
  }

  let target = new Date();
  if (targetDate) {
    if (typeof targetDate === "string") {
      const parsed = new Date(targetDate.includes("T") ? targetDate : `${targetDate.slice(0, 10)}T00:00:00+08:00`);
      if (!Number.isNaN(parsed.getTime())) target = parsed;
    } else if (targetDate instanceof Date && !Number.isNaN(targetDate.getTime())) {
      target = targetDate;
    }
  }

  const birthMs = new Date(`${cleanBirth}T00:00:00+08:00`).getTime();
  const targetMs = target.getTime();
  const totalDays = Math.max(0, Math.floor((targetMs - birthMs) / (1000 * 60 * 60 * 24)));

  const targetParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(target);

  const map: Record<string, number> = {};
  for (const p of targetParts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }

  const ty = map.year || target.getFullYear();
  const tm = map.month || (target.getMonth() + 1);
  const td = map.day || target.getDate();

  let months = (ty - by) * 12 + (tm - bm);
  let days = td - bd;

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(ty, tm - 1, 0).getDate();
    days += prevMonthDays;
  }

  months = Math.max(0, months);
  days = Math.max(0, days);

  return {
    months,
    days,
    totalDays,
    label: `${months}个月${days}天 (第${totalDays}天)`,
  };
}

/**
 * Standard age calculation from birth date (YYYY-MM-DD).
 * Returns { months, days, totalDays, label: "X月Y天" }.
 */
export function calculateAge(
  birthDate: string,
  targetDate?: string | Date
): AgeSummary {
  const detail = calculateAgeDetail(birthDate, targetDate);
  return {
    months: detail.months,
    days: detail.days,
    totalDays: detail.totalDays,
    label: `${detail.months}月${detail.days}天`,
  };
}

