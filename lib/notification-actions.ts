/** Server-backed reads and local dismissals are intentionally different actions. */
export interface ReadableNotification {
  id: string;
  serverNotificationId?: string;
  readAt?: string | null;
}
export interface NotificationViewItem extends ReadableNotification {
  type: "vaccine" | "ai" | "daily" | "data_release" | "family";
  title: string;
  detail: string;
  time: string;
  urgent: boolean;
  icon: string;
  actorId?: string | null;
  actorLabel?: string | null;
  createdAt?: number;
}
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function validReadAt(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)));
}
export function isNotificationRead(item: ReadableNotification, localReadIds: ReadonlySet<string>): boolean {
  return item.serverNotificationId !== undefined
    ? typeof item.readAt === "string" && validReadAt(item.readAt)
    : localReadIds.has(item.id);
}
export function parseNotificationItems(value: unknown): NotificationViewItem[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error("通知列表格式无效");
  const seen = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("通知数据格式无效");
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !ID.test(item.id) || seen.has(item.id)) throw new Error("通知标识无效或重复");
    seen.add(item.id);
    if (!["vaccine", "ai", "daily", "data_release", "family"].includes(String(item.type)) ||
        ["title", "detail", "time", "icon"].some(field => typeof item[field] !== "string") ||
        typeof item.urgent !== "boolean") throw new Error("通知展示数据无效");
    if (item.createdAt !== undefined && (typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt))) throw new Error("通知创建时间无效");
    if (item.serverNotificationId !== undefined &&
        (item.serverNotificationId !== item.id || !validReadAt(item.readAt))) throw new Error("通知服务端状态无效");
    return { ...item } as unknown as NotificationViewItem;
  });
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
  signal?: AbortSignal,
): Promise<{ acknowledged: string[]; failed: string[]; stale: boolean }> {
  const captured = { ...identity };
  const result = { acknowledged: [] as string[], failed: [] as string[], stale: false };
  // Snapshot before the first await: callers must not retarget queued work by
  // mutating their list or identity while another request is in flight.
  const unique = [...new Map(items.map(item => [item.id, { ...item }])).values()];
  if (unique.length > 1000) throw new Error("通知数量过多，请分批确认");
  let index = 0;
  let denied = false;
  const active = () => !signal?.aborted && sameNotificationIdentity(captured, current());
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (index < unique.length) {
      if (!active()) { result.stale = true; return; }
      if (denied) return;
      const item = unique[index++]!;
      try {
        if (item.serverNotificationId !== undefined) {
          if (!ID.test(item.serverNotificationId) || item.serverNotificationId !== item.id || !validReadAt(item.readAt)) throw new Error("Invalid notification identity");
          if (item.readAt === null) {
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal?.addEventListener("abort", abort, { once: true });
            const timer = setTimeout(abort, 10_000);
            try {
              if (signal?.aborted) controller.abort();
              const response = await fetchApi(`/api/notifications/${encodeURIComponent(item.serverNotificationId)}`, {
                method: "POST", headers: notificationHeaders(captured), cache: "no-store", signal: controller.signal,
              });
              if ([401, 403, 409].includes(response.status)) denied = true;
              const data: unknown = await response.json();
              if (!response.ok || !data || typeof data !== "object" || !("success" in data) || data.success !== true) throw new Error("Read was not acknowledged");
            } finally {
              clearTimeout(timer);
              signal?.removeEventListener("abort", abort);
            }
          }
        }
        if (!active()) { result.stale = true; return; }
        result.acknowledged.push(item.id);
      } catch {
        if (!active()) { result.stale = true; return; }
        result.failed.push(item.id);
      }
    }
  }));
  if (denied && !result.stale) result.failed.push(...unique.slice(index).map(item => item.id));
  return result;
}
