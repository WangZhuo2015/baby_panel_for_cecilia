if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

import { BridgeError, isoTimestamp, wireVersion } from "./bridge-protocol";
import { formatIsoToLocalTime, getLocalDateStr } from "@/lib/date";
import { getFeedingEffectiveMl } from "@/lib/nutrition/breastmilk";
import { decodeNotes } from "./food-compat";

export interface GrowDeskTimelineEntry {
  id: string;
  babyId: string;
  entityType: "feeding" | "sleep" | "diaper" | "food" | "supplement" | "growth" | "medical" | "vaccine";
  entityId: string;
  occurredAt: string;
  summary: string;
  version: string;
}

export interface LegacyTimelineItem {
  id: string;
  babyId: string;
  version: string;
  baseVersion: string;
  time: string;
  sortMs: number;
  type: string;
  title: string;
  detail?: string;
  icon?: string;
  badge?: string;
  recorder?: string | null;
  recorderName?: string | null;
  source?: string | null;
  sourceAgent?: string | null;
  formulaProductId?: string | null;
  formulaProductName?: string | null;
  rawRecord?: any;
}

export interface TimelineEnrichmentContext {
  feedings?: Map<string, any> | Record<string, any>;
  sleeps?: Map<string, any> | Record<string, any>;
  diapers?: Map<string, any> | Record<string, any>;
  foods?: Map<string, any> | Record<string, any>;
  supplements?: Map<string, any> | Record<string, any>;
  formulaProducts?: Map<string, any> | Record<string, any>;
  supplementProducts?: Map<string, any> | Record<string, any>;
  memberNames?: Map<string, string> | Record<string, string>;
  /** UTC start of the requested family-local calendar day. */
  dayStartMs?: number;
}

function lookup<T = any>(container: Map<string, T> | Record<string, T> | undefined, id: string | null | undefined): T | undefined {
  if (!container || !id) return undefined;
  if (container instanceof Map) return container.get(id);
  return (container as Record<string, T>)[id];
}

function cleanSummary(summary: string, entityType: string): string {
  if (!summary) return summary;
  const s = summary.trim();
  if (/[\u4e00-\u9fa5]/.test(s)) return s;

  if (entityType === "feeding") {
    const m = s.match(/(?:Updated\s+)?feeding:\s*(\w+)(?:\s+(\d+)ml)?/i);
    if (m) {
      const type = m[1].toLowerCase();
      const amt = m[2] ? `${m[2]}ml` : "";
      const label = type === "formula" ? "配方奶" : type === "breast" ? "母乳亲喂" : type === "mixed" ? "混合喂养" : type === "bottle" ? "瓶喂母乳" : "喂奶";
      return amt ? `${label} ${amt}` : label;
    }
  } else if (entityType === "sleep") {
    const m = s.match(/(?:Updated\s+)?sleep:\s*(\w+)/i);
    if (m) {
      const type = m[1].toLowerCase();
      return type === "night" ? "夜间睡眠" : "白天小睡";
    }
  } else if (entityType === "diaper") {
    const m = s.match(/(?:Updated\s+)?diaper:\s*(\w+)/i);
    if (m) {
      const type = m[1].toLowerCase();
      return type === "poop" ? "便便" : type === "both" ? "嘘嘘 + 便便" : "嘘嘘 (尿)";
    }
  } else if (entityType === "food") {
    const m = s.match(/^(?:Updated\s+)?food:\s*(.+)/i);
    if (m) return `辅食餐点: ${m[1]}`;
  } else if (entityType === "supplement") {
    const m = s.match(/^(?:Updated\s+)?supplement:\s*(.+)/i);
    if (m) return `补剂打卡: ${m[1]}`;
  }
  return s;
}

const TYPE_LABELS: Record<string, string> = {
  feeding: "喂奶",
  sleep: "睡眠",
  diaper: "尿布",
  food: "辅食",
  supplement: "补剂",
  growth: "生长测量",
  medical: "医疗记录",
  vaccine: "疫苗接种",
};

const TYPE_ICONS: Record<string, string> = {
  feeding: "🍼",
  sleep: "💤",
  diaper: "🧷",
  food: "🥣",
  supplement: "💊",
  growth: "📏",
  medical: "🩺",
  vaccine: "💉",
};

export function fromGrowDeskTimelineEntry(
  entry: GrowDeskTimelineEntry,
  context?: TimelineEnrichmentContext,
): LegacyTimelineItem {
  const occurredAt = isoTimestamp(entry.occurredAt);
  const date = new Date(occurredAt);
  const version = wireVersion(entry.version);
  if (!entry.babyId || !entry.entityType || (!entry.entityId && !entry.id)) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了不完整的时间轴记录");
  }
  const entityId = entry.entityId || entry.id;
  let time = formatIsoToLocalTime(occurredAt);
  let sortMs = date.getTime();

  if (!context) {
    return {
      id: entityId,
      babyId: entry.babyId,
      version,
      baseVersion: version,
      time,
      sortMs,
      type: entry.entityType,
      title: TYPE_LABELS[entry.entityType] || entry.entityType,
      detail: cleanSummary(entry.summary, entry.entityType),
      icon: TYPE_ICONS[entry.entityType] || "📌",
    };
  }

  let title = TYPE_LABELS[entry.entityType] || entry.entityType;
  let detail: string | undefined = cleanSummary(entry.summary, entry.entityType);
  let icon = TYPE_ICONS[entry.entityType] || "📌";
  let recorderName: string | null = null;
  let source: string | null = null;
  let sourceAgent: string | null = null;
  let formulaProductId: string | null = null;
  let formulaProductName: string | null = null;
  let rawRecord: any = undefined;

  if (entry.entityType === "feeding") {
    const feed = lookup(context.feedings, entityId);
    let feedType = feed?.type || feed?.feedingType;
    if (!feedType) {
      const s = entry.summary.toLowerCase();
      if (s.includes("亲喂") || s.includes("breast")) feedType = "breast";
      else if (s.includes("混合") || s.includes("mixed")) feedType = "mixed";
      else if (s.includes("瓶喂") || s.includes("bottle")) feedType = "bottle_breast";
      else if (s.includes("配方") || s.includes("formula")) feedType = "formula";
      else feedType = "formula";
    }
    const FEED_TITLES: Record<string, string> = {
      formula: "配方奶",
      breast: "母乳亲喂",
      mixed: "混合喂养",
      bottle_breast: "瓶喂母乳",
    };
    title = FEED_TITLES[feedType] || "配方奶";
    icon = feedType === "breast" ? "🤱" : "🍼";
    formulaProductId = feed?.formulaProductId || null;
    if (formulaProductId) {
      const fp = lookup(context.formulaProducts, formulaProductId);
      if (fp) formulaProductName = fp.name || fp.brand || null;
    }
    if (!formulaProductName && entry.summary) {
      const m = entry.summary.match(/\(([^)]+)\)/);
      if (m && m[1] && !m[1].includes("分")) formulaProductName = m[1].trim();
    }
    if (feed) {
      source = feed.source || "ui_manual";
      sourceAgent = feed.sourceAgent || null;
      const recordedById = feed.recordedByUserId || feed.recordedById;
      recorderName = lookup(context.memberNames, recordedById) || null;
      const amount = feed.amountMl != null ? Number(feed.amountMl) : 0;
      const effectiveMl = getFeedingEffectiveMl({
        type: feedType,
        amountMl: feed.amountMl != null ? Number(feed.amountMl) : null,
        leftMinutes: feed.leftMinutes != null ? Number(feed.leftMinutes) : null,
        rightMinutes: feed.rightMinutes != null ? Number(feed.rightMinutes) : null,
      });
      let d = "";
      if (feedType === "mixed") {
        const breastPart = effectiveMl - amount;
        const formulaPart = formulaProductName ? `配方${amount}ml (${formulaProductName})` : `配方${amount}ml`;
        d += `${formulaPart}${breastPart > 0 ? ` + 亲喂约${breastPart}ml (共约${effectiveMl}ml)` : ""}`;
      } else if (feedType === "formula") {
        d += formulaProductName ? `配方${amount}ml (${formulaProductName})` : (amount > 0 ? `${amount}ml` : "");

      } else if (amount > 0) {
        d += `${feedType === "breast" ? "约" : ""}${amount}ml`;
      } else if (effectiveMl > 0) {
        d += `约${effectiveMl}ml`;
      }
      if (feed.leftMinutes || feed.rightMinutes) {
        const sides: string[] = [];
        if (feed.leftMinutes) sides.push(`左${feed.leftMinutes}分`);
        if (feed.rightMinutes) sides.push(`右${feed.rightMinutes}分`);
        d += d ? ` (${sides.join("+")})` : sides.join("+");
      }
      if (feed.spitUp) d += d ? " · 吐奶" : "吐奶";
      if (feed.notes) d += d ? ` · ${feed.notes}` : feed.notes;
      detail = d || undefined;

      rawRecord = {
        id: feed.id || entityId,
        timestamp: feed.timestamp || feed.occurredAt || entry.occurredAt,
        type: feedType,
        amountMl: feed.amountMl != null ? Number(feed.amountMl) : null,
        leftMinutes: feed.leftMinutes != null ? Number(feed.leftMinutes) : null,
        rightMinutes: feed.rightMinutes != null ? Number(feed.rightMinutes) : null,
        durationMinutes: feed.durationMinutes != null ? Number(feed.durationMinutes) : null,
        spitUp: Boolean(feed.spitUp),
        notes: feed.notes || null,
        source: feed.source || "ui_manual",
        sourceAgent: feed.sourceAgent || null,
        formulaProductId: formulaProductId,
        version: wireVersion(feed.version || entry.version),
        baseVersion: wireVersion(feed.baseVersion || feed.version || entry.version),
      };
    } else {
      detail = cleanSummary(entry.summary, "feeding");
    }
  } else if (entry.entityType === "sleep") {
    const sleep = lookup(context.sleeps, entityId);
    let sleepType = sleep?.sleepType || sleep?.type;
    if (!sleepType) {
      const s = entry.summary.toLowerCase();
      sleepType = s.includes("夜间") || s.includes("night") ? "night" : "nap";
    }
    const isNight = sleepType === "night";
    title = isNight ? "夜间睡眠" : "白天小睡";
    icon = isNight ? "🌙" : "💤";
    if (sleep) {
      source = sleep.source || "ui_manual";
      sourceAgent = sleep.sourceAgent || null;
      const recordedById = sleep.recordedByUserId || sleep.recordedById;
      recorderName = lookup(context.memberNames, recordedById) || null;
      const startIso = sleep.startedAt || sleep.startTime || entry.occurredAt;
      const endIso = sleep.endedAt || sleep.endTime || null;
      const startStr = formatIsoToLocalTime(startIso);
      const endStr = endIso ? formatIsoToLocalTime(endIso) : null;
      const startMs = new Date(startIso).getTime();
      const endMs = endIso ? new Date(endIso).getTime() : startMs;
      const durationMin = Math.round((endMs - startMs) / 60000);
      const h = Math.floor(durationMin / 60);
      const m = durationMin % 60;
      const durationText = h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分钟`;
      let d = endStr ? `${durationText}（${startStr}–${endStr}）` : `开始于 ${startStr}`;
      // The legacy service keeps the complete interval and duration, but
      // anchors an overnight item at the selected day's local midnight so it
      // remains visible in the requested timeline and sorts with that day.
      const isOvernight = Number.isFinite(context.dayStartMs) && startMs < context.dayStartMs!;
      if (isOvernight) {
        time = "00:00";
        sortMs = context.dayStartMs!;
        title = "跨夜睡眠 (接昨日)";
      }
      if (sleep.nightWakingCount > 0) d += ` · 夜醒 ${sleep.nightWakingCount}次`;
      if (sleep.notes) d += ` · ${sleep.notes}`;
      detail = d;

      rawRecord = {
        id: sleep.id || entityId,
        startTime: startIso,
        endTime: endIso,
        startedAt: startIso,
        endedAt: endIso,
        type: sleepType,
        sleepType: sleepType,
        nightWakingCount: sleep.nightWakingCount || 0,
        notes: sleep.notes || null,
        source: sleep.source || "ui_manual",
        sourceAgent: sleep.sourceAgent || null,
        version: wireVersion(sleep.version || entry.version),
        baseVersion: wireVersion(sleep.baseVersion || sleep.version || entry.version),
      };
    } else {
      detail = cleanSummary(entry.summary, "sleep");
    }
  } else if (entry.entityType === "diaper") {
    const diaper = lookup(context.diapers, entityId);
    let diaperType = diaper?.diaperType || diaper?.type;
    if (!diaperType) {
      const s = entry.summary.toLowerCase();
      diaperType = (s.includes("便便") || s.includes("poop"))
        ? (s.includes("嘘嘘") || s.includes("pee") || s.includes("both") ? "both" : "poop")
        : "pee";
    }
    title = "换尿布";
    icon = diaperType === "pee" ? "💧" : (diaperType === "poop" ? "💩" : "💧💩");
    if (diaper) {
      source = diaper.source || "ui_manual";
      sourceAgent = diaper.sourceAgent || null;
      const recordedById = diaper.recordedByUserId || diaper.recordedById;
      recorderName = lookup(context.memberNames, recordedById) || null;
      const typeLabels: Record<string, string> = {
        pee: "嘘嘘 (尿)",
        poop: "便便",
        both: "嘘嘘 + 便便",
      };
      let d = typeLabels[diaperType] || "换尿布";
      if (diaper.poopColor) {
        const colorMap: Record<string, string> = { yellow: "黄色", green: "绿色", brown: "棕色", other: "其他" };
        d += ` · ${colorMap[diaper.poopColor] || diaper.poopColor}`;
      }
      if (diaper.poopConsistency) {
        const consMap: Record<string, string> = { loose: "稀便", paste: "糊状", formed: "成形" };
        d += ` · ${consMap[diaper.poopConsistency] || diaper.poopConsistency}`;
      }
      if (diaper.notes) d += ` · ${diaper.notes}`;
      detail = d;

      rawRecord = {
        id: diaper.id || entityId,
        timestamp: diaper.timestamp || diaper.occurredAt || entry.occurredAt,
        type: diaperType,
        diaperType: diaperType,
        poopColor: diaper.poopColor || null,
        poopConsistency: diaper.poopConsistency || null,
        notes: diaper.notes || null,
        source: diaper.source || "ui_manual",
        sourceAgent: diaper.sourceAgent || null,
        version: wireVersion(diaper.version || entry.version),
        baseVersion: wireVersion(diaper.baseVersion || diaper.version || entry.version),
      };
    } else {
      detail = entry.summary;
    }
  } else if (entry.entityType === "food") {
    const food = lookup(context.foods, entityId);
    title = "辅食餐点";
    icon = "🥣";
    let foodList: string[] = [];
    if (food) {
      source = food.source || "ui_manual";
      sourceAgent = food.sourceAgent || null;
      const recordedById = food.recordedByUserId || food.recordedById;
      recorderName = lookup(context.memberNames, recordedById) || null;
      if (Array.isArray(food.foods)) foodList = food.foods;
      else if (Array.isArray(food.foodItemIds)) foodList = food.foodItemIds;
      else if (typeof food.foods === "string") {
        try { foodList = JSON.parse(food.foods); } catch {}
      }
      const decoded = decodeNotes(food.notes || null);
      let d = foodList.length > 0 ? foodList.join("、") : (entry.summary || "辅食餐点");
      if (decoded.notes) d += ` · ${decoded.notes}`;
      detail = d;

      rawRecord = {
        id: food.id || entityId,
        date: food.date || food.recordDate || getLocalDateStr(date),
        time: food.time || time,
        foods: foodList,
        portion: food.portion || food.portionDescription || null,
        acceptance: food.acceptance ?? decoded.observations.acceptance ?? null,
        babyState: food.babyState ?? decoded.observations.babyState ?? null,
        hasAbnormal: Boolean(food.hasAbnormal ?? decoded.observations.hasAbnormal),
        abnormalNotes: food.abnormalNotes ?? decoded.observations.abnormalNotes ?? null,
        notes: decoded.notes || null,
        source: food.source || "ui_manual",
        sourceAgent: food.sourceAgent || null,
        version: wireVersion(food.version || entry.version),
        baseVersion: wireVersion(food.baseVersion || food.version || entry.version),
      };
    } else {
      detail = cleanSummary(entry.summary, "food");
    }
  } else if (entry.entityType === "supplement") {
    const supp = lookup(context.supplements, entityId);
    title = "补剂打卡";
    icon = "💊";
    if (supp) {
      source = supp.source || "ui_manual";
      sourceAgent = supp.sourceAgent || null;
      const recordedById = supp.recordedByUserId || supp.recordedById;
      recorderName = lookup(context.memberNames, recordedById) || null;
      const prodId = supp.productId || supp.supplementProductId;
      const prod = lookup(context.supplementProducts, prodId);
      const prodName = supp.productName || supp.supplementName || prod?.name || "营养补充剂";
      const unit = supp.unitName || supp.amount || prod?.unitName || "剂";
      const dose = supp.dose ?? supp.dosage ?? "";
      let d = `${prodName} ${dose} ${unit}`.trim();
      if (supp.notes) d += ` · ${supp.notes}`;
      detail = d;

      rawRecord = {
        id: supp.id || entityId,
        date: supp.date || supp.recordDate || getLocalDateStr(date),
        time: supp.time || time,
        productId: prodId || null,
        productName: prodName,
        dose: dose !== "" ? dose : null,
        unitName: unit,
        notes: supp.notes || null,
        source: supp.source || "ui_manual",
        sourceAgent: supp.sourceAgent || null,
        version: wireVersion(supp.version || entry.version),
        baseVersion: wireVersion(supp.baseVersion || supp.version || entry.version),
      };
    } else {
      detail = cleanSummary(entry.summary, "supplement");
    }
  }

  return {
    id: entityId,
    babyId: entry.babyId,
    version,
    baseVersion: version,
    time,
    sortMs,
    type: entry.entityType,
    title,
    detail,
    icon,
    recorderName,
    source,
    sourceAgent,
    formulaProductId,
    formulaProductName,
    rawRecord,
  };
}

export function fromGrowDeskTimelineResponse(
  raw: GrowDeskTimelineEntry[] | { data: GrowDeskTimelineEntry[]; page?: { nextCursor: string | null } },
  context?: TimelineEnrichmentContext,
): LegacyTimelineItem[] {
  const list = Array.isArray(raw) ? raw : raw?.data;
  if (!Array.isArray(list)) throw new BridgeError(502, "UPSTREAM_INVALID_PAGE", "GrowDesk 未返回有效的时间轴数据");
  const typeOrder: Record<string, number> = { feeding: 0, sleep: 1, diaper: 2, food: 3, supplement: 4, growth: 5, medical: 6, vaccine: 7 };
  return list.map(item => fromGrowDeskTimelineEntry(item, context))
    .sort((a, b) => b.sortMs - a.sortMs || typeOrder[a.type] - typeOrder[b.type]);
}
