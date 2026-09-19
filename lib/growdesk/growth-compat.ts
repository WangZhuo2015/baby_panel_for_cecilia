import { BridgeError, wireVersion } from "./bridge-protocol";
import { calculateAge } from "../age";
import { isValidDateStr } from "../date";

if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyGrowthRecord {
  id: string;
  babyId: string;
  date: string;
  ageInMonths?: number;
  ageLabel?: string;
  weight?: number | null;
  weightKg?: number | null;
  height?: number | null;
  heightCm?: number | null;
  headCircumference?: number | null;
  headCircumferenceCm?: number | null;
  notes?: string | null;
  imageUrl?: string | null;
  percentile?: number | null;
  clientId?: string | null;
  recordedById?: string | null;
  source?: string | null;
  sourceAgent?: string | null;
  version?: string | number;
  baseVersion?: string | number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskGrowthRecord {
  id: string;
  babyId: string;
  familyId: string;
  measurementDate: string;
  weightKg: string | null;
  heightCm: string | null;
  headCircumferenceCm: string | null;
  attachmentId: string | null;
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
  /** Read-only projection of the imported GrowthMeasurement metadata. */
  legacyDate?: string | null;
  legacyAgeInMonths?: number | null;
  legacyAgeLabel?: string | null;
  legacyPercentile?: number | null;
  legacyClientId?: string | null;
  legacyRecordedById?: string | null;
  legacySource?: string | null;
  legacySourceAgent?: string | null;
}

export interface GrowDeskWhoPercentilePoint {
  monthAge?: number;
  month?: number;
  p3: string;
  p15: string;
  p50: string;
  p85: string;
  p97: string;
}

export interface LegacyPercentileData {
  P97: number[];
  P85: number[];
  P50: number[];
  P15: number[];
  P3: number[];
}

export interface LegacyGrowthStandardSet {
  months: number[];
  weight: LegacyPercentileData;
  height: LegacyPercentileData;
  headCircumference: LegacyPercentileData;
}

function toDecimalStr(val: unknown, precision: number): string | null {
  if (val === undefined || val === null || val === "") return null;
  const num = Number(val);
  return isNaN(num) ? null : num.toFixed(precision);
}

function growthAttachmentId(body: Record<string, unknown>): string | null {
  const parse = (value: unknown): string | null => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") throw new BridgeError(400, "INVALID_ATTACHMENT", "请重新上传测量照片");
    const id = value.replace(/^\/api\/attachments\//, "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BridgeError(400, "INVALID_ATTACHMENT", "请重新上传测量照片");
    }
    return id;
  };
  const fromId = parse(body.attachmentId);
  const fromUrl = parse(body.imageUrl);
  if (body.attachmentId !== undefined && body.imageUrl !== undefined && fromId !== fromUrl) {
    throw new BridgeError(400, "INVALID_ATTACHMENT", "测量照片引用不一致");
  }
  return body.attachmentId !== undefined ? fromId : fromUrl;
}

export function toGrowDeskGrowthCreatePayload(body: Record<string, unknown>) {
  const measurementDate = String(body.measurementDate || body.date || new Date().toISOString().slice(0, 10));

  const weightRaw = body.weightKg !== undefined ? body.weightKg : body.weight;
  const heightRaw = body.heightCm !== undefined ? body.heightCm : body.height;
  const headRaw = body.headCircumferenceCm !== undefined ? body.headCircumferenceCm : body.headCircumference;

  return {
    measurementDate,
    weightKg: toDecimalStr(weightRaw, 2),
    heightCm: toDecimalStr(heightRaw, 1),
    headCircumferenceCm: toDecimalStr(headRaw, 1),
    attachmentId: growthAttachmentId(body),
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function toGrowDeskGrowthUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: wireVersion(body.baseVersion ?? body.version),
  };

  if (body.measurementDate || body.date) {
    payload.measurementDate = String(body.measurementDate || body.date);
  }

  const weightRaw = body.weightKg !== undefined ? body.weightKg : body.weight;
  if (weightRaw !== undefined) {
    payload.weightKg = toDecimalStr(weightRaw, 2);
  }

  const heightRaw = body.heightCm !== undefined ? body.heightCm : body.height;
  if (heightRaw !== undefined) {
    payload.heightCm = toDecimalStr(heightRaw, 1);
  }

  const headRaw = body.headCircumferenceCm !== undefined ? body.headCircumferenceCm : body.headCircumference;
  if (headRaw !== undefined) {
    payload.headCircumferenceCm = toDecimalStr(headRaw, 1);
  }

  if (body.attachmentId !== undefined || body.imageUrl !== undefined) {
    payload.attachmentId = growthAttachmentId(body);
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

function validLegacyDate(value: unknown): value is string {
  return typeof value === "string" && isValidDateStr(value);
}

function validLegacyAge(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validLegacyPercentile(value: unknown): value is number {
  return validLegacyAge(value) && value <= 100;
}

export function fromGrowDeskGrowthRecord(rec: GrowDeskGrowthRecord, birthDate?: string): LegacyGrowthRecord {
  const weight = rec.weightKg !== null ? Number(rec.weightKg) : null;
  const height = rec.heightCm !== null ? Number(rec.heightCm) : null;
  const head = rec.headCircumferenceCm !== null ? Number(rec.headCircumferenceCm) : null;
  const version = wireVersion(rec.version);
  const hasLegacyProjection = validLegacyDate(rec.legacyDate);
  const legacyDateMatchesMeasurement = hasLegacyProjection && validLegacyDate(rec.measurementDate)
    && rec.legacyDate === rec.measurementDate;
  const historicalAge = legacyDateMatchesMeasurement && validLegacyAge(rec.legacyAgeInMonths) && typeof rec.legacyAgeLabel === "string"
    ? { months: rec.legacyAgeInMonths, label: rec.legacyAgeLabel }
    : undefined;
  const age = historicalAge ?? (birthDate && isValidDateStr(birthDate.slice(0, 10)) && isValidDateStr(rec.measurementDate)
    ? calculateAge(birthDate, rec.measurementDate) : undefined);
  const historicalPercentile = legacyDateMatchesMeasurement
    ? (validLegacyPercentile(rec.legacyPercentile) ? rec.legacyPercentile : null)
    : undefined;

  return {
    ...(age ? { ageInMonths: age.months, ageLabel: age.label } : {}),
    ...(legacyDateMatchesMeasurement ? { percentile: historicalPercentile } : {}),
    ...(hasLegacyProjection
      ? {
          clientId: rec.legacyClientId ?? null,
          recordedById: rec.legacyRecordedById ?? null,
          source: rec.legacySource ?? null,
          sourceAgent: rec.legacySourceAgent ?? null,
        }
      : {}),
    id: rec.id,
    babyId: rec.babyId,
    date: rec.measurementDate,
    weight,
    weightKg: weight,
    height,
    heightCm: height,
    headCircumference: head,
    headCircumferenceCm: head,
    notes: rec.notes,
    imageUrl: rec.attachmentId ? `/api/attachments/${encodeURIComponent(rec.attachmentId)}` : null,
    version,
    baseVersion: version,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

export function transformWhoSeriesToLegacy(points?: GrowDeskWhoPercentilePoint[]): LegacyPercentileData {
  if (!Array.isArray(points) || points.length === 0) {
    return { P97: [], P85: [], P50: [], P15: [], P3: [] };
  }
  const sorted = [...points].sort((a, b) => percentileMonth(a) - percentileMonth(b));
  return {
    P97: sorted.map((p) => Number(p.p97)),
    P85: sorted.map((p) => Number(p.p85)),
    P50: sorted.map((p) => Number(p.p50)),
    P15: sorted.map((p) => Number(p.p15)),
    P3: sorted.map((p) => Number(p.p3)),
  };
}

function percentileMonth(point: GrowDeskWhoPercentilePoint): number {
  const month = point.monthAge ?? point.month;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 0) {
    throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 生长标准缺少有效月龄");
  }
  return month;
}

export function transformWhoPercentilesForLegacy(data?: {
  weightForAge?: GrowDeskWhoPercentilePoint[];
  heightForAge?: GrowDeskWhoPercentilePoint[];
  headCircumferenceForAge?: GrowDeskWhoPercentilePoint[];
}): LegacyGrowthStandardSet {
  const series = [data?.weightForAge, data?.heightForAge, data?.headCircumferenceForAge];
  const months = (series.find(points => points?.length) ?? []).map(percentileMonth).sort((a, b) => a - b);
  for (const points of series) {
    if (points?.length && JSON.stringify(points.map(percentileMonth).sort((a, b) => a - b)) !== JSON.stringify(months)) {
      throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 生长标准月龄不一致");
    }
  }
  return {
    months,
    weight: transformWhoSeriesToLegacy(data?.weightForAge),
    height: transformWhoSeriesToLegacy(data?.heightForAge),
    headCircumference: transformWhoSeriesToLegacy(data?.headCircumferenceForAge),
  };
}
