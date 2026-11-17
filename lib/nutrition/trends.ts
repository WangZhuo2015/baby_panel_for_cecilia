import type { MultiDayTrendItem } from "@/types/nutrition";

const legacyKeys = {
  vitamin_d: "vitaminD", vitamin_a: "vitaminA", calcium: "calcium",
  iron: "iron", zinc: "zinc", dha: "dha",
} as const;

/** Keep a missing day/field distinct from a recorded zero, including older responses. */
export function nutritionTrendValue(day: MultiDayTrendItem, metric: string): number | null {
  if (day.hasRecords === false) return null;
  if (day.recordedMetrics && !day.recordedMetrics.includes(metric)) return null;
  const key = legacyKeys[metric as keyof typeof legacyKeys];
  const value = metric === "milk" ? day.totalFeedingMl : day.nutrients?.[metric] ?? (key ? day[key] : undefined);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeTrend(values: Array<number | null>) {
  const recorded = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    recordedDays: recorded.length,
    average: recorded.length ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length : null,
    latest: recorded.at(-1) ?? null,
  };
}
