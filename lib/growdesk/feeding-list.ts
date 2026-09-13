import { type BridgeFetch, type ApiBaby, BridgeError, requireData, calendarDate, pathId } from "./bridge-protocol";

export interface DatedFeeding { occurredAt: string }

/**
 * Preserve the legacy date-filtered array API while consuming canonical keyset pages.
 * A safety cap fails explicitly rather than returning a silently truncated history.
 * The API still owns authorization; the BFF only translates list/query semantics.
 */
export async function fetchLegacyFeedingList<T extends DatedFeeding>(
  fetchApi: BridgeFetch, token: string, babyId: string, query: URLSearchParams,
): Promise<T[]> {
  const date = query.has("date") ? calendarDate(query.get("date")) : null;
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? 20_000 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20_000) throw new BridgeError(400, "INVALID_LIMIT", "limit 必须为 1–20000 的整数");
  if (query.has("cursor")) throw new BridgeError(400, "LEGACY_CURSOR_UNSUPPORTED", "此旧版数组接口不接收游标，请使用新 API 分页接口");
  const encodedBaby = pathId(babyId);
  let formatter: Intl.DateTimeFormat | undefined;
  if (date) {
    const baby = requireData(await fetchApi<ApiBaby>(`/api/v1/babies/${encodedBaby}`, { accessToken: token }));
    const family = requireData(await fetchApi<{ timeZone: string }>(`/api/v1/families/${pathId(baby.familyId)}`, { accessToken: token }));
    try {
      if (!family.timeZone) throw new Error("Missing timezone");
      formatter = new Intl.DateTimeFormat("en-CA", { timeZone: family.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch { throw new BridgeError(502, "UPSTREAM_INVALID_TIMEZONE", "家庭时区配置无效"); }
  }
  const out: T[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const params = new URLSearchParams({ limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetchApi<T[]>(`/api/v1/babies/${encodedBaby}/records/feeding?${params}`, { accessToken: token });
    const items = requireData(response);
    if (!Array.isArray(items) || !response.page || !(response.page.nextCursor === null || typeof response.page.nextCursor === "string")) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回完整的分页信息");
    }
    for (const item of items) {
      const instant = new Date(item.occurredAt);
      if (!Number.isFinite(instant.getTime())) throw new BridgeError(502, "UPSTREAM_INVALID_TIMESTAMP", "GrowDesk 返回了无效的记录时间");
      let localDate: string | undefined;
      if (formatter) {
        const parts = formatter.formatToParts(instant);
        const part = (key: string) => parts.find(p => p.type === key)?.value;
        localDate = `${part("year")}-${part("month")}-${part("day")}`;
      }
      if (!date || localDate === date) out.push(item);
      if (rawLimit !== null && out.length >= limit) return out;
    }
    cursor = response.page.nextCursor;
    if (cursor === null) return out;
    if (!cursor || visited.has(cursor)) throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 返回了重复的分页游标");
    visited.add(cursor);
  }
  throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "记录量超出兼容接口上限，未返回截断数据");
}
