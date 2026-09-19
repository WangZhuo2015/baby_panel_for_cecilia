import { BridgeError, requireData, type BridgeFetch } from "./bridge-protocol";

/** Exhaust a canonical list, or fail explicitly; a truncated list is not a complete history. */
export async function fetchCompleteList<T>(fetchApi: BridgeFetch, token: string, endpoint: string): Promise<T[]> {
  const records: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ limit: "100" });
    if (cursor) params.set("cursor", cursor);
    const response = await fetchApi<T[]>(`${endpoint}?${params}`, { accessToken: token });
    const data = requireData(response);
    if (!Array.isArray(data) || !response.page || !(response.page.nextCursor === null || typeof response.page.nextCursor === "string")) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 分页响应无效");
    }
    records.push(...data);
    cursor = response.page.nextCursor;
    if (cursor === null) return records;
    if (!cursor || seen.has(cursor)) throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 分页游标重复");
    seen.add(cursor);
  }
  throw new BridgeError(502, "UPSTREAM_SCAN_LIMIT", "历史记录读取超出范围，未返回不完整统计");
}
