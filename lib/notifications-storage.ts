/**
 * 智能通知状态管理（24小时自动归档与自清理，多版本全兼容）
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
    const raw = localStorage.getItem(DISMISSED_KEY) || localStorage.getItem("baby_cleared_notifications");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const now = Date.now();
    const set = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string") {
        set.add(item);
      } else if (item && typeof item.id === "string") {
        if (!item.ts || now - item.ts < MAX_AGE_MS) {
          set.add(item.id);
        }
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

export function addDismissedNotificationId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getDismissedNotificationIds();
    existing.add(id);
    const now = Date.now();
    const entries: TimestampedEntry[] = Array.from(existing).map((itemId) => ({ id: itemId, ts: now }));
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(entries));
  } catch {}
}

export function getReadNotificationIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_KEY) || localStorage.getItem("notification-read-ids");
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const now = Date.now();
    const set = new Set<string>();
    for (const item of parsed) {
      if (typeof item === "string") {
        set.add(item);
      } else if (item && typeof item.id === "string") {
        if (!item.ts || now - item.ts < MAX_AGE_MS) {
          set.add(item.id);
        }
      }
    }
    return set;
  } catch {
    return new Set();
  }
}

export function markNotificationRead(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getReadNotificationIds();
    existing.add(id);
    const now = Date.now();
    const entries: TimestampedEntry[] = Array.from(existing).map((itemId) => ({ id: itemId, ts: now }));
    localStorage.setItem(READ_KEY, JSON.stringify(entries));
    localStorage.setItem("notification-read-ids", JSON.stringify(Array.from(existing)));
  } catch {}
}

export function markAllNotificationsRead(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getReadNotificationIds();
    for (const id of ids) {
      existing.add(id);
    }
    const now = Date.now();
    const entries: TimestampedEntry[] = Array.from(existing).map((itemId) => ({ id: itemId, ts: now }));
    localStorage.setItem(READ_KEY, JSON.stringify(entries));
    localStorage.setItem("notification-read-ids", JSON.stringify(Array.from(existing)));
  } catch {}
}

export function filterVisibleNotifications<T extends { id: string; createdAt?: number }>(items: T[]): T[] {
  const clearedBefore = getClearedBeforeTime();
  const dismissedIds = getDismissedNotificationIds();

  return items.filter((item) => {
    const itemTime = item.createdAt ?? 0;
    // 超过24小时的通知自然归档过期
    if (itemTime > 0 && Date.now() - itemTime > MAX_AGE_MS) {
      return false;
    }
    // 全部清除时间点之前的通知被过滤（若 item 无 createdAt 或 createdAt <= clearedBefore，均被清除）
    if (clearedBefore > 0 && itemTime <= clearedBefore) {
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
