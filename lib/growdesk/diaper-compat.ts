if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

import { BridgeError, wireVersion } from "./bridge-protocol";
import { legacyVersion, optionalText, requiredEnum, requiredTimestamp } from "./record-compat-helpers";

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
  version?: string;
  baseVersion?: string;
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

const DIAPER_TYPES = ["pee", "poop", "both"] as const;
function diaperType(value: unknown): "pee" | "poop" | "both" {
  const normalized = value === "wet" ? "pee" : value === "dirty" ? "poop" : value;
  return requiredEnum(normalized, DIAPER_TYPES, "diaperType");
}

export function toGrowDeskDiaperCreatePayload(body: Record<string, unknown>) {
  const source = body.source === undefined ? "ui_manual" : optionalText(body.source, "source") || "ui_manual";
  return {
    diaperType: diaperType(body.diaperType ?? body.type),
    occurredAt: requiredTimestamp(body.occurredAt ?? body.timestamp, "occurredAt"),
    poopColor: optionalText(body.poopColor, "poopColor", 100),
    poopConsistency: optionalText(body.poopConsistency, "poopConsistency", 100),
    notes: optionalText(body.notes, "notes"),
    source,
    sourceAgent: optionalText(body.sourceAgent, "sourceAgent"),
  };
}

export function toGrowDeskDiaperUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = { baseVersion: legacyVersion(body.baseVersion ?? body.version) };
  if (body.diaperType !== undefined || body.type !== undefined) payload.diaperType = diaperType(body.diaperType ?? body.type);
  if (body.occurredAt !== undefined || body.timestamp !== undefined) payload.occurredAt = requiredTimestamp(body.occurredAt ?? body.timestamp, "occurredAt");
  if (body.poopColor !== undefined) payload.poopColor = optionalText(body.poopColor, "poopColor", 100);
  if (body.poopConsistency !== undefined) payload.poopConsistency = optionalText(body.poopConsistency, "poopConsistency", 100);
  if (body.notes !== undefined) payload.notes = optionalText(body.notes, "notes");
  return payload;
}

export function fromGrowDeskDiaperRecord(rec: GrowDeskDiaperRecord): LegacyDiaperRecord {
  const version = wireVersion(rec.version);
  return {
    id: rec.id,
    babyId: rec.babyId,
    type: diaperType(rec.diaperType),
    timestamp: rec.occurredAt,
    poopColor: rec.poopColor,
    poopConsistency: rec.poopConsistency,
    notes: rec.notes,
    source: rec.source,
    sourceAgent: rec.sourceAgent,
    version,
    baseVersion: version,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
