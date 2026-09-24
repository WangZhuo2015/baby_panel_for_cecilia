import { BridgeError, isoTimestamp, pathId } from "./bridge-protocol";

export interface ServerNotificationReadState {
  serverNotificationId: string;
  readAt: string | null;
}

/** Add state only for an explicitly requested representation, never to legacy DTOs. */
export function projectNotificationReadState<T extends { id: string }>(
  item: T,
  canonical: { id: string; readAt?: unknown },
  extended: boolean,
): T & Partial<ServerNotificationReadState> {
  if (!extended) return item;
  try {
    pathId(canonical.id);
    if (item.id !== canonical.id) throw new Error("Notification identity changed");
    // Omission is not the same as unread. A missing field means the upstream
    // does not support authoritative read state and must not be fabricated.
    if (canonical.readAt !== null && typeof canonical.readAt !== "string") {
      throw new Error("Missing notification read state");
    }
    const readAt = canonical.readAt === null ? null : isoTimestamp(canonical.readAt);
    return { ...item, serverNotificationId: canonical.id, readAt };
  } catch {
    throw new BridgeError(502, "UPSTREAM_INVALID_NOTIFICATION_STATE", "GrowDesk 返回了无效的通知已读状态");
  }
}
