import {
  type ApiBaby,
  type BridgeFetch,
  BridgeError,
  calendarDate,
  isoTimestamp,
  pathId,
  requireData,
} from "./bridge-protocol";

/** The old Web handlers return an array, while GrowDesk uses keyset pages. */
export type LegacyRecordKind = "feeding" | "sleep" | "diaper" | "food" | "timeline";

export interface DatedRecord {
  occurredAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  recordDate?: string | null;
}

const MAX_SCAN_ITEMS = 20_000;
const UPSTREAM_PAGE_SIZE = 200;
const MAX_PAGES = Math.ceil(MAX_SCAN_ITEMS / UPSTREAM_PAGE_SIZE);

/**
 * First instant of an IANA calendar day, not "midnight minus today's offset".
 * Searching calendar boundaries handles 23/25-hour days and midnight DST gaps
 * without depending on the host timezone or assuming every day is 24 hours.
 */
export function dayBoundsInTimeZone(date: string, timeZone: string): { start: Date; end: Date; timeZone: string } {
  calendarDate(date);
  let formatter: Intl.DateTimeFormat;
  try {
    if (!timeZone.trim()) throw new Error("Missing timezone");
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, calendar: "iso8601", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMEZONE", "家庭时区配置无效");
  }
  const localDate = (instant: number): string => {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    return `${value("year").padStart(4, "0")}-${value("month")}-${value("day")}`;
  };
  const boundary = (day: string): number => {
    const guess = Date.parse(`${day}T00:00:00.000Z`);
    const margin = 36 * 60 * 60 * 1000;
    let low = guess - margin;
    let high = guess + margin;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(mid) < day) low = mid;
      else high = mid;
    }
    return high;
  };
  const start = boundary(date);
  if (localDate(start) !== date) {
    throw new BridgeError(400, "NONEXISTENT_LOCAL_DATE", "该日期在家庭时区中不存在");
  }
  // The next calendar date can itself be skipped (e.g. a date-line change).
  const end = boundary(nextCalendarDate(date));
  return { start: new Date(start), end: new Date(end), timeZone };
}

export async function familyTimeZone(fetchApi: BridgeFetch, token: string, babyId: string): Promise<string> {
  const baby = requireData(await fetchApi<ApiBaby>(`/api/v1/babies/${pathId(babyId)}`, { accessToken: token }));
  const family = requireData(await fetchApi<{ timeZone: string }>(`/api/v1/families/${pathId(baby.familyId)}`, { accessToken: token }));
  try {
    if (typeof family.timeZone !== "string" || !family.timeZone.trim()) throw new Error("Missing timezone");
    new Intl.DateTimeFormat("en-CA", { timeZone: family.timeZone }).format();
    return family.timeZone;
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMEZONE", "家庭时区配置无效");
  }
}

export async function familyDayBounds(fetchApi: BridgeFetch, token: string, babyId: string, date: string): Promise<{ start: Date; end: Date; timeZone: string }> {
  const timeZone = await familyTimeZone(fetchApi, token, babyId);
  return dayBoundsInTimeZone(date, timeZone);
}

function nextCalendarDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function parseInstant(value: unknown): Date {
  try {
    return new Date(isoTimestamp(value));
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMESTAMP", "GrowDesk 返回了无效的记录时间");
  }
}

function endpointFor(kind: LegacyRecordKind, babyId: string): string {
  const encodedBaby = pathId(babyId);
  return kind === "timeline"
    ? `/api/v1/babies/${encodedBaby}/timeline`
    : `/api/v1/babies/${encodedBaby}/records/${kind}`;
}

function validateLimit(query: URLSearchParams): { limit: number; explicit: boolean } {
  const raw = query.get("limit");
  const limit = raw === null ? MAX_SCAN_ITEMS : Number(raw);
  if ((raw !== null && !/^[1-9]\d*$/.test(raw)) || !Number.isInteger(limit) || limit < 1 || limit > MAX_SCAN_ITEMS) {
    throw new BridgeError(400, "INVALID_LIMIT", "limit 必须为 1–20000 的整数");
  }
  return { limit, explicit: raw !== null };
}

/**
 * Fetch a complete legacy-compatible array from a canonical keyset endpoint.
 * Date filtering is deliberately local: the v1 list contract has no date query,
 * and the old handlers define dates in the family's IANA timezone.
 */
export async function fetchLegacyRecordList<T extends DatedRecord>(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  query: URLSearchParams,
  kind: LegacyRecordKind,
): Promise<T[]> {
  const date = query.has("date") ? calendarDate(query.get("date")) : null;
  if (query.has("cursor")) {
    throw new BridgeError(400, "LEGACY_CURSOR_UNSUPPORTED", "此旧版数组接口不接收游标，请使用新 API 分页接口");
  }
  const { limit, explicit } = validateLimit(query);

  let dayStart: Date | undefined;
  let dayEnd: Date | undefined;
  if (date && kind !== "food") {
    const bounds = await familyDayBounds(fetchApi, token, babyId, date);
    dayStart = bounds.start;
    dayEnd = bounds.end;
  }

  const out: T[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const params = new URLSearchParams({ limit: String(UPSTREAM_PAGE_SIZE) });
    if (cursor !== null) params.set("cursor", cursor);
    const response = await fetchApi<T[]>(`${endpointFor(kind, babyId)}?${params.toString()}`, { accessToken: token });
    const items = requireData(response);
    if (!Array.isArray(items) || items.length > UPSTREAM_PAGE_SIZE || !response.page || !(response.page.nextCursor === null || typeof response.page.nextCursor === "string")) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回完整的分页信息");
    }

    scanned += items.length;
    if (scanned > MAX_SCAN_ITEMS) throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "记录量超出兼容接口上限，未返回截断数据");
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效的记录");
      }
      let include = true;
      if (kind === "food") {
        try { calendarDate(item.recordDate); } catch {
          throw new BridgeError(502, "UPSTREAM_INVALID_DATE", "GrowDesk 返回了无效的辅食日期");
        }
        include = !date || item.recordDate === date;
      } else if (kind === "sleep") {
        const startedAt = parseInstant(item.startedAt);
        const endedAt = item.endedAt === null || item.endedAt === undefined ? null : parseInstant(item.endedAt);
        if (endedAt && endedAt.getTime() < startedAt.getTime()) {
          throw new BridgeError(502, "UPSTREAM_INVALID_INTERVAL", "GrowDesk 返回了无效的睡眠时间区间");
        }
        include = !date || (startedAt < dayEnd! && (endedAt === null || endedAt > dayStart!));
      } else {
        const occurredAt = parseInstant(item.occurredAt);
        include = !date || (occurredAt >= dayStart! && occurredAt < dayEnd!);
      }
      if (include) out.push(item);
      if (explicit && out.length >= limit) return out.slice(0, limit);
      if (out.length > MAX_SCAN_ITEMS) throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "记录量超出兼容接口上限，未返回截断数据");
    }

    cursor = response.page.nextCursor;
    if (cursor === null) return out;
    if (pageNumber + 1 >= MAX_PAGES) throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "记录量超出兼容接口上限，未返回截断数据");
    if (!cursor || visited.has(cursor)) throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 返回了重复的分页游标");
    visited.add(cursor);
  }
  throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "记录量超出兼容接口上限，未返回截断数据");
}
