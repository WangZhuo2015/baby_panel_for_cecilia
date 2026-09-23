import { BridgeError, type BridgeFetch, pathId, requireData, wireVersion } from "./bridge-protocol";

export interface TimelineDetailReference {
  babyId: string;
  entityType: "feeding" | "sleep" | "diaper" | "food" | "supplement" | "growth" | "medical" | "vaccine";
  entityId: string;
  version: string;
}

type DetailKind = Exclude<TimelineDetailReference["entityType"], "growth" | "medical" | "vaccine">;
export type TimelineDetailRecord = Record<string, unknown> & {
  id: string;
  babyId: string;
  version: string;
};

export interface TimelineDetailMaps {
  feedings: Map<string, TimelineDetailRecord>;
  sleeps: Map<string, TimelineDetailRecord>;
  diapers: Map<string, TimelineDetailRecord>;
  foods: Map<string, TimelineDetailRecord>;
  supplements: Map<string, TimelineDetailRecord>;
}

const KINDS: readonly DetailKind[] = ["feeding", "sleep", "diaper", "food", "supplement"];
// Deliberately below the API maximum: older care repositories cap the internal
// lookahead query at 200. A 100-row wire page works with both deployed versions.
const PAGE_SIZE = 100;
const MAX_SCAN_ITEMS = 20_000;
const MAX_PAGES = MAX_SCAN_ITEMS / PAGE_SIZE;

function invalidRecord(): BridgeError {
  return new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效或跨宝宝的时间线详情");
}

function upstreamVersion(value: unknown): string {
  try { return wireVersion(value); } catch { throw invalidRecord(); }
}

async function loadKind(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  kind: DetailKind,
  wanted: ReadonlyMap<string, string>,
): Promise<Map<string, TimelineDetailRecord>> {
  const found = new Map<string, TimelineDetailRecord>();
  if (wanted.size === 0) return found;
  const missing = new Set(wanted.keys());
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let scanned = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (cursor !== null) query.set("cursor", cursor);
    const response = await fetchApi<unknown>(
      `/api/v1/babies/${pathId(babyId)}/records/${kind}?${query.toString()}`,
      { accessToken: token },
    );
    // In particular, 401/403/429/5xx must never become successful empty maps.
    const items = requireData(response);
    const next = response.page?.nextCursor;
    if (!Array.isArray(items) || items.length > PAGE_SIZE ||
        !(next === null || (typeof next === "string" && next.length > 0))) {
      throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回完整的详情分页信息");
    }
    scanned += items.length;
    if (scanned > MAX_SCAN_ITEMS) break;

    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw invalidRecord();
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id || record.babyId !== babyId) throw invalidRecord();
      if (!wanted.has(record.id)) continue;
      const version = upstreamVersion(record.version);
      if (version !== wanted.get(record.id)) {
        throw new BridgeError(409, "TIMELINE_CHANGED", "记录在读取时间线后已变更，请刷新后重试");
      }
      const detail: TimelineDetailRecord = { ...record, id: record.id, babyId, version };
      // Preserve the canonical field and supply the legacy UI discriminator.
      if (kind === "feeding" && record.feedingType === "bottle") detail.type = "bottle_breast";
      found.set(record.id, detail);
      missing.delete(record.id);
    }
    if (missing.size === 0) return found;
    if (next === null) {
      throw new BridgeError(409, "TIMELINE_DETAILS_MISSING", "部分时间线记录已删除或详情缺失，请刷新后重试");
    }
    if (items.length === 0 || seenCursors.has(next)) {
      throw new BridgeError(502, "UPSTREAM_CURSOR_LOOP", "GrowDesk 详情分页没有继续前进");
    }
    seenCursors.add(next);
    cursor = next;
  }
  throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "详情查询超出兼容接口上限，未返回不完整的编辑数据");
}

/**
 * The native API already exposes scoped per-record GETs. Historical IDs do not
 * require scanning every newer record. A single worker pool bounds concurrency
 * across all domains; one failure cancels siblings and never returns partial maps.
 */
async function loadById(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  wanted: ReadonlyMap<DetailKind, ReadonlyMap<string, string>>,
  signal?: AbortSignal,
): Promise<TimelineDetailMaps> {
  const results = KINDS.map(() => new Map<string, TimelineDetailRecord>());
  const work = KINDS.flatMap((kind, index) =>
    Array.from(wanted.get(kind) ?? [], ([id, version]) => ({ kind, index, id, version })),
  );
  if (work.length > 2000) {
    throw new BridgeError(503, "TIMELINE_DETAIL_LIMIT", "时间线详情过多，请缩小日期范围后重试");
  }
  const cancel = new AbortController();
  const combined = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
  let offset = 0;
  let failed = combined.aborted;
  let failure: unknown = new BridgeError(499, "REQUEST_ABORTED", "请求已取消");
  async function worker() {
    while (!failed && offset < work.length) {
      const item = work[offset++]!;
      try {
        const response = await fetchApi<unknown>(
          `/api/v1/babies/${pathId(babyId)}/records/${item.kind}/${pathId(item.id)}`,
          { accessToken: token, signal: combined },
        );
        if (!response.ok && response.status === 404) {
          throw new BridgeError(409, "TIMELINE_DETAILS_MISSING", "部分时间线记录已删除或详情缺失，请刷新后重试");
        }
        const value = requireData(response);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRecord();
        const record = value as Record<string, unknown>;
        if (record.id !== item.id || record.babyId !== babyId) throw invalidRecord();
        const version = upstreamVersion(record.version);
        if (version !== item.version) {
          throw new BridgeError(409, "TIMELINE_CHANGED", "记录在读取时间线后已变更，请刷新后重试");
        }
        const detail: TimelineDetailRecord = { ...record, id: item.id, babyId, version };
        if (item.kind === "feeding" && record.feedingType === "bottle") detail.type = "bottle_breast";
        results[item.index]!.set(item.id, detail);
      } catch (error) {
        if (!failed) { failed = true; failure = error; cancel.abort(); }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(work.length, 5) }, () => worker()));
  if (failed) throw failure;
  return { feedings: results[0]!, sleeps: results[1]!, diapers: results[2]!, foods: results[3]!, supplements: results[4]! };
}

/**
 * Resolve precisely the IDs referenced by the requested timeline, including
 * records older than the first 200 rows. Keep at most five reads in flight,
 * paginate each domain serially, and stop once every requested ID is resolved.
 * Never downgrade a revoked session, partial page or concurrent edit to a
 * plausible-looking summary that the UI could then use for destructive edits.
 */
export async function fetchTimelineDetailMaps(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  entries: readonly TimelineDetailReference[],
  options: { lookup?: "paged" | "by-id"; signal?: AbortSignal } = {},
): Promise<TimelineDetailMaps> {
  pathId(babyId);
  const wanted = new Map<DetailKind, Map<string, string>>(
    KINDS.map(kind => [kind, new Map<string, string>()]),
  );
  for (const entry of entries) {
    if (!entry || entry.babyId !== babyId || !entry.entityId) throw invalidRecord();
    try { pathId(entry.entityId); } catch { throw invalidRecord(); }
    // Older backends can expose persisted projections outside the care UI.
    // They have no editable care details; unknown kinds still fail closed below.
    if (entry.entityType === "growth" || entry.entityType === "vaccine" || entry.entityType === "medical") continue;
    const bucket = wanted.get(entry.entityType);
    if (!bucket) throw invalidRecord();
    const version = upstreamVersion(entry.version);
    const previous = bucket.get(entry.entityId);
    if (previous !== undefined && previous !== version) throw invalidRecord();
    bucket.set(entry.entityId, version);
  }
  if (options.lookup === "by-id") return loadById(fetchApi, token, babyId, wanted, options.signal);
  const results = await Promise.all(KINDS.map(kind => loadKind(fetchApi, token, babyId, kind, wanted.get(kind)!)));
  return {
    feedings: results[0]!,
    sleeps: results[1]!,
    diapers: results[2]!,
    foods: results[3]!,
    supplements: results[4]!,
  };
}
