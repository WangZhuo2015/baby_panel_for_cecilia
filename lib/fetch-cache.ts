/* Fetch caching / deduplication - extracted from stores/useBabyStore for modularity */
export const STALE_MS = 30_000;

export const _fetchedAt: Record<string, number> = {};
export const _inflight: Record<string, Promise<void> | undefined> = {};

export function isFresh(key: string): boolean {
  return Date.now() - (_fetchedAt[key] || 0) < STALE_MS;
}

export function markFetched(key: string): void {
  _fetchedAt[key] = Date.now();
}

export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    for (const k in _fetchedAt) delete _fetchedAt[k];
    return;
  }
  for (const k in _fetchedAt) {
    if (k === prefix || k.startsWith(`${prefix}:`)) {
      delete _fetchedAt[k];
    }
  }
}

export function dedup(key: string, fn: () => Promise<void>): Promise<void> {
  if (_inflight[key]) return _inflight[key]!;
  const p = fn().finally(() => { _inflight[key] = undefined; });
  _inflight[key] = p;
  return p;
}

export function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, v);
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

// For testing: expose internal maps
export const _internal = { _fetchedAt, _inflight };
