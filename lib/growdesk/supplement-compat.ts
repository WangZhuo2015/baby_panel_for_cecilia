if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacySupplementRecord {
  id: string;
  babyId: string;
  name?: string;
  supplementName?: string;
  timestamp?: string;
  occurredAt?: string;
  amount?: string | null;
  notes?: string | null;
  source?: string;
  sourceAgent?: string | null;
  recordedById?: string | null;
  version?: number;
  baseVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskSupplementRecord {
  id: string;
  babyId: string;
  familyId: string;
  supplementName: string;
  occurredAt: string;
  amount: string | null;
  notes: string | null;
  recordedByUserId?: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export function toGrowDeskSupplementCreatePayload(body: Record<string, unknown>) {
  const supplementName = String(body.supplementName || body.name || "").trim();

  let occurredAt = new Date().toISOString();
  const timeRaw = body.occurredAt || body.timestamp;
  if (timeRaw) {
    const d = new Date(String(timeRaw));
    if (!isNaN(d.getTime())) {
      occurredAt = d.toISOString();
    }
  }

  return {
    supplementName,
    occurredAt,
    amount: body.amount !== undefined && body.amount !== null ? String(body.amount) : null,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function toGrowDeskSupplementUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.supplementName || body.name) {
    payload.supplementName = String(body.supplementName || body.name).trim();
  }

  const timeRaw = body.occurredAt || body.timestamp;
  if (timeRaw) {
    const d = new Date(String(timeRaw));
    if (!isNaN(d.getTime())) {
      payload.occurredAt = d.toISOString();
    }
  }

  if (body.amount !== undefined) {
    payload.amount = body.amount !== null ? String(body.amount) : null;
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

export function fromGrowDeskSupplementRecord(rec: GrowDeskSupplementRecord): LegacySupplementRecord {
  return {
    id: rec.id,
    babyId: rec.babyId,
    name: rec.supplementName,
    supplementName: rec.supplementName,
    timestamp: rec.occurredAt,
    occurredAt: rec.occurredAt,
    amount: rec.amount,
    notes: rec.notes,
    recordedById: rec.recordedByUserId ?? null,
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
