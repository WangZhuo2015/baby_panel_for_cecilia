/**
 * 智能通知状态管理（24小时自动归档与自清理）
 */

const READ_KEY = "baby_read_notifications";
const CLEARED_BEFORE_KEY = "baby_notifications_cleared_before";
const DISMISSED_KEY = "baby_dismissed_notifications_v2";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24小时自然生命周期

interface TimestampedEntry {
  id: string;
  ts: number;
}

export function getClearedBeforeTime(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(CLEARED_BEFORE_KEY);
    const ts = raw ? parseInt(raw, 10) : 0;
    if (Date.now() - ts > MAX_AGE_MS) {
      localStorage.removeItem(CLEARED_BEFORE_KEY);
      return 0;
    }
    return ts;
  } catch {
    return 0;
  }
}

export function setClearedBeforeTime(timestamp: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLEARED_BEFORE_KEY, timestamp.toString());
  } catch {}
}

export function getDismissedNotificationIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const entries: TimestampedEntry[] = JSON.parse(raw);
    const now = Date.now();
    // 自动清理超过 24 小时的旧记录，不无限膨胀
    const valid = entries.filter((e) => now - e.ts < MAX_AGE_MS);
    if (valid.length !== entries.length) {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(valid));
    }
    return new Set(valid.map((e) => e.id));
  } catch {
    return new Set();
  }
}

export function addDismissedNotificationId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    const entries: TimestampedEntry[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const valid = entries.filter((e) => now - e.ts < MAX_AGE_MS && e.id !== id);
    valid.push({ id, ts: now });
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(valid));
  } catch {}
}

export function getReadNotificationIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const entries: TimestampedEntry[] = JSON.parse(raw);
    const now = Date.now();
    const valid = entries.filter((e) => now - e.ts < MAX_AGE_MS);
    if (valid.length !== entries.length) {
      localStorage.setItem(READ_KEY, JSON.stringify(valid));
    }
    return new Set(valid.map((e) => e.id));
  } catch {
    return new Set();
  }
}

export function markNotificationRead(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(READ_KEY);
    const entries: TimestampedEntry[] = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    const valid = entries.filter((e) => now - e.ts < MAX_AGE_MS && e.id !== id);
    valid.push({ id, ts: now });
    localStorage.setItem(READ_KEY, JSON.stringify(valid));
  } catch {}
}

export function markAllNotificationsRead(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const entries: TimestampedEntry[] = ids.map((id) => ({ id, ts: now }));
    localStorage.setItem(READ_KEY, JSON.stringify(entries));
  } catch {}
}

export function filterVisibleNotifications<T extends { id: string; createdAt?: number }>(items: T[]): T[] {
  const clearedBefore = getClearedBeforeTime();
  const dismissedIds = getDismissedNotificationIds();

  return items.filter((item) => {
    // 超过24小时的通知自然归档过期
    if (item.createdAt && Date.now() - item.createdAt > MAX_AGE_MS) {
      return false;
    }
    // 全部清除时间点之前的通知被过滤
    if (clearedBefore > 0 && item.createdAt && item.createdAt <= clearedBefore) {
      return false;
    }
    // 单条被划掉清除的通知被过滤
    if (dismissedIds.has(item.id)) {
      return false;
    }
    return true;
  });
}

export function calculateUnreadCount(notifications: { id: string; createdAt?: number }[]): number {
  const visible = filterVisibleNotifications(notifications);
  const readIds = getReadNotificationIds();
  return visible.filter((n) => !readIds.has(n.id)).length;
}
