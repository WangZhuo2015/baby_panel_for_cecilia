import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NotificationItem } from "@/app/api/notifications/route";

export interface BffNotification {
  id: string;
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface CreateBffNotificationInput {
  userId: string;
  eventKey: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const NOTIFICATIONS_FILE = path.join(DATA_DIR, "growdesk-notifications.json");

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export function fromGrowDeskNotification(rec: any): NotificationItem {
  const eventKey = typeof rec.eventKey === "string" ? rec.eventKey : "";
  let type: NotificationItem["type"] = "daily";
  if (eventKey.startsWith("vaccine")) {
    type = "vaccine";
  } else if (
    eventKey.startsWith("family") ||
    eventKey.startsWith("record") ||
    eventKey.startsWith("member")
  ) {
    type = "family";
  } else if (eventKey.startsWith("ai")) {
    type = "ai";
  } else if (eventKey.startsWith("data_release")) {
    type = "data_release";
  }

  const data = (rec.data && typeof rec.data === "object" ? rec.data : {}) as Record<string, unknown>;
  const createdAtMs = rec.createdAt ? new Date(rec.createdAt).getTime() : Date.now();

  return {
    id: rec.id || crypto.randomUUID(),
    type,
    title: rec.title || "通知提醒",
    detail: rec.body || rec.detail || "",
    time: rec.createdAt ? formatRelativeTime(new Date(rec.createdAt)) : "刚刚",
    urgent: Boolean(data.urgent || eventKey.includes("urgent")),
    icon: (typeof data.icon === "string" && data.icon)
      ? data.icon
      : type === "vaccine"
        ? "💉"
        : type === "family"
          ? "👨‍👩‍👧"
          : "⏰",
    actorId: (data.actorId as string) || null,
    actorLabel: (data.actorLabel as string) || null,
    createdAt: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
  };
}

class BffNotificationStore {
  private notifications = new Map<string, BffNotification>();
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(NOTIFICATIONS_FILE)) {
        const raw = fs.readFileSync(NOTIFICATIONS_FILE, "utf-8");
        const list: BffNotification[] = JSON.parse(raw);
        for (const n of list) {
          this.notifications.set(n.id, n);
        }
      }
    } catch {
      // Fallback to memory
    }
  }

  private persist(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const list = Array.from(this.notifications.values());
      const tmpFile = `${NOTIFICATIONS_FILE}.${Date.now()}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(list, null, 2), "utf-8");
      fs.renameSync(tmpFile, NOTIFICATIONS_FILE);
    } catch {}
  }

  public createNotification(input: CreateBffNotificationInput): BffNotification {
    this.ensureLoaded();

    // Idempotent deduplication: do not duplicate identical eventKey within 24h for same user
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    for (const existing of this.notifications.values()) {
      if (
        existing.userId === input.userId &&
        existing.eventKey === input.eventKey &&
        new Date(existing.createdAt).getTime() > since24h
      ) {
        return existing;
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const notif: BffNotification = {
      id,
      userId: input.userId,
      eventKey: input.eventKey,
      title: input.title,
      body: input.body,
      data: input.data || null,
      readAt: null,
      createdAt: now,
    };

    this.notifications.set(id, notif);
    this.persist();
    return notif;
  }

  public listNotifications(
    userId: string,
    options: { limit?: number; unreadOnly?: boolean } = {}
  ): { data: BffNotification[]; total: number; unreadCount: number } {
    this.ensureLoaded();

    const limit = Math.min(Math.max(options.limit || 20, 1), 100);
    const userItems = Array.from(this.notifications.values())
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const unreadCount = userItems.filter((n) => !n.readAt).length;
    let filtered = userItems;
    if (options.unreadOnly) {
      filtered = filtered.filter((n) => !n.readAt);
    }

    return {
      data: filtered.slice(0, limit),
      total: userItems.length,
      unreadCount,
    };
  }

  public markAsRead(userId: string, id: string): boolean {
    this.ensureLoaded();
    const notif = this.notifications.get(id);
    if (!notif || notif.userId !== userId) {
      return false;
    }
    notif.readAt = new Date().toISOString();
    this.persist();
    return true;
  }

  public deleteNotification(userId: string, id: string): boolean {
    this.ensureLoaded();
    const notif = this.notifications.get(id);
    if (!notif || notif.userId !== userId) {
      return false;
    }
    this.notifications.delete(id);
    this.persist();
    return true;
  }

  public clearAllForTest(): void {
    this.notifications.clear();
    this.loaded = true;
    try {
      if (fs.existsSync(NOTIFICATIONS_FILE)) {
        fs.unlinkSync(NOTIFICATIONS_FILE);
      }
    } catch {}
  }
}

const globalForNotifications = globalThis as unknown as {
  __bffNotificationStore?: BffNotificationStore;
};

export const bffNotificationStore =
  globalForNotifications.__bffNotificationStore ??
  (globalForNotifications.__bffNotificationStore = new BffNotificationStore());
