import { addDays, isValidDateStr } from "./date";
import { dayBoundsInTimeZone } from "./growdesk/record-list";

export interface TrendFeeding { timestamp: string; amountMl: number | null; leftMinutes: number | null; rightMinutes: number | null }
export interface TrendSleep { startTime: string; endTime: string | null }
export interface TrendDiaper { timestamp: string }
export interface TrendFood { date: string }
export interface CareTrendDay {
  date: string;
  recordedMilkMl: number | null;
  feedingCount: number;
  breastMinutes: number;
  sleepMinutes: number | null;
  diaperCount: number;
  foodCount: number;
  hasRecords: boolean;
}
export interface CareTrends {
  babyId: string;
  timeZone: string;
  startDate: string;
  endDate: string;
  today: string;
  days: CareTrendDay[];
}
export function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("记录时间无效，无法统计趋势");
  return result;
}
function positive(value: number | null): number {
  if (value === null) return 0;
  if (!Number.isFinite(value) || value < 0) throw new Error("记录数值无效，无法统计趋势");
  return value;
}
/** Real recorded volumes only. Gaps stay null; overlapping sleep is counted once. */
export function aggregateCareTrends(input: {
  babyId: string; timeZone: string; endDate: string; days: 7 | 30;
  feeding: TrendFeeding[]; sleep: TrendSleep[]; diaper: TrendDiaper[]; food?: TrendFood[]; now?: Date;
}): CareTrends {
  if (!isValidDateStr(input.endDate) || ![7, 30].includes(input.days)) throw new Error("趋势日期或范围无效");
  const now = input.now ?? new Date();
  const startDate = addDays(input.endDate, 1 - input.days);
  const feeding = input.feeding.map(r => ({ ...r, at: timestamp(r.timestamp) }));
  const diapers = input.diaper.map(r => timestamp(r.timestamp));
  const foods = (input.food ?? []).map(r => {
    if (!isValidDateStr(r.date)) throw new Error("辅食日期无效，无法统计趋势");
    return r.date;
  });
  const sleeps = input.sleep.map(r => {
    const start = timestamp(r.startTime);
    const end = r.endTime === null ? now.getTime() : timestamp(r.endTime);
    if (end < start) throw new Error("睡眠结束时间早于开始时间");
    return { start, end };
  });
  const days: CareTrendDay[] = Array.from({ length: input.days }, (_, index) => {
    const date = addDays(startDate, index);
    const bounds = dayBoundsInTimeZone(date, input.timeZone);
    const start = bounds.start.getTime(), end = bounds.end.getTime();
    const feeds = feeding.filter(r => r.at >= start && r.at < end);
    const measured = feeds.filter(r => r.amountMl !== null);
    const intervals = sleeps.map(r => ({ start: Math.max(start, r.start), end: Math.min(end, r.end) }))
      .filter(r => r.end > r.start).sort((a, b) => a.start - b.start);
    let sleepMs = 0, lastEnd = -Infinity;
    for (const interval of intervals) {
      sleepMs += Math.max(0, interval.end - Math.max(interval.start, lastEnd));
      lastEnd = Math.max(lastEnd, interval.end);
    }
    const diaperCount = diapers.filter(at => at >= start && at < end).length;
    const foodCount = foods.filter(recordDate => recordDate === date).length;
    return {
      date,
      recordedMilkMl: measured.length ? Math.round(measured.reduce((sum, r) => sum + positive(r.amountMl), 0) * 100) / 100 : null,
      feedingCount: feeds.length,
      breastMinutes: feeds.reduce((sum, r) => sum + positive(r.leftMinutes) + positive(r.rightMinutes), 0),
      sleepMinutes: intervals.length ? Math.round(sleepMs / 60000) : null,
      diaperCount,
      foodCount,
      hasRecords: feeds.length > 0 || intervals.length > 0 || diaperCount > 0 || foodCount > 0,
    };
  });
  return { babyId: input.babyId, timeZone: input.timeZone, startDate, endDate: input.endDate, today: dateInTimeZone(now, input.timeZone), days };
}
