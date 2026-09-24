/** Server-backed reads and local dismissals are intentionally different actions. */
export interface ReadableNotification {
  id: string;
  serverNotificationId?: string;
  readAt?: string | null;
}
export function isNotificationRead(item: ReadableNotification, localReadIds: ReadonlySet<string>): boolean {
  return item.serverNotificationId !== undefined ? Boolean(item.readAt) : localReadIds.has(item.id);
}
export interface NotificationIdentity { userId: string; familyId: string; babyId: string }
export function sameNotificationIdentity(a: NotificationIdentity | null, b: NotificationIdentity | null): boolean {
  return Boolean(a && b && a.userId === b.userId && a.familyId === b.familyId && a.babyId === b.babyId);
}
export function notificationHeaders(identity: NotificationIdentity): Record<string, string> {
  return { "x-growdesk-representation": "extended", "x-growdesk-expected-user": identity.userId };
}

/** Never mark a failed server read as a locally successful acknowledgement. */
export async function acknowledgeNotifications(
  items: readonly ReadableNotification[],
  identity: NotificationIdentity,
  current: () => NotificationIdentity | null,
  fetchApi: typeof fetch = fetch,
): Promise<{ acknowledged: string[]; failed: string[]; stale: boolean }> {
  const result = { acknowledged: [] as string[], failed: [] as string[], stale: false };
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (index < unique.length) {
      if (!sameNotificationIdentity(identity, current())) { result.stale = true; return; }
      const item = unique[index++]!;
      try {
        if (item.serverNotificationId !== undefined && !item.readAt) {
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(item.serverNotificationId) || item.serverNotificationId !== item.id) throw new Error("Invalid notification identity");
          const response = await fetchApi(`/api/notifications/${encodeURIComponent(item.serverNotificationId)}`, {
            method: "POST", headers: notificationHeaders(identity), cache: "no-store",
          });
          const data: unknown = await response.json();
          if (!response.ok || !data || typeof data !== "object" || !("success" in data) || data.success !== true) throw new Error("Read was not acknowledged");
        }
        if (!sameNotificationIdentity(identity, current())) { result.stale = true; return; }
        result.acknowledged.push(item.id);
      } catch {
        if (!sameNotificationIdentity(identity, current())) { result.stale = true; return; }
        result.failed.push(item.id);
      }
    }
  }));
  return result;
}
