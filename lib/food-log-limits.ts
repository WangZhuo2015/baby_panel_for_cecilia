// Shared wire limits for the weighted food form and its server adapter.
export const MAX_MEAL_FOODS = 20;
export const MAX_FOOD_NOTES_LENGTH = 1000;
export const FOOD_OBSERVATION_PREFIX = "[growdesk-web-food:v1]";
export const FOOD_OBSERVATION_KEYS = ["acceptance", "babyState", "hasAbnormal", "abnormalNotes", "components", "totalGrams"] as const;

export function serializeFoodNotes(notes: string | null, observations: Record<string, unknown>): string {
  return FOOD_OBSERVATION_PREFIX + JSON.stringify({ notes, observations });
}

export function foodLogLimitMessage(body: Record<string, unknown>): string | null {
  if (Array.isArray(body.foods) && body.foods.length > MAX_MEAL_FOODS) {
    return `每条辅食记录最多选择${MAX_MEAL_FOODS}种食材，请分成多条记录保存`;
  }
  const observations = Object.fromEntries(FOOD_OBSERVATION_KEYS
    .filter(key => body[key] !== undefined).map(key => [key, body[key]]));
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  if (serializeFoodNotes(notes, observations).length > MAX_FOOD_NOTES_LENGTH) {
    return "本餐食材信息或异常说明过长，请减少食材或缩短说明后保存";
  }
  return null;
}

export function clampFoodGrams(value: number): number {
  return Number.isFinite(value) ? Math.min(300, Math.max(0, value)) : 0;
}
