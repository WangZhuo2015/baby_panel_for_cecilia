if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyGrowthRecord {
  id: string;
  babyId: string;
  date: string;
  weight?: number | null;
  weightKg?: number | null;
  height?: number | null;
  heightCm?: number | null;
  headCircumference?: number | null;
  headCircumferenceCm?: number | null;
  notes?: string | null;
  source?: string;
  sourceAgent?: string | null;
  version?: number;
  baseVersion?: number;
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
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
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

export function fromGrowDeskGrowthRecord(rec: GrowDeskGrowthRecord): LegacyGrowthRecord {
  const weight = rec.weightKg !== null ? Number(rec.weightKg) : null;
  const height = rec.heightCm !== null ? Number(rec.heightCm) : null;
  const head = rec.headCircumferenceCm !== null ? Number(rec.headCircumferenceCm) : null;

  return {
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
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
