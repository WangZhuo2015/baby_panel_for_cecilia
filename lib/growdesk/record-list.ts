import {
  type ApiBaby,
  type BridgeFetch,
  BridgeError,
  calendarDate,
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

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return asUtc - instant.getTime();
}

/** Convert a local midnight to UTC without relying on the Node host timezone. */
function localMidnight(date: string, timeZone: string): Date {
  const localUtcGuess = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(localUtcGuess)) throw new BridgeError(502, "UPSTREAM_INVALID_DATE", "无法计算家庭时区日期边界");
  let utc = localUtcGuess;
  for (let i = 0; i < 3; i += 1) utc = localUtcGuess - timeZoneOffsetMs(new Date(utc), timeZone);
  return new Date(utc);
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
  return { start: localMidnight(date, timeZone), end: localMidnight(nextCalendarDate(date), timeZone), timeZone };
}

function nextCalendarDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function parseInstant(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) {
    throw new BridgeError(502, "UPSTREAM_INVALID_TIMESTAMP", "GrowDesk 返回了无效的记录时间");
  }
  return new Date(value);
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
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SCAN_ITEMS) {
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
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const params = new URLSearchParams({ limit: String(UPSTREAM_PAGE_SIZE) });
    if (cursor !== null) params.set("cursor", cursor);
    const response = await fetchApi<T[]>(`${endpointFor(kind, babyId)}?${params.toString()}`, { accessToken: token });
    const items = requireData(response);
    if (!Array.isArray(items) || !response.page || !(response.page.nextCursor === null || typeof response.page.nextCursor === "string")) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回完整的分页信息");
    }

    for (const item of items) {
      let include = true;
      if (kind === "food") {
        if (item.recordDate !== null && item.recordDate !== undefined) calendarDate(item.recordDate);
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
