/* Fetch caching / deduplication - deep module with injectable time/store.
 * Usage:
 *   const cache = createCache({ ttl: 30_000, now: () => Date.now() });
 *   cache.isFresh("user") ; cache.markFetched("user")
 * Backward compat: module-level singletons delegate to defaultCache.
 */
export const STALE_MS = 30_000;

export interface CacheConfig {
  ttl?: number;
  now?: () => number;
}

export interface CachePort {
  readonly ttl: number;
  readonly _fetchedAt: Record<string, number>;
  readonly _inflight: Record<string, Promise<unknown> | undefined>;
  isFresh(key: string): boolean;
  markFetched(key: string): void;
  invalidateCache(prefix?: string): void;
  dedup<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export function createCache(config: CacheConfig = {}): CachePort {
  const ttl = config.ttl ?? STALE_MS;
  const now = config.now ?? (() => Date.now());
  const fetchedAt: Record<string, number> = {};
  const inflight: Record<string, Promise<unknown> | undefined> = {};

  function isFresh(key: string): boolean {
    return now() - (fetchedAt[key] || 0) < ttl;
  }
  function markFetched(key: string): void {
    fetchedAt[key] = now();
  }
  function invalidateCache(prefix?: string): void {
    if (!prefix) {
      for (const k in fetchedAt) delete fetchedAt[k];
      return;
    }
    for (const k in fetchedAt) {
      if (k === prefix || k.startsWith(`${prefix}:`)) {
        delete fetchedAt[k];
      }
    }
  }
  function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inflight[key] as Promise<T> | undefined;
    if (existing) return existing;
    const p = fn().finally(() => {
      inflight[key] = undefined;
    }) as Promise<T>;
    inflight[key] = p as Promise<unknown>;
    return p;
  }

  return {
    get ttl() {
      return ttl;
    },
    _fetchedAt: fetchedAt,
    _inflight: inflight,
    isFresh,
    markFetched,
    invalidateCache,
    dedup,
  };
}

/** Alias required by handoff: factory `createCachedFetcher({ttl, now})` */
export const createCachedFetcher = createCache;

/* ── Default singleton (backward compat) ── */
const defaultCache = createCache();

export const _fetchedAt: Record<string, number> = defaultCache._fetchedAt;
export const _inflight: Record<string, Promise<unknown> | undefined> = defaultCache._inflight;

export function isFresh(key: string): boolean {
  return defaultCache.isFresh(key);
}
export function markFetched(key: string): void {
  return defaultCache.markFetched(key);
}
export function invalidateCache(prefix?: string): void {
  return defaultCache.invalidateCache(prefix);
}
export function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return defaultCache.dedup(key, fn);
}

export function toQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, v);
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

// For testing: expose internal maps (legacy)
export const _internal = { _fetchedAt, _inflight };
// Also expose factory for injection in tests/slices
export const _createCache = createCache;
