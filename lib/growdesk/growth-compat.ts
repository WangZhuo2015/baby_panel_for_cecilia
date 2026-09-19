import { wireVersion } from "./bridge-protocol";
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
  source?: string;
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
}

export interface GrowDeskWhoPercentilePoint {
  month: number;
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
    attachmentId: body.attachmentId ? String(body.attachmentId) : null,
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

  if (body.attachmentId !== undefined) {
    payload.attachmentId = body.attachmentId ? String(body.attachmentId) : null;
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

export function fromGrowDeskGrowthRecord(rec: GrowDeskGrowthRecord, birthDate?: string): LegacyGrowthRecord {
  const weight = rec.weightKg !== null ? Number(rec.weightKg) : null;
  const height = rec.heightCm !== null ? Number(rec.heightCm) : null;
  const head = rec.headCircumferenceCm !== null ? Number(rec.headCircumferenceCm) : null;
  const version = wireVersion(rec.version);
  const age = birthDate && isValidDateStr(birthDate.slice(0, 10)) && isValidDateStr(rec.measurementDate)
    ? calculateAge(birthDate, rec.measurementDate) : undefined;

  return {
    ...(age ? { ageInMonths: age.months, ageLabel: age.label } : {}),
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
  const sorted = [...points].sort((a, b) => a.month - b.month);
  return {
    P97: sorted.map((p) => Number(p.p97)),
    P85: sorted.map((p) => Number(p.p85)),
    P50: sorted.map((p) => Number(p.p50)),
    P15: sorted.map((p) => Number(p.p15)),
    P3: sorted.map((p) => Number(p.p3)),
  };
}

export function transformWhoPercentilesForLegacy(data?: {
  weightForAge?: GrowDeskWhoPercentilePoint[];
  heightForAge?: GrowDeskWhoPercentilePoint[];
  headCircumferenceForAge?: GrowDeskWhoPercentilePoint[];
}): Record<string, LegacyPercentileData> {
  return {
    weight: transformWhoSeriesToLegacy(data?.weightForAge),
    height: transformWhoSeriesToLegacy(data?.heightForAge),
    headCircumference: transformWhoSeriesToLegacy(data?.headCircumferenceForAge),
  };
}
