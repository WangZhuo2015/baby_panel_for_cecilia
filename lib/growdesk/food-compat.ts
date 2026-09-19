if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

import { BridgeError, calendarDate, isoTimestamp, wireVersion } from "./bridge-protocol";
import { foodItemIds, legacyVersion, legacyWallClock, optionalText, requiredEnum, requiredTimestamp } from "./record-compat-helpers";

export interface LegacyFoodRecord {
  id: string;
  babyId: string;
  date: string;
  time?: string | null;
  mealType?: string;
  foods?: Array<{ id: string; name: string } | string>;
  foodNames?: string[];
  portion?: string | null;
  reaction?: string | null;
  notes?: string | null;
  acceptance?: number;
  babyState?: string;
  hasAbnormal?: boolean;
  abnormalNotes?: string;
  source?: string;
  sourceAgent?: string | null;
  version?: string;
  baseVersion?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface GrowDeskFoodRecord {
  id: string;
  babyId: string;
  familyId: string;
  recordDate: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  occurredAt: string | null;
  foodItemIds: string[];
  portionDescription: string | null;
  reaction: "like" | "normal" | "dislike" | null;
  notes: string | null;
  version: string;
  createdAt: string;
  updatedAt: string;
}

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
const REACTIONS = ["like", "normal", "dislike"] as const;
// Legacy food forms use the family wall clock. Until per-family zones are wired,
// assume modern Asia/Shanghai (UTC+08:00), never the Node host's timezone.
const FOOD_FAMILY_TIMEZONE = "Asia/Shanghai";
const FOOD_FAMILY_UTC_OFFSET = "+08:00";
const OBSERVATION_KEYS = ["acceptance", "babyState", "hasAbnormal", "abnormalNotes"] as const;
const OBSERVATION_PREFIX = "[growdesk-web-food:v1]";

// The backend has no observation fields. A versioned JSON notes envelope keeps
// them losslessly alongside human notes; untagged/malformed notes stay literal.
export function decodeNotes(notes: string | null): { notes: string | null; observations: Record<string, unknown> } {
  if (notes?.startsWith(OBSERVATION_PREFIX)) {
    try {
      const data = JSON.parse(notes.slice(OBSERVATION_PREFIX.length));
      if (data && (data.notes === null || typeof data.notes === "string") && data.observations && typeof data.observations === "object" && !Array.isArray(data.observations)) {
        return { notes: data.notes, observations: Object.fromEntries(OBSERVATION_KEYS.filter(key => data.observations[key] !== undefined).map(key => [key, data.observations[key]])) };
      }
    } catch { /* Preserve malformed or user-authored prefix text verbatim. */ }
  }
  return { notes, observations: {} };
}

function encodeNotes(body: Record<string, unknown>, existingNotes: string | null = null): string | null {
  const existing = decodeNotes(existingNotes);
  const notes = body.notes === undefined ? existing.notes : optionalText(body.notes, "notes");
  const observations = { ...existing.observations };
  for (const key of OBSERVATION_KEYS) if (body[key] !== undefined) observations[key] = body[key];
  if (!Object.keys(observations).length) return notes;
  // Reject oversize data, never truncate or silently lose legacy observations.
  return optionalText(OBSERVATION_PREFIX + JSON.stringify({ notes, observations }), "notes");
}

function inferredMealType(body: Record<string, unknown>): GrowDeskFoodRecord["mealType"] {
  if (body.mealType !== undefined) return mealType(body.mealType);
  // Compatibility rule: <11 breakfast, <15 lunch, <20 dinner, otherwise snack.
  // Missing wall-clock time defaults to snack (not dependent on request time).
  if (body.time === undefined || body.time === null || body.time === "") return "snack";
  const hour = Number(legacyWallClock(body.time).slice(0, 2));
  return hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 20 ? "dinner" : "snack";
}

function recordDate(body: Record<string, unknown>): string {
  return calendarDate(body.recordDate ?? body.date);
}

function mealType(value: unknown): "breakfast" | "lunch" | "dinner" | "snack" {
  return requiredEnum(value, MEAL_TYPES, "mealType");
}

function reaction(value: unknown): "like" | "normal" | "dislike" | null {
  if (value === undefined || value === null || value === "") return null;
  return requiredEnum(value, REACTIONS, "reaction");
}

function portion(value: unknown): string | null {
  return optionalText(value, "portionDescription");
}

function wallClockOccurredAt(date: string, time: unknown): string {
  return isoTimestamp(`${date}T${legacyWallClock(time)}:00${FOOD_FAMILY_UTC_OFFSET}`);
}

function createOccurredAt(body: Record<string, unknown>, date: string): string | null {
  if (body.occurredAt !== undefined) return body.occurredAt === null ? null : requiredTimestamp(body.occurredAt, "occurredAt");
  if (body.timestamp !== undefined) return body.timestamp === null ? null : requiredTimestamp(body.timestamp, "occurredAt");
  if (body.time !== undefined && body.time !== null && body.time !== "") return wallClockOccurredAt(date, body.time);
  if (body.time !== undefined && body.time !== null && body.time !== "") throw new BridgeError(400, "INVALID_TIME", "time 必须为 HH:MM 格式");
  return null;
}

function updateOccurredAt(body: Record<string, unknown>, date: string | undefined): string | null | undefined {
  if (body.occurredAt !== undefined) return body.occurredAt === null ? null : requiredTimestamp(body.occurredAt, "occurredAt");
  if (body.timestamp !== undefined) return body.timestamp === null ? null : requiredTimestamp(body.timestamp, "occurredAt");
  if (body.time === undefined) return undefined;
  if (body.time === null || body.time === "") return null;
  if (!date) throw new BridgeError(400, "INVALID_DATE", "修改 time 时必须提供 date");
  return wallClockOccurredAt(calendarDate(date), body.time);
}

export function toGrowDeskFoodCreatePayload(body: Record<string, unknown>) {
  const date = recordDate(body);
  const rawFoods = body.foodItemIds !== undefined ? body.foodItemIds : body.foods;
  return {
    recordDate: date,
    mealType: inferredMealType(body),
    occurredAt: createOccurredAt(body, date),
    foodItemIds: foodItemIds(rawFoods),
    portionDescription: portion(body.portionDescription !== undefined ? body.portionDescription : body.portion),
    reaction: reaction(body.reaction),
    notes: encodeNotes(body),
  };
}

export function toGrowDeskFoodUpdatePayload(body: Record<string, unknown>, existing?: GrowDeskFoodRecord) {
  const payload: Record<string, unknown> = { baseVersion: legacyVersion(body.baseVersion ?? body.version) };
  let date: string | undefined;
  if (body.recordDate !== undefined || body.date !== undefined) {
    date = calendarDate(body.recordDate !== undefined ? body.recordDate : body.date);
    payload.recordDate = date;
  }
  if (body.mealType !== undefined) payload.mealType = mealType(body.mealType);
  const occurredAt = updateOccurredAt(body, date ?? (typeof body.recordDate === "string" ? body.recordDate : typeof body.date === "string" ? body.date : undefined));
  if (occurredAt !== undefined) payload.occurredAt = occurredAt;
  if (body.foodItemIds !== undefined || body.foods !== undefined) payload.foodItemIds = foodItemIds(body.foodItemIds !== undefined ? body.foodItemIds : body.foods);
  if (body.portionDescription !== undefined || body.portion !== undefined) payload.portionDescription = portion(body.portionDescription !== undefined ? body.portionDescription : body.portion);
  if (body.reaction !== undefined) payload.reaction = reaction(body.reaction);
  if (body.notes !== undefined || OBSERVATION_KEYS.some(key => body[key] !== undefined)) payload.notes = encodeNotes(body, existing?.notes);
  return payload;
}

export function fromGrowDeskFoodRecord(rec: GrowDeskFoodRecord): LegacyFoodRecord {
  const version = wireVersion(rec.version);
  if (typeof rec.recordDate !== "string") throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了不完整的辅食记录");
  calendarDate(rec.recordDate);
  const time = rec.occurredAt ? new Intl.DateTimeFormat("en-GB", { timeZone: FOOD_FAMILY_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(rec.occurredAt)) : null;
  const decoded = decodeNotes(rec.notes);
  return {
    id: rec.id,
    babyId: rec.babyId,
    date: rec.recordDate,
    time,
    mealType: rec.mealType,
    foods: rec.foodItemIds,
    foodNames: rec.foodItemIds,
    portion: rec.portionDescription,
    reaction: rec.reaction,
    ...decoded.observations,
    notes: decoded.notes,
    version,
    baseVersion: version,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
