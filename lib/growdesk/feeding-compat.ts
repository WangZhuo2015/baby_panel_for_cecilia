if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyFeedingRecord {
  id: string;
  babyId: string;
  type: "breast" | "bottle" | "formula";
  timestamp: string;
  amountMl: number | null;
  leftMinutes: number | null;
  rightMinutes: number | null;
  spitUp: boolean;
  formulaProductId?: string | null;
  notes: string | null;
  source?: string;
  sourceAgent?: string | null;
  version?: number;
  baseVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GrowDeskFeedingRecord {
  id: string;
  babyId: string;
  familyId: string;
  feedingType: "breast" | "bottle" | "formula";
  occurredAt: string;
  amountMl: string | null;
  leftMinutes: number | null;
  rightMinutes: number | null;
  spitUp: boolean;
  formulaProductId: string | null;
  notes: string | null;
  source: string;
  sourceAgent: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Convert legacy create payload to canonical GrowDesk CreateFeedingRequest
 */
export function toGrowDeskFeedingCreatePayload(body: Record<string, unknown>) {
  const type = String(body.type || "formula") as "breast" | "bottle" | "formula";

  // Normalize timestamp to ISO string
  let occurredAt = new Date().toISOString();
  if (body.timestamp) {
    const d = new Date(String(body.timestamp));
    if (!isNaN(d.getTime())) {
      occurredAt = d.toISOString();
    }
  }

  let amountMl: string | null = null;
  if (body.amountMl !== undefined && body.amountMl !== null && body.amountMl !== "") {
    const num = Number(body.amountMl);
    if (!isNaN(num)) {
      amountMl = num.toFixed(1);
    }
  }

  const leftMinutes =
    body.leftMinutes !== undefined && body.leftMinutes !== null && body.leftMinutes !== ""
      ? Number(body.leftMinutes)
      : null;

  const rightMinutes =
    body.rightMinutes !== undefined && body.rightMinutes !== null && body.rightMinutes !== ""
      ? Number(body.rightMinutes)
      : null;

  const spitUp = body.spitUp === true || body.spitUp === "true" || body.spitUp === 1;

  return {
    feedingType: type,
    occurredAt,
    amountMl,
    leftMinutes,
    rightMinutes,
    spitUp,
    formulaProductId: body.formulaProductId ? String(body.formulaProductId) : null,
    notes: body.notes ? String(body.notes) : null,
    source: body.source ? String(body.source) : "ui_manual",
    sourceAgent: body.sourceAgent ? String(body.sourceAgent) : null,
  };
}

/**
 * Convert legacy update payload to canonical GrowDesk UpdateFeedingRequest
 */
export function toGrowDeskFeedingUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.type) {
    payload.feedingType = String(body.type);
  }

  if (body.timestamp) {
    const d = new Date(String(body.timestamp));
    if (!isNaN(d.getTime())) {
      payload.occurredAt = d.toISOString();
    }
  }

  if (body.amountMl !== undefined) {
    if (body.amountMl === null || body.amountMl === "") {
      payload.amountMl = null;
    } else {
      const num = Number(body.amountMl);
      payload.amountMl = isNaN(num) ? null : num.toFixed(1);
    }
  }

  if (body.leftMinutes !== undefined) {
    payload.leftMinutes = body.leftMinutes === null ? null : Number(body.leftMinutes);
  }

  if (body.rightMinutes !== undefined) {
    payload.rightMinutes = body.rightMinutes === null ? null : Number(body.rightMinutes);
  }

  if (body.spitUp !== undefined) {
    payload.spitUp = body.spitUp === true || body.spitUp === "true" || body.spitUp === 1;
  }

  if (body.formulaProductId !== undefined) {
    payload.formulaProductId = body.formulaProductId ? String(body.formulaProductId) : null;
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes) : null;
  }

  return payload;
}

/**
 * Map canonical GrowDesk FeedingRecord to legacy Next.js feeding record DTO.
 */
export function fromGrowDeskFeedingRecord(rec: GrowDeskFeedingRecord): LegacyFeedingRecord {
  return {
    id: rec.id,
    babyId: rec.babyId,
    type: rec.feedingType,
    timestamp: rec.occurredAt,
    amountMl: rec.amountMl !== null ? Number(rec.amountMl) : null,
    leftMinutes: rec.leftMinutes,
    rightMinutes: rec.rightMinutes,
    spitUp: rec.spitUp,
    formulaProductId: rec.formulaProductId,
    notes: rec.notes,
    source: rec.source,
    sourceAgent: rec.sourceAgent,
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
