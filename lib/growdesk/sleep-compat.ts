if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

export interface LegacySleepRecord {
  id: string;
  babyId: string;
  type?: "nap" | "night";
  sleepType?: "nap" | "night";
  startTime?: string;
  endTime?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  quality?: string | null;
  notes?: string | null;
  source?: string;
  sourceAgent?: string | null;
  version?: number;
  baseVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskSleepRecord {
  id: string;
  babyId: string;
  familyId: string;
  sleepType: "nap" | "night";
  startedAt: string;
  endedAt: string | null;
  nightWakingCount: number;
  notes: string | null;
  source: string;
  sourceAgent: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export function toGrowDeskSleepCreatePayload(body: Record<string, unknown>) {
  const type = String(body.sleepType || body.type || "nap") as "nap" | "night";

  let startedAt = new Date().toISOString();
  const startRaw = body.startedAt || body.startTime;
  if (startRaw) {
    const d = new Date(String(startRaw));
    if (!isNaN(d.getTime())) {
      startedAt = d.toISOString();
    }
  }

  let endedAt: string | null = null;
  const endRaw = body.endedAt || body.endTime;
  if (endRaw) {
    const d = new Date(String(endRaw));
    if (!isNaN(d.getTime())) {
      endedAt = d.toISOString();
    }
  }

  return {
    sleepType: type,
    startedAt,
    endedAt,
    nightWakingCount: Number(body.nightWakingCount ?? 0),
    notes: body.notes ? String(body.notes).trim() : null,
    source: body.source ? String(body.source) : "ui_manual",
    sourceAgent: body.sourceAgent ? String(body.sourceAgent) : null,
  };
}

export function toGrowDeskSleepUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.sleepType || body.type) {
    payload.sleepType = String(body.sleepType || body.type);
  }

  const startRaw = body.startedAt || body.startTime;
  if (startRaw) {
    const d = new Date(String(startRaw));
    if (!isNaN(d.getTime())) {
      payload.startedAt = d.toISOString();
    }
  }

  const hasEndedAt = "endedAt" in body || "endTime" in body;
  if (hasEndedAt) {
    const endRaw = body.endedAt !== undefined ? body.endedAt : body.endTime;
    if (endRaw === null || endRaw === "") {
      payload.endedAt = null;
    } else {
      const d = new Date(String(endRaw));
      payload.endedAt = isNaN(d.getTime()) ? null : d.toISOString();
    }
  }

  if (body.nightWakingCount !== undefined) {
    payload.nightWakingCount = Number(body.nightWakingCount);
  }

  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

export function fromGrowDeskSleepRecord(rec: GrowDeskSleepRecord): LegacySleepRecord {
  return {
    id: rec.id,
    babyId: rec.babyId,
    type: rec.sleepType,
    sleepType: rec.sleepType,
    startTime: rec.startedAt,
    startedAt: rec.startedAt,
    endTime: rec.endedAt,
    endedAt: rec.endedAt,
    notes: rec.notes,
    source: rec.source,
    sourceAgent: rec.sourceAgent,
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
