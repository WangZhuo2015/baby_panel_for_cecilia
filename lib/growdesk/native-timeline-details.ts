import { BridgeError, type BridgeFetch, pathId, requireData, wireVersion } from "./bridge-protocol";
import type { TimelineDetailMaps, TimelineDetailRecord, TimelineDetailReference } from "./timeline-details";

const DETAIL_BUCKETS = {
  feeding: "feedings",
  sleep: "sleeps",
  diaper: "diapers",
  food: "foods",
  supplement: "supplements",
} as const;
type DetailKind = keyof typeof DETAIL_BUCKETS;
const READ_CONCURRENCY = 5;
// Keep the same total bound as the legacy array endpoint. This bounds requested
// records, not a scan through unrelated history. No partial arrays are returned.
const MAX_REFERENCES = 20_000;

function invalidRecord(): BridgeError {
  return new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了无效或跨家庭、宝宝的时间线详情");
}

function versionOf(value: unknown): string {
  try { return wireVersion(value); } catch { throw invalidRecord(); }
}

function detailKind(value: string): value is DetailKind {
  return Object.prototype.hasOwnProperty.call(DETAIL_BUCKETS, value);
}

/**
 * Native Go implements each scoped detail endpoint. Fetch the referenced IDs
 * directly rather than scanning up to 20,000 historical rows per record kind.
 * Validate the entire reference list before I/O, deduplicate within each kind,
 * and use one shared worker pool across all five kinds. A failed read stops new
 * dispatch; already-started reads are joined before the error is returned.
 */
export async function fetchNativeTimelineDetailMaps(
  fetchApi: BridgeFetch,
  token: string,
  babyId: string,
  familyId: string,
  entries: readonly TimelineDetailReference[],
): Promise<TimelineDetailMaps> {
  const babyPath = pathId(babyId);
  pathId(familyId);
  if (entries.length > MAX_REFERENCES) {
    throw new BridgeError(503, "HISTORY_SCAN_LIMIT", "时间线记录超出兼容接口上限，未返回截断数据");
  }
  const maps: TimelineDetailMaps = {
    feedings: new Map(), sleeps: new Map(), diapers: new Map(), foods: new Map(), supplements: new Map(),
  };
  const references = new Map<string, { kind: DetailKind; id: string; version: string }>();
  for (const entry of entries) {
    if (!entry || entry.babyId !== babyId) throw invalidRecord();
    try { pathId(entry.entityId); } catch { throw invalidRecord(); }
    // These projections are not editable care records in the legacy timeline.
    if (entry.entityType === "growth" || entry.entityType === "medical" || entry.entityType === "vaccine") continue;
    if (!detailKind(entry.entityType)) throw invalidRecord();
    const version = versionOf(entry.version);
    const key = `${entry.entityType}:${entry.entityId}`;
    const previous = references.get(key);
    if (previous && previous.version !== version) throw invalidRecord();
    references.set(key, { kind: entry.entityType, id: entry.entityId, version });
  }
  const work = [...references.values()];
  let position = 0;
  let failed = false;
  let failure: unknown;
  async function worker(): Promise<void> {
    while (!failed && position < work.length) {
      const reference = work[position++]!;
      try {
        const response = await fetchApi<unknown>(
          `/api/v1/babies/${babyPath}/records/${reference.kind}/${pathId(reference.id)}`,
          { accessToken: token },
        );
        if (!response.ok && response.status === 404) {
          throw new BridgeError(409, "TIMELINE_DETAILS_MISSING", "部分时间线记录已删除或不可访问，请刷新后重试");
        }
        const value = requireData(response);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidRecord();
        const row = value as Record<string, unknown>;
        if (row.id !== reference.id || row.babyId !== babyId || row.familyId !== familyId) throw invalidRecord();
        const version = versionOf(row.version);
        if (version !== reference.version) {
          throw new BridgeError(409, "TIMELINE_CHANGED", "记录在读取时间线后已变更，请刷新后重试");
        }
        const record: TimelineDetailRecord = { ...row, id: reference.id, babyId, version };
        if (reference.kind === "feeding" && row.feedingType === "bottle") record.type = "bottle_breast";
        maps[DETAIL_BUCKETS[reference.kind]].set(reference.id, record);
      } catch (error) {
        if (!failed) { failed = true; failure = error; }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, work.length) }, () => worker()));
  if (failed) throw failure;
  return maps;
}
