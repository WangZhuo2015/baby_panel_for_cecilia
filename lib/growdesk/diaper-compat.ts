if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacyDiaperRecord {
  id: string;
  babyId: string;
  type: "pee" | "poop" | "both";
  timestamp: string;
  poopColor: string | null;
  poopConsistency: string | null;
  notes: string | null;
  source?: string;
  sourceAgent?: string | null;
  version?: number;
  baseVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export interface GrowDeskDiaperRecord {
  id: string;
  babyId: string;
  familyId: string;
  diaperType: "pee" | "poop" | "both";
  occurredAt: string;
  poopColor: string | null;
  poopConsistency: string | null;
  notes: string | null;
  source: string;
  sourceAgent: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export function toGrowDeskDiaperCreatePayload(body: Record<string, unknown>) {
  let type = String(body.type || "pee") as "pee" | "poop" | "both";
  if (type === "wet" as any) type = "pee";
  if (type === "dirty" as any) type = "poop";

  let occurredAt = new Date().toISOString();
  if (body.timestamp) {
    const d = new Date(String(body.timestamp));
    if (!isNaN(d.getTime())) {
      occurredAt = d.toISOString();
    }
  }

  return {
    diaperType: type,
    occurredAt,
    poopColor: body.poopColor ? String(body.poopColor).trim() : null,
    poopConsistency: body.poopConsistency ? String(body.poopConsistency).trim() : null,
    notes: body.notes ? String(body.notes).trim() : null,
    source: body.source ? String(body.source) : "ui_manual",
    sourceAgent: body.sourceAgent ? String(body.sourceAgent) : null,
  };
}

export function toGrowDeskDiaperUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.type) {
    let t = String(body.type);
    if (t === "wet") t = "pee";
    if (t === "dirty") t = "poop";
    payload.diaperType = t;
  }

  if (body.timestamp) {
    const d = new Date(String(body.timestamp));
    if (!isNaN(d.getTime())) {
      payload.occurredAt = d.toISOString();
    }
  }

  if (body.poopColor !== undefined) {
    payload.poopColor = body.poopColor ? String(body.poopColor).trim() : null;
  }

  if (body.poopConsistency !== undefined) {
    payload.poopConsistency = body.poopConsistency ? String(body.poopConsistency).trim() : null;
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

export function fromGrowDeskDiaperRecord(rec: GrowDeskDiaperRecord): LegacyDiaperRecord {
  return {
    id: rec.id,
    babyId: rec.babyId,
    type: rec.diaperType,
    timestamp: rec.occurredAt,
    poopColor: rec.poopColor,
    poopConsistency: rec.poopConsistency,
    notes: rec.notes,
    source: rec.source,
    sourceAgent: rec.sourceAgent,
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
