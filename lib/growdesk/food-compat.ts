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
  return `${date}T${legacyWallClock(time)}:00.000Z`;
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
    mealType: mealType(body.mealType),
    occurredAt: createOccurredAt(body, date),
    foodItemIds: foodItemIds(rawFoods),
    portionDescription: portion(body.portionDescription !== undefined ? body.portionDescription : body.portion),
    reaction: reaction(body.reaction),
    notes: optionalText(body.notes, "notes"),
  };
}

export function toGrowDeskFoodUpdatePayload(body: Record<string, unknown>) {
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
  if (body.notes !== undefined) payload.notes = optionalText(body.notes, "notes");
  return payload;
}

export function fromGrowDeskFoodRecord(rec: GrowDeskFoodRecord): LegacyFoodRecord {
  const version = wireVersion(rec.version);
  if (typeof rec.recordDate !== "string") throw new BridgeError(502, "UPSTREAM_INVALID_RECORD", "GrowDesk 返回了不完整的辅食记录");
  calendarDate(rec.recordDate);
  const time = rec.occurredAt ? new Date(rec.occurredAt).toISOString().slice(11, 16) : null;
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
    notes: rec.notes,
    version,
    baseVersion: version,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
