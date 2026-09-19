if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

import { BridgeError, wireVersion } from "./bridge-protocol";
import { legacyVersion, nonNegativeInteger, optionalText, optionalTimestamp, requiredEnum, requiredTimestamp } from "./record-compat-helpers";

export interface LegacySleepRecord {
  id: string;
  babyId: string;
  type?: "nap" | "night";
  sleepType?: "nap" | "night";
  startTime?: string;
  endTime?: string | null;
  startedAt?: string;
  endedAt?: string | null;
  nightWakingCount?: number;
  quality?: string | null;
  notes?: string | null;
  source?: string;
  sourceAgent?: string | null;
  recordedById?: string | null;
  version?: string;
  baseVersion?: string;
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
  recordedByUserId?: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

const SLEEP_TYPES = ["nap", "night"] as const;

function sleepType(body: Record<string, unknown>): "nap" | "night" {
  return requiredEnum(body.sleepType ?? body.type, SLEEP_TYPES, "sleepType");
}

function startValue(body: Record<string, unknown>): unknown {
  return body.startedAt !== undefined ? body.startedAt : body.startTime;
}

function endValue(body: Record<string, unknown>): unknown {
  return body.endedAt !== undefined ? body.endedAt : body.endTime;
}

export function toGrowDeskSleepCreatePayload(body: Record<string, unknown>) {
  const startedAt = requiredTimestamp(startValue(body), "startedAt");
  const rawEndedAt = endValue(body);
  const endedAt = rawEndedAt === undefined || rawEndedAt === null || rawEndedAt === ""
    ? null
    : requiredTimestamp(rawEndedAt, "endedAt");
  const nightWakingCount = nonNegativeInteger(body.nightWakingCount, "nightWakingCount", 0);
  const notes = optionalText(body.notes, "notes");
  const source = body.source === undefined ? "ui_manual" : optionalText(body.source, "source") || "ui_manual";
  const sourceAgent = optionalText(body.sourceAgent, "sourceAgent");
  return {
    sleepType: sleepType(body),
    startedAt,
    endedAt,
    nightWakingCount,
    notes,
    source,
    sourceAgent,
  };
}

export function toGrowDeskSleepUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = { baseVersion: legacyVersion(body.baseVersion ?? body.version) };
  if (body.sleepType !== undefined || body.type !== undefined) payload.sleepType = sleepType(body);
  if (body.startedAt !== undefined || body.startTime !== undefined) payload.startedAt = requiredTimestamp(startValue(body), "startedAt");
  if (body.endedAt !== undefined || body.endTime !== undefined) payload.endedAt = optionalTimestamp(endValue(body), "endedAt");
  if (body.nightWakingCount !== undefined) payload.nightWakingCount = nonNegativeInteger(body.nightWakingCount, "nightWakingCount");
  if (body.notes !== undefined) payload.notes = optionalText(body.notes, "notes");
  return payload;
}

export function fromGrowDeskSleepRecord(rec: GrowDeskSleepRecord): LegacySleepRecord {
  const version = wireVersion(rec.version);
  if (typeof rec.startedAt !== "string" || !rec.startedAt) throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了不完整的睡眠记录");
  return {
    id: rec.id,
    babyId: rec.babyId,
    type: rec.sleepType,
    sleepType: rec.sleepType,
    startTime: rec.startedAt,
    startedAt: rec.startedAt,
    endTime: rec.endedAt,
    endedAt: rec.endedAt,
    nightWakingCount: rec.nightWakingCount,
    notes: rec.notes,
    source: rec.source,
    sourceAgent: rec.sourceAgent,
    recordedById: rec.recordedByUserId ?? null,
    version,
    baseVersion: version,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
