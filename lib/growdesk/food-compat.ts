if (typeof window !== "undefined") {
  throw new Error("This module can only be loaded on the server.");
}

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
  version?: number;
  baseVersion?: number;
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

export function toGrowDeskFoodCreatePayload(body: Record<string, unknown>) {
  const dateStr = String(body.date || new Date().toISOString().slice(0, 10));
  const mealType = String(body.mealType || "lunch") as "breakfast" | "lunch" | "dinner" | "snack";

  let occurredAt: string | null = null;
  if (body.time && typeof body.time === "string") {
    occurredAt = `${dateStr}T${body.time}:00.000Z`;
  } else if (body.timestamp) {
    occurredAt = new Date(String(body.timestamp)).toISOString();
  }

  const rawFoods = Array.isArray(body.foods) ? body.foods : [];
  const foodItemIds = rawFoods.map((f: any) => typeof f === "object" && f?.id ? String(f.id) : String(f));

  return {
    recordDate: dateStr,
    mealType,
    occurredAt,
    foodItemIds,
    portionDescription: body.portion ? String(body.portion) : null,
    reaction: body.reaction ? (String(body.reaction) as "like" | "normal" | "dislike") : null,
    notes: body.notes ? String(body.notes).trim() : null,
  };
}

export function toGrowDeskFoodUpdatePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    baseVersion: Number(body.baseVersion ?? body.version ?? 1),
  };

  if (body.date) {
    payload.recordDate = String(body.date);
  }
  if (body.mealType) {
    payload.mealType = String(body.mealType);
  }
  if (body.time) {
    const dateStr = String(body.date || new Date().toISOString().slice(0, 10));
    payload.occurredAt = `${dateStr}T${body.time}:00.000Z`;
  }
  if (Array.isArray(body.foods)) {
    payload.foodItemIds = body.foods.map((f: any) => typeof f === "object" && f?.id ? String(f.id) : String(f));
  }
  if (body.portion !== undefined) {
    payload.portionDescription = body.portion ? String(body.portion) : null;
  }
  if (body.reaction !== undefined) {
    payload.reaction = body.reaction ? String(body.reaction) : null;
  }
  if (body.notes !== undefined) {
    payload.notes = body.notes ? String(body.notes).trim() : null;
  }

  return payload;
}

export function fromGrowDeskFoodRecord(rec: GrowDeskFoodRecord): LegacyFoodRecord {
  const time = rec.occurredAt ? rec.occurredAt.slice(11, 16) : null;
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
    version: Number(rec.version ?? 1),
    baseVersion: Number(rec.version ?? 1),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}
