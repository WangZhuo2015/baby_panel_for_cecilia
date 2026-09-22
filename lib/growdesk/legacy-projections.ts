/** Legacy response projections. Extended callers retain concurrency metadata. */
export const GROWDESK_REPRESENTATION_HEADER = "x-growdesk-representation";
export function wantsExtendedRepresentation(request: Request): boolean {
  return request.headers.get(GROWDESK_REPRESENTATION_HEADER)?.trim().toLowerCase() === "extended";
}

/** Copy before deleting. The return type must not promise deleted properties. */
function without<T extends object, K extends string>(record: T, ...keys: K[]): Omit<T, K> {
  const result = { ...record };
  for (const key of keys) delete (result as Record<string, unknown>)[key];
  return result;
}

export function projectLegacyFeedingRecord<T extends object>(record: T) {
  return without(record, "version", "baseVersion", "updatedAt");
}
export function projectLegacySleepRecord<T extends object>(record: T) {
  return without(record, "sleepType", "startedAt", "endedAt", "version", "baseVersion", "updatedAt");
}
export function projectLegacyDiaperRecord<T extends object>(record: T) {
  return without(record, "version", "baseVersion", "updatedAt");
}
export function projectLegacyGrowthRecord<T extends object>(record: T) {
  return without(record, "weight", "height", "headCircumference", "notes", "version", "baseVersion", "updatedAt");
}
export function projectLegacyMedicalRecord<T extends object>(record: T) {
  return without(record, "version", "baseVersion");
}

type LegacyProductProjection<T> = T extends object ? Omit<T, "createdAt" | "updatedAt"> : T;
export type LegacySupplementProjection<T extends object> = Omit<T, "product"> & {
  product?: LegacyProductProjection<T extends { product?: infer P } ? P : unknown>;
};
export function projectLegacySupplementRecord<T extends object>(record: T): LegacySupplementProjection<T> {
  const product = (record as Record<string, unknown>).product;
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return { ...record } as LegacySupplementProjection<T>;
  }
  return { ...record, product: without(product as Record<string, unknown>, "createdAt", "updatedAt") } as LegacySupplementProjection<T>;
}

function projectLegacyTimelineRawRecord(type: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = { ...(value as Record<string, unknown>) };
  delete raw.version;
  delete raw.baseVersion;
  if (type === "feeding") delete raw.durationMinutes;
  else if (type === "sleep") {
    delete raw.startedAt;
    delete raw.endedAt;
    delete raw.sleepType;
  } else if (type === "diaper") delete raw.diaperType;
  else if (type === "food") delete raw.notes;
  return raw;
}

function projectLegacySupplementTimelineDetail(item: Record<string, unknown>, raw: Record<string, unknown>): string | undefined {
  if (item.type !== "supplement") return typeof item.detail === "string" ? item.detail : undefined;
  const productName = typeof raw.productName === "string" && raw.productName
    ? raw.productName : typeof item.detail === "string" ? item.detail : "营养补充剂";
  let dose = raw.dose;
  let unitName = raw.unitName;
  if ((typeof dose !== "number" && typeof dose !== "string") || dose === "") {
    const amount = typeof unitName === "string" ? unitName.trim() : "";
    const match = amount.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
    if (match) { dose = Number(match[1]); unitName = match[2] || "滴"; }
  }
  const amount = dose === null || dose === undefined || dose === ""
    ? "" : `${dose}${typeof unitName === "string" && unitName ? unitName : "剂"}`;
  const notes = typeof raw.notes === "string" && raw.notes ? ` · ${raw.notes}` : "";
  return `${productName}${amount ? ` ${amount}` : ""}${notes}`;
}

export type LegacyTimelineProjection<T extends object> = Omit<T,
  "babyId" | "version" | "baseVersion" | "sortMs" | "rawRecord" | "formulaProductId" | "formulaProductName"
> & { rawRecord?: unknown; formulaProductId?: unknown; formulaProductName?: unknown };

export function projectLegacyTimelineItem<T extends object>(item: T): LegacyTimelineProjection<T> {
  const result = { ...(item as Record<string, unknown>) };
  delete result.babyId;
  delete result.version;
  delete result.baseVersion;
  delete result.sortMs;
  if (result.formulaProductId === null || result.formulaProductId === undefined) delete result.formulaProductId;
  if (result.formulaProductName === null || result.formulaProductName === undefined) delete result.formulaProductName;
  const raw = projectLegacyTimelineRawRecord(String(result.type || ""), result.rawRecord);
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    result.rawRecord = raw;
    const detail = projectLegacySupplementTimelineDetail(result, raw as Record<string, unknown>);
    if (detail !== undefined) result.detail = detail;
  }
  return result as LegacyTimelineProjection<T>;
}
export function projectLegacyTimelineResponse<T extends object>(items: T[]): LegacyTimelineProjection<T>[] {
  return items.map(projectLegacyTimelineItem);
}

export type LegacyGrowthChartProjection<T extends { measurements?: unknown[] }> = Omit<T, "measurements" | "rawWhoPercentiles"> & {
  measurements?: unknown[];
};
export function projectLegacyGrowthChart<T extends { measurements?: unknown[] }>(chart: T): LegacyGrowthChartProjection<T> {
  const result = without(chart, "rawWhoPercentiles", "measurements");
  return {
    ...result,
    ...(Array.isArray(chart.measurements) ? {
      measurements: chart.measurements.map(measurement => (
        measurement && typeof measurement === "object" && !Array.isArray(measurement)
          ? projectLegacyGrowthRecord(measurement) : measurement
      )),
    } : {}),
  };
}
