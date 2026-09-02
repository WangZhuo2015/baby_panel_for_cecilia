/**
 * 统一的通知已读与已清除状态本地持久化管理
 */

const READ_KEY = "baby_read_notifications";
const CLEARED_KEY = "baby_cleared_notifications";

export function getReadNotificationIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_KEY) || localStorage.getItem("notification-read-ids");
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveReadNotificationIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(ids);
    localStorage.setItem(READ_KEY, JSON.stringify(arr));
    localStorage.setItem("notification-read-ids", JSON.stringify(arr));
  } catch {
    // ignore
  }
}

export function getClearedNotificationIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(CLEARED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveClearedNotificationIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

export function filterVisibleNotifications<T extends { id: string }>(items: T[]): T[] {
  const clearedIds = getClearedNotificationIds();
  return items.filter((item) => !clearedIds.has(item.id));
}

export function calculateUnreadCount(notifications: { id: string }[]): number {
  const readIds = getReadNotificationIds();
  const clearedIds = getClearedNotificationIds();
  return notifications.filter((n) => !clearedIds.has(n.id) && !readIds.has(n.id)).length;
}
