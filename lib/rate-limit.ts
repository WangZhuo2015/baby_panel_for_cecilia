/**
 * Lightweight in-memory sliding window rate limiter
 */

interface RateLimitRecord {
  timestamps: number[];
}

const store = new Map<string, RateLimitRecord>();

// 防止内存 DoS：最多追踪的键数量，超出时淘汰最早的键
const MAX_STORE_KEYS = 10_000;

function ensureStoreCapacity() {
  while (store.size >= MAX_STORE_KEYS) {
    const oldestKey = store.keys().next().value;
    if (oldestKey === undefined) break;
    store.delete(oldestKey);
  }
}

// Cleanup stale records every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 300_000);
      if (record.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }, 300_000);
}

/**
 * 提取客户端真实 IP。
 *
 * 信任模型（由 TRUST_PROXY 环境变量控制，默认开启）：
 * - TRUST_PROXY!=false：应用部署在可信反向代理（nginx/Caddy）之后。
 *   顺序：x-real-ip（代理覆写）→ x-forwarded-for 末段（最靠近服务的代理追加）。
 *   ⚠️ 此时必须确保反代会覆写/清除客户端自带的这些头（nginx 默认行为），
 *   且不要把应用端口直接暴露公网绕过代理。
 * - TRUST_PROXY=false：应用直接暴露公网，任何转发头都不可信，
 *   全部请求归入同一桶（保守但不可绕过）。
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY === "false") {
    return "direct";
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const segments = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
  }
  return "127.0.0.1";
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000
): RateLimitResult {
  const now = Date.now();
  let record = store.get(key);

  if (!record) {
    ensureStoreCapacity();
    record = { timestamps: [] };
    store.set(key, record);
  } else {
    // LRU 触碰：命中即移到 Map 尾部，避免容量淘汰误删活跃用户的窗口记录
    store.delete(key);
    store.set(key, record);
  }

  // Filter timestamps within window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const resetSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      success: false,
      limit,
      remaining: 0,
      resetSeconds: Math.max(1, resetSeconds),
    };
  }

  record.timestamps.push(now);
  return {
    success: true,
    limit,
    remaining: limit - record.timestamps.length,
    resetSeconds: Math.ceil(windowMs / 1000),
  };
}
