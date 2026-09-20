/**
 * Response projections for the legacy Web BFF contract.
 *
 * GrowDesk records carry optimistic-concurrency fields and canonical aliases
 * that the old Web client never received. Keep those fields available to a
 * caller that explicitly asks for the extended representation, while making
 * the no-header response byte-for-byte compatible with the old DTO shape.
 */

export const GROWDESK_REPRESENTATION_HEADER = "x-growdesk-representation";

export function wantsExtendedRepresentation(request: Request): boolean {
  return request.headers.get(GROWDESK_REPRESENTATION_HEADER)?.trim().toLowerCase() === "extended";
}

function without<T extends object>(record: T, ...keys: string[]): T {
  const result = { ...record } as T;
  for (const key of keys) delete (result as Record<string, unknown>)[key];
  return result;
}

/** The old feeding list/detail did not expose CAS update metadata. */
export function projectLegacyFeedingRecord<T extends object>(record: T): T {
  return without(record, "version", "baseVersion", "updatedAt");
}

/** The old sleep DTO used startTime/endTime and type only. */
export function projectLegacySleepRecord<T extends object>(record: T): T {
  return without(
    record,
    "sleepType",
    "startedAt",
    "endedAt",
    "version",
    "baseVersion",
    "updatedAt",
  );
}

/** The old diaper DTO had one type discriminator and no CAS metadata. */
export function projectLegacyDiaperRecord<T extends object>(record: T): T {
  return without(record, "version", "baseVersion", "updatedAt");
}

/** The old growth DTO used the *Cm/Kg fields and did not expose notes/CAS. */
export function projectLegacyGrowthRecord<T extends object>(record: T): T {
  return without(
    record,
    "weight",
    "height",
    "headCircumference",
    "notes",
    "version",
    "baseVersion",
    "updatedAt",
  );
}

/** Medical reports retain updatedAt in the legacy response, but not CAS fields. */
export function projectLegacyMedicalRecord<T extends object>(record: T): T {
  return without(record, "version", "baseVersion");
}

/** Product timestamps were canonical-only fields in the old supplement DTO. */
export function projectLegacySupplementRecord<T extends object>(record: T): T {
  const product = (record as Record<string, unknown>).product;
  if (!product || typeof product !== "object" || Array.isArray(product)) return { ...record };
  return {
    ...record,
    product: without(product as Record<string, unknown>, "createdAt", "updatedAt"),
  } as T;
}

function projectLegacyTimelineRawRecord(type: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = { ...(value as Record<string, unknown>) };

  delete raw.version;
  delete raw.baseVersion;
  if (type === "feeding") {
    delete raw.durationMinutes;
  } else if (type === "sleep") {
    delete raw.startedAt;
    delete raw.endedAt;
    delete raw.sleepType;
  } else if (type === "diaper") {
    delete raw.diaperType;
  } else if (type === "food") {
    // The old timeline raw DTO deliberately omitted the encoded/canonical
    // notes field; notes remain available through the extended projection.
    delete raw.notes;
  }
  return raw;
}

function projectLegacySupplementTimelineDetail(item: Record<string, unknown>, raw: Record<string, unknown>): string | undefined {
  if (item.type !== "supplement") return typeof item.detail === "string" ? item.detail : undefined;
  const productName = typeof raw.productName === "string" && raw.productName
    ? raw.productName
    : typeof item.detail === "string" ? item.detail : "营养补充剂";
  let dose = raw.dose;
  let unitName = raw.unitName;
  // Older canonical detail pages may expose amount as one string. Normalize
  // that representation here so the legacy DTO remains `1.5滴`, not `1.5 滴`
  // or a null dose/unit pair.
  if ((typeof dose !== "number" && typeof dose !== "string") || dose === "") {
    const amount = typeof unitName === "string" ? unitName.trim() : "";
    const match = amount.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
    if (match) {
      dose = Number(match[1]);
      unitName = match[2] || "滴";
    }
  }
  const amount = dose === null || dose === undefined || dose === ""
    ? ""
    : `${dose}${typeof unitName === "string" && unitName ? unitName : "剂"}`;
  const notes = typeof raw.notes === "string" && raw.notes ? ` · ${raw.notes}` : "";
  return `${productName}${amount ? ` ${amount}` : ""}${notes}`;
}

/** Strip canonical timeline metadata while preserving the old raw edit DTO. */
export function projectLegacyTimelineItem<T extends object>(item: T): T {
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
  return result as T;
}

export function projectLegacyTimelineResponse<T extends object>(items: T[]): T[] {
  return items.map(projectLegacyTimelineItem);
}

export function projectLegacyGrowthChart<T extends { measurements?: unknown[] }>(chart: T): T {
  const result = {
    ...chart,
    ...(Array.isArray(chart.measurements)
      ? {
        measurements: chart.measurements.map((measurement) => (
          measurement && typeof measurement === "object" && !Array.isArray(measurement)
            ? projectLegacyGrowthRecord(measurement)
            : measurement
        )),
      }
      : {}),
  } as T & Record<string, unknown>;
  delete result.rawWhoPercentiles;
  return result as T;
}
