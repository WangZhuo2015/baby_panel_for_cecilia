export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function hhmmToIso(time: string, date: string): string {
  const ms = new Date(`${date}T${time}:00+08:00`).getTime();
  if (Number.isNaN(ms)) throw new Error(`无效时间 ${time}`);
  return new Date(ms).toISOString();
}

export function optionalNumber(raw: unknown, min: number, max: number, label: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < min || n > max) throw new Error(`${label} 必须在 ${min}-${max} 之间`);
  return n;
}

export type Params = Record<string, unknown>;

export function ok(text: string, details: unknown = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

export function fail(message: string): never {
  throw new Error(message);
}

export function normalizeAliasParams(raw: Params): Params {
  // Allow LLM to send snake_case or alternative keys; normalize to camelCase for service
  const p = { ...raw } as Params;
  // feeding aliases
  if (p.amount_ml !== undefined && p.amountMl === undefined) p.amountMl = p.amount_ml;
  if (p.amount !== undefined && p.amountMl === undefined) p.amountMl = p.amount;
  if (p.ml !== undefined && p.amountMl === undefined) p.amountMl = p.ml;
  if (p.left_minutes !== undefined && p.leftMinutes === undefined) p.leftMinutes = p.left_minutes;
  if (p.right_minutes !== undefined && p.rightMinutes === undefined) p.rightMinutes = p.right_minutes;
  if (p.durationMinutes !== undefined && p.leftMinutes === undefined) p.leftMinutes = p.durationMinutes;
  if (p.duration_minutes !== undefined && p.leftMinutes === undefined) p.leftMinutes = p.duration_minutes;
  if (p.timestamp === undefined && p.time !== undefined) p.timestamp = p.time;
  if (p.timestamp === undefined && p.startTime !== undefined) p.timestamp = p.startTime;
  if (p.timestamp === undefined && p.start_time !== undefined) p.timestamp = p.start_time;
  // sleep aliases
  if (p.start_time !== undefined && p.startTime === undefined) p.startTime = p.start_time;
  if (p.end_time !== undefined && p.endTime === undefined) p.endTime = p.end_time;
  if (p.duration !== undefined && p.durationMinutes === undefined) p.durationMinutes = p.duration as number;
  // diaper
  if (p.poop_color !== undefined && p.poopColor === undefined) p.poopColor = p.poop_color;
  if (p.poop_consistency !== undefined && p.poopConsistency === undefined) p.poopConsistency = p.poop_consistency;
  if (p.texture !== undefined && p.poopConsistency === undefined) p.poopConsistency = p.texture;
  // food
  if (p.food !== undefined && p.foods === undefined) p.foods = p.food;
  if (p.foodName !== undefined && p.foods === undefined) p.foods = p.foodName;
  if (p.food_name !== undefined && p.foods === undefined) p.foods = p.food_name;
  if (p.name !== undefined && p.foods === undefined && typeof p.name === "string" && (p as any).foods === undefined) { /* handled per tool */ }
  // growth
  if (p.weight !== undefined && p.weightKg === undefined) p.weightKg = p.weight;
  if (p.height !== undefined && p.heightCm === undefined) p.heightCm = p.height;
  if (p.head !== undefined && p.headCircumferenceCm === undefined) p.headCircumferenceCm = p.head;
  return p;
}
