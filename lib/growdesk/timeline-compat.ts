if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface GrowDeskTimelineEntry {
  id: string;
  babyId: string;
  entityType: "feeding" | "sleep" | "diaper" | "food" | "supplement" | "growth";
  entityId: string;
  occurredAt: string;
  summary: string;
  version: string;
}

export interface LegacyTimelineItem {
  id: string;
  time: string;
  sortMs: number;
  type: string;
  title: string;
  detail?: string;
  icon?: string;
  badge?: string;
  recorder?: string | null;
  source?: string;
}

const TYPE_LABELS: Record<string, string> = {
  feeding: "喂奶",
  sleep: "睡眠",
  diaper: "尿布",
  food: "辅食",
  supplement: "补剂",
  growth: "生长测量",
};

const TYPE_ICONS: Record<string, string> = {
  feeding: "🍼",
  sleep: "💤",
  diaper: "🧷",
  food: "🥣",
  supplement: "💊",
  growth: "📏",
};

export function fromGrowDeskTimelineEntry(entry: GrowDeskTimelineEntry): LegacyTimelineItem {
  const date = new Date(entry.occurredAt);
  const time = !isNaN(date.getTime())
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";

  return {
    id: entry.entityId || entry.id,
    time,
    sortMs: !isNaN(date.getTime()) ? date.getTime() : Date.now(),
    type: entry.entityType,
    title: TYPE_LABELS[entry.entityType] || entry.entityType,
    detail: entry.summary,
    icon: TYPE_ICONS[entry.entityType] || "📌",
  };
}

export function fromGrowDeskTimelineResponse(
  raw: GrowDeskTimelineEntry[] | { data: GrowDeskTimelineEntry[] },
): LegacyTimelineItem[] {
  const list = Array.isArray(raw) ? raw : (raw?.data || []);
  return list.map(fromGrowDeskTimelineEntry);
}
