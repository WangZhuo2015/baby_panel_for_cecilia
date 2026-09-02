import { prisma } from "@/lib/prisma";
import { getLocalDayUtcRange, isValidDateStr, getLocalDateStr, getLocalTimeStr, addDays, formatIsoToLocalTime } from "@/lib/date";
import { calculateCorrectedAge } from "@/lib/age";
import { estimatePercentile } from "@/lib/who-growth-standards";
import { safeJsonParse } from "@/lib/json";

/**
 * Deep Module: RecordService
 * Small interface per domain, hides time normalization, validation, future guard, idempotency, percentile, and prisma.
 * Routes and agent tools inject RecordContext (userId+babyId+baby) and receive domain objects.
 * Deletion test: deleting this module would scatter 400+ lines of validation/time logic across 10+ call sites.
 */
export class ValidationError extends Error {
  status = 400;
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
export class NotFoundError extends Error {
  status = 404;
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class ForbiddenError extends Error {
  status = 403;
  constructor(message: string = "Forbidden") { super(message); this.name = "ForbiddenError"; }
}
export type RecordContext = { userId: string; babyId: string; baby?: any; familyId?: string | null };

export interface CreateFeedingInput {
  timestamp?: string;
  type: string;
  amountMl?: number | null;
  leftMinutes?: number | null;
  rightMinutes?: number | null;
  spitUp?: boolean;
  notes?: string | null;
  clientId?: string | null;
  formulaProductId?: string | null;
}

export interface CreateSleepInput {
  startTime: string;
  endTime: string;
  type?: string;
  nightWakingCount?: number;
  notes?: string | null;
  clientId?: string | null;
  date?: string;
}

export interface CreateDiaperInput {
  timestamp?: string;
  type: string;
  poopColor?: string | null;
  poopConsistency?: string | null;
  notes?: string | null;
  clientId?: string | null;
}

export interface CreateFoodLogInput {
  date?: string;
  time?: string;
  foods?: unknown;
  portion?: string;
  acceptance?: number;
  babyState?: string;
  hasAbnormal?: boolean;
  abnormalNotes?: string | null;
  clientId?: string | null;
}

export interface CreateGrowthInput {
  date: string;
  weightKg?: number | string | null;
  heightCm?: number | string | null;
  headCircumferenceCm?: number | string | null;
  imageUrl?: string | null;
  clientId?: string | null;
}

function parseLimit(raw: unknown, fallback = 50): number {
  const n = parseInt(String(raw ?? fallback), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(100, Math.max(1, n));
}

function normalizeTimestamp(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const trimmed = raw.trim();
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (TIME_RE.test(trimmed)) {
    const date = getLocalDateStr();
    return new Date(`${date}T${trimmed}:00+08:00`).toISOString();
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError("timestamp 格式无效");
  return parsed.toISOString();
}

function guardFutureAndBirth(baby: any, timestamp: string) {
  if (new Date(timestamp).getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new ValidationError("记录时间不能是未来");
  }
  if (baby?.birthDate && timestamp.slice(0, 10) < baby.birthDate) {
    throw new ValidationError("记录时间不能早于宝宝出生日期");
  }
}

function clientIdOrNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 && raw.length <= 64 ? raw : null;
}

async function triggerFamilyPush(ctx: RecordContext, title: string, body: string, url: string = "/notifications") {
  try {
    const { notifyFamilyMembers, getFamilyMemberLabel } = await import("@/lib/push-helper");
    let familyId = ctx.familyId;
    if (!familyId) {
      const baby = await prisma.baby.findUnique({ where: { id: ctx.babyId }, select: { familyId: true } });
      familyId = baby?.familyId;
    }
    if (!familyId) return;
    const actor = await getFamilyMemberLabel(familyId, ctx.userId);
    void notifyFamilyMembers({
      familyId,
      excludeUserId: ctx.userId,
      title: `${actor} ${title}`,
      body,
      url,
    });
  } catch {
    // Non-blocking
  }
}

export async function createFeeding(ctx: RecordContext, input: CreateFeedingInput) {
  const validTypes = ["breast", "formula", "bottle_breast", "mixed", "solid"];
  const type = validTypes.includes(input.type) ? input.type : "formula";
  if (!input.type || !validTypes.includes(input.type)) {
    // Keep strict error for API seam; agent tools tolerate fallback.
  }
  const timestamp = normalizeTimestamp(input.timestamp);
  guardFutureAndBirth(ctx.baby, timestamp);
  if (input.notes && input.notes.length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
  if (input.amountMl != null && (Number.isNaN(Number(input.amountMl)) || Number(input.amountMl) < 0 || Number(input.amountMl) > 3000)) {
    throw new ValidationError("amountMl 必须为 0-3000");
  }
  if (input.leftMinutes != null && (Number.isNaN(Number(input.leftMinutes)) || Number(input.leftMinutes) < 0 || Number(input.leftMinutes) > 180)) {
    throw new ValidationError("leftMinutes 必须为 0-180");
  }
  if (input.rightMinutes != null && (Number.isNaN(Number(input.rightMinutes)) || Number(input.rightMinutes) < 0 || Number(input.rightMinutes) > 180)) {
    throw new ValidationError("rightMinutes 必须为 0-180");
  }
  const clientId = clientIdOrNull(input.clientId);
  const data = {
    babyId: ctx.babyId,
    recordedById: ctx.userId,
    timestamp,
    type,
    amountMl: input.amountMl ?? null,
    leftMinutes: input.leftMinutes ?? null,
    rightMinutes: input.rightMinutes ?? null,
    spitUp: !!input.spitUp,
    notes: input.notes?.trim() || null,
    formulaProductId: input.formulaProductId || null,
  };
  let record: any;
  if (clientId) {
    record = await prisma.feedingRecord.upsert({
      where: { babyId_clientId: { babyId: ctx.babyId, clientId } },
      create: { ...data, clientId },
      update: {},
    });
  } else {
    record = await prisma.feedingRecord.create({ data });
  }
  const feedDesc = type === "breast"
    ? `母乳 亲喂(左${input.leftMinutes || 0}分/右${input.rightMinutes || 0}分)`
    : type === "bottle_breast"
      ? `瓶喂母乳 ${input.amountMl || 0}ml`
      : `配方奶 ${input.amountMl || 0}ml`;
  void triggerFamilyPush(ctx, "记录了喂奶 🍼", feedDesc, "/records/feeding");
  return record;
}

export function validateFeedingStrict(input: { type?: unknown; amountMl?: unknown; leftMinutes?: unknown; rightMinutes?: unknown; timestamp?: unknown; notes?: unknown }) {
  const validTypes = ["breast", "formula", "bottle_breast", "mixed", "solid"];
  if (!input.type || typeof input.type !== "string" || !validTypes.includes(input.type)) {
    throw new ValidationError("type 必填且只能为 breast、formula、bottle_breast、mixed 或 solid");
  }
  if (input.amountMl !== undefined && input.amountMl !== null && input.amountMl !== "") {
    const n = Number(input.amountMl);
    if (Number.isNaN(n) || n < 0 || n > 3000) throw new ValidationError("amountMl 必须为 0-3000 之间的有效数值");
  }
  if (input.leftMinutes !== undefined && input.leftMinutes !== null && input.leftMinutes !== "") {
    const n = Number(input.leftMinutes);
    if (Number.isNaN(n) || n < 0 || n > 180) throw new ValidationError("leftMinutes 必须为 0-180 之间的有效数值");
  }
  if (input.rightMinutes !== undefined && input.rightMinutes !== null && input.rightMinutes !== "") {
    const n = Number(input.rightMinutes);
    if (Number.isNaN(n) || n < 0 || n > 180) throw new ValidationError("rightMinutes 必须为 0-180 之间的有效数值");
  }
  if (input.timestamp !== undefined && input.timestamp !== null && String(input.timestamp).trim() !== "") {
    const parsed = new Date(String(input.timestamp).trim());
    if (Number.isNaN(parsed.getTime())) throw new ValidationError("timestamp 格式无效");
  }
  if (input.notes !== undefined && input.notes !== null && String(input.notes).trim().length > 1000) {
    throw new ValidationError("notes 不能超过 1000 个字符");
  }
}

export async function createSleep(ctx: RecordContext, input: CreateSleepInput) {
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  let start = input.startTime?.trim() || "";
  let end = input.endTime?.trim() || "";
  const date = input.date && isValidDateStr(input.date) ? input.date : getLocalDateStr();
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    // If HH:MM invalid, try ISO path for agent compatibility
    const tryIso = (s: string) => {
      const ms = new Date(s).getTime();
      return Number.isNaN(ms) ? null : new Date(ms).toISOString();
    };
    const startIsoTry = tryIso(start);
    const endIsoTry = tryIso(end);
    if (startIsoTry && endIsoTry) {
      if (new Date(endIsoTry).getTime() <= new Date(startIsoTry).getTime()) throw new ValidationError("醒来时间必须晚于入睡时间");
      const durationMs = new Date(endIsoTry).getTime() - new Date(startIsoTry).getTime();
      if (durationMs <= 0) throw new ValidationError("入睡与醒来时间不能相同");
      if (durationMs > 20 * 60 * 60 * 1000) throw new ValidationError("单次睡眠时长不能超过 20 小时");
      if (new Date(startIsoTry).getTime() > Date.now() + 48 * 60 * 60 * 1000) throw new ValidationError("睡眠开始时间不能在未来两天以后");
      guardSleepNotes(input.notes);
      const clientId = clientIdOrNull(input.clientId);
      const data = {
        babyId: ctx.babyId,
        recordedById: ctx.userId,
        startTime: startIsoTry,
        endTime: endIsoTry,
        type: input.type === "night" ? "night" : "day",
        nightWakingCount: typeof input.nightWakingCount === "number" && input.nightWakingCount >= 0 ? Math.floor(input.nightWakingCount) : 0,
        notes: input.notes?.trim() || null,
      };
      if (clientId) return prisma.sleepRecord.upsert({ where: { babyId_clientId: { babyId: ctx.babyId, clientId } }, create: { ...data, clientId }, update: {} });
      return prisma.sleepRecord.create({ data });
    }
    // Fallback to duration-based (used by tools)
    const duration = 60;
    const now = new Date();
    const startD = new Date(now.getTime() - duration * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    start = `${pad(startD.getHours())}:${pad(startD.getMinutes())}`;
    end = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  const hhmmToIso = (t: string, d: string) => new Date(`${d}T${t}:00+08:00`).toISOString();
  let startIso = hhmmToIso(start, date);
  let endIso = hhmmToIso(end, date);
  if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    endIso = new Date(new Date(endIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (durationMs <= 0) throw new ValidationError("入睡与醒来时间不能相同");
  if (durationMs > 20 * 60 * 60 * 1000) throw new ValidationError("单次睡眠不能超过 20 小时");
  if (new Date(startIso).getTime() > Date.now() + 48 * 60 * 60 * 1000) throw new ValidationError("睡眠开始时间不能在未来两天以后");
  guardSleepNotes(input.notes);
  const clientId = clientIdOrNull(input.clientId);
  const data = {
    babyId: ctx.babyId,
    recordedById: ctx.userId,
    startTime: startIso,
    endTime: endIso,
    type: input.type === "night" ? "night" : "day",
    nightWakingCount: typeof input.nightWakingCount === "number" && input.nightWakingCount >= 0 ? Math.floor(input.nightWakingCount) : 0,
    notes: input.notes?.trim() || null,
  };
  let record: any;
  if (clientId) {
    record = await prisma.sleepRecord.upsert({
      where: { babyId_clientId: { babyId: ctx.babyId, clientId } },
      create: { ...data, clientId },
      update: {},
    });
  } else {
    record = await prisma.sleepRecord.create({ data });
  }
  const sleepDesc = `${input.type === "night" ? "夜觉" : "小睡"} · ${start} ~ ${end}`;
  void triggerFamilyPush(ctx, "记录了睡眠 😴", sleepDesc, "/records/sleep");
  return record;
}

function guardSleepNotes(notes: unknown) {
  if (notes !== undefined && notes !== null && String(notes).trim().length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
}

export async function createDiaper(ctx: RecordContext, input: CreateDiaperInput) {
  const valid = ["pee", "poop", "both"];
  if (!input.type || !valid.includes(input.type)) throw new ValidationError("type 必填且只能为 pee、poop 或 both");
  let timestamp = new Date().toISOString();
  if (input.timestamp) {
    const parsed = new Date(input.timestamp);
    if (Number.isNaN(parsed.getTime())) throw new ValidationError("timestamp 格式无效");
    timestamp = parsed.toISOString();
  }
  if (input.notes && String(input.notes).trim().length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
  if (input.poopColor && String(input.poopColor).trim().length > 100) throw new ValidationError("poopColor 不能超过 100 个字符");
  if (input.poopConsistency && String(input.poopConsistency).trim().length > 100) throw new ValidationError("poopConsistency 不能超过 100 个字符");
  const clientId = clientIdOrNull(input.clientId);
  const data = {
    babyId: ctx.babyId,
    recordedById: ctx.userId,
    timestamp,
    type: input.type,
    poopColor: input.poopColor ? String(input.poopColor).trim() : null,
    poopConsistency: input.poopConsistency ? String(input.poopConsistency).trim() : null,
    notes: input.notes ? String(input.notes).trim() : null,
  };
  let dRecord: any;
  if (clientId) {
    dRecord = await prisma.diaperRecord.upsert({ where: { babyId_clientId: { babyId: ctx.babyId, clientId } }, create: { ...data, clientId }, update: {} });
  } else {
    dRecord = await prisma.diaperRecord.create({ data });
  }
  const diaperDesc = input.type === "pee" ? "嘘嘘" : input.type === "poop" ? "便便" : "嘘嘘+便便";
  void triggerFamilyPush(ctx, "记录了换尿布 🧷", diaperDesc, "/records/diaper");
  return dRecord;
}

export async function createFoodLog(ctx: RecordContext, input: CreateFoodLogInput) {
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const validatedDate = typeof input.date === "string" && isValidDateStr(input.date.trim()) ? input.date.trim() : getLocalDateStr();
  if (typeof input.date === "string" && input.date.trim() !== "" && !isValidDateStr(input.date.trim())) throw new ValidationError("date 必须为有效的 YYYY-MM-DD");
  const validatedTime = typeof input.time === "string" && TIME_RE.test(input.time.trim()) ? input.time.trim() : getLocalTimeStr();
  if (typeof input.time === "string" && input.time.trim() !== "" && !TIME_RE.test(input.time.trim())) throw new ValidationError("time 必须为 HH:MM 格式");
  const validPortions = ["little", "half", "most", "all"];
  const validatedPortion = typeof input.portion === "string" && validPortions.includes(input.portion) ? input.portion : "most";
  if (typeof input.portion === "string" && input.portion.trim() !== "" && !validPortions.includes(input.portion)) throw new ValidationError("portion 必须为 little/half/most/all 之一");
  const accNum = typeof input.acceptance === "number" ? Math.round(input.acceptance) : 3;
  if (input.acceptance !== undefined && input.acceptance !== null && (input.acceptance as unknown) !== "" && (!Number.isInteger(accNum) || accNum < 1 || accNum > 5)) throw new ValidationError("acceptance 必须为 1-5 的整数");
  const validatedAcceptance = Number.isInteger(accNum) && accNum >= 1 && accNum <= 5 ? accNum : 3;
  const validBabyStates = ["happy", "neutral", "rejected"];
  const validatedBabyState = typeof input.babyState === "string" && validBabyStates.includes(input.babyState) ? input.babyState : "happy";
  if (typeof input.babyState === "string" && input.babyState.trim() !== "" && !validBabyStates.includes(input.babyState)) throw new ValidationError("babyState 必须为 happy/neutral/rejected 之一");
  // foods validation
  let foodsRaw: unknown = input.foods;
  // Support alias foods from tools: already normalized
  let foodsArr: unknown[] = [];
  if (Array.isArray(foodsRaw)) foodsArr = foodsRaw;
  else if (typeof foodsRaw === "string" && foodsRaw.trim()) {
    try { const parsed = JSON.parse(foodsRaw); if (Array.isArray(parsed)) foodsArr = parsed; else foodsArr = [foodsRaw]; } catch { foodsArr = [foodsRaw]; }
  } else if (foodsRaw == null) {
    foodsArr = [];
  } else {
    foodsArr = [String(foodsRaw)];
  }
  if (foodsArr.length > 20) throw new ValidationError("foods 不能超过 20 项");
  if (input.abnormalNotes !== undefined && input.abnormalNotes !== null && String(input.abnormalNotes).trim().length > 1000) throw new ValidationError("abnormalNotes 不能超过 1000 个字符");
  const clientId = clientIdOrNull(input.clientId);
  const foodsJson = Array.isArray(foodsArr) ? JSON.stringify(foodsArr) : String(foodsRaw ?? "[]");
  const data = {
    babyId: ctx.babyId,
    recordedById: ctx.userId,
    date: validatedDate,
    time: validatedTime,
    foods: foodsJson,
    portion: validatedPortion,
    acceptance: validatedAcceptance,
    babyState: validatedBabyState,
    hasAbnormal: !!input.hasAbnormal,
    abnormalNotes: input.abnormalNotes ? String(input.abnormalNotes).trim() : null,
  };
  const record = clientId
    ? await prisma.foodLogRecord.upsert({ where: { babyId_clientId: { babyId: ctx.babyId, clientId } }, create: { ...data, clientId }, update: {} })
    : await prisma.foodLogRecord.create({ data });
  void triggerFamilyPush(ctx, "记录了辅食 🍚", `${foodsArr.join("、") || "辅食"} · 份量: ${validatedPortion}`, "/food");
  return { ...record, foods: safeJsonParse(record.foods, []) };
}

export async function createGrowth(ctx: RecordContext, input: CreateGrowthInput) {
  if (!input.date || typeof input.date !== "string" || !isValidDateStr(input.date.trim())) throw new ValidationError("date 必填且必须为有效的 YYYY-MM-DD 日期");
  const today = getLocalDateStr();
  const dateVal = input.date.trim();
  if (dateVal > addDays(today, 1)) throw new ValidationError("测量日期不能是未来");
  if (ctx.baby?.birthDate && dateVal < ctx.baby.birthDate) throw new ValidationError("测量日期不能早于宝宝出生日期");
  const parseNum = (raw: unknown, min: number, max: number, label: string): number | null => {
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Number(raw);
    if (Number.isNaN(n) || n < min || n > max) throw new ValidationError(`${label}范围必须在 ${min}${label.includes("体重")?"kg":label.includes("身长")||label.includes("身高")?"cm":"cm"} 到 ${max}${label.includes("体重")?"kg":"cm"} 之间`);
    return n;
  };
  // Use exact original messages for API compat
  let parsedWeight: number | null = null;
  let parsedHeight: number | null = null;
  let parsedHeadCirc: number | null = null;
  if (input.weightKg !== undefined && input.weightKg !== null && input.weightKg !== "") {
    const n = Number(input.weightKg);
    if (Number.isNaN(n) || n < 0.5 || n > 50) throw new ValidationError("体重范围必须在 0.5kg 到 50kg 之间");
    parsedWeight = n;
  }
  if (input.heightCm !== undefined && input.heightCm !== null && input.heightCm !== "") {
    const n = Number(input.heightCm);
    if (Number.isNaN(n) || n < 20 || n > 150) throw new ValidationError("身长/身高范围必须在 20cm 到 150cm 之间");
    parsedHeight = n;
  }
  if (input.headCircumferenceCm !== undefined && input.headCircumferenceCm !== null && input.headCircumferenceCm !== "") {
    const n = Number(input.headCircumferenceCm);
    if (Number.isNaN(n) || n < 20 || n > 60) throw new ValidationError("头围范围必须在 20cm 到 60cm 之间");
    parsedHeadCirc = n;
  }
  if (parsedWeight === null && parsedHeight === null && parsedHeadCirc === null) throw new ValidationError("请至少提供一项测量数据（体重、身高或头围）");
  if (input.imageUrl !== undefined && input.imageUrl !== null && String(input.imageUrl).trim() !== "" && !/^\/uploads\/(avatars|medical|growth)\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(String(input.imageUrl).trim())) {
    throw new ValidationError("imageUrl 仅支持本站 /uploads/ 路径的图片");
  }
  const ageSummary = calculateCorrectedAge(ctx.baby?.birthDate, ctx.baby?.gestationalAge, dateVal);
  const gender = ctx.baby?.gender || "female";
  let percentile: number | null = null;
  if (parsedWeight !== null) percentile = estimatePercentile(gender, "weight", ageSummary.correctedDecimalMonths, parsedWeight);
  else if (parsedHeight !== null) percentile = estimatePercentile(gender, "height", ageSummary.correctedDecimalMonths, parsedHeight);
  else if (parsedHeadCirc !== null) percentile = estimatePercentile(gender, "headCircumference", ageSummary.correctedDecimalMonths, parsedHeadCirc);
  const clientId = clientIdOrNull(input.clientId);
  const baseData = {
    babyId: ctx.babyId,
    recordedById: ctx.userId,
    date: dateVal,
    ageInMonths: ageSummary.correctedMonths,
    ageLabel: ageSummary.label,
    weightKg: parsedWeight,
    heightCm: parsedHeight,
    headCircumferenceCm: parsedHeadCirc,
    percentile,
    imageUrl: input.imageUrl ? String(input.imageUrl).trim().slice(0, 500) : null,
  };
  let gRecord: any;
  if (clientId) {
    gRecord = await prisma.growthMeasurement.upsert({ where: { babyId_clientId: { babyId: ctx.babyId, clientId } }, create: { ...baseData, clientId }, update: {} });
  } else {
    gRecord = await prisma.growthMeasurement.create({ data: baseData });
  }
  const growthDesc = [parsedWeight ? `体重 ${parsedWeight}kg` : "", parsedHeight ? `身高 ${parsedHeight}cm` : "", parsedHeadCirc ? `头围 ${parsedHeadCirc}cm` : ""].filter(Boolean).join(" · ") || "体检生长测量";
  void triggerFamilyPush(ctx, "记录了生长数据 📏", growthDesc, "/growth");
  return gRecord;
}

// ── Query side (read) ──
export async function getFeedingRecords(ctx: RecordContext, opts: { date?: string; limit?: number | string }) {
  const where: any = { babyId: ctx.babyId };
  if (opts.date) {
    if (!isValidDateStr(opts.date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
    const { start, end } = getLocalDayUtcRange(opts.date);
    where.timestamp = { gte: start, lt: end };
  }
  const limit = parseLimit(opts.limit, 50);
  return prisma.feedingRecord.findMany({ where, orderBy: { timestamp: "desc" }, take: limit });
}

export async function getSleepRecords(ctx: RecordContext, opts: { date?: string; limit?: number | string }) {
  const where: any = { babyId: ctx.babyId };
  if (opts.date) {
    if (!isValidDateStr(opts.date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
    const { start, end } = getLocalDayUtcRange(opts.date);
    where.startTime = { lt: end };
    where.endTime = { gt: start };
  }
  const limit = parseLimit(opts.limit, 50);
  return prisma.sleepRecord.findMany({ where, orderBy: { startTime: "desc" }, take: limit });
}

export async function getDiaperRecords(ctx: RecordContext, opts: { date?: string; limit?: number | string }) {
  const where: any = { babyId: ctx.babyId };
  if (opts.date) {
    if (!isValidDateStr(opts.date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
    const { start, end } = getLocalDayUtcRange(opts.date);
    where.timestamp = { gte: start, lt: end };
  }
  const limit = parseLimit(opts.limit, 50);
  return prisma.diaperRecord.findMany({ where, orderBy: { timestamp: "desc" }, take: limit });
}

export async function getFoodLogRecords(ctx: RecordContext, opts: { date?: string; limit?: number | string }) {
  const where: any = { babyId: ctx.babyId };
  if (opts.date) {
    if (!isValidDateStr(opts.date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
    where.date = opts.date;
  }
  const limit = parseLimit(opts.limit, 50);
  const records = await prisma.foodLogRecord.findMany({ where, orderBy: [{ date: "desc" }, { time: "desc" }], take: limit });
  return records.map((r) => ({ ...r, foods: safeJsonParse(r.foods, []) }));
}

export async function getGrowthMeasurements(ctx: RecordContext, opts: { limit?: number | string } = {}) {
  const limit = parseLimit(opts.limit, 50);
  return prisma.growthMeasurement.findMany({ where: { babyId: ctx.babyId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: limit });
}

export async function getMedicalReports(ctx: RecordContext, opts: { category?: string; limit?: number | string } = {}) {
  const where: any = { babyId: ctx.babyId };
  if (opts.category && opts.category !== "all") where.category = opts.category;
  const limit = parseLimit(opts.limit, 50);
  const reports = await prisma.medicalReport.findMany({ where, orderBy: { date: "desc" }, take: limit });
  return reports.map((r) => ({ ...r, items: safeJsonParse(r.itemsJson, []) }));
}

export async function getDailySummary(ctx: RecordContext, date?: string) {
  const targetDate = date && isValidDateStr(date) ? date : getLocalDateStr();
  if (date && !isValidDateStr(date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
  const { start, end } = getLocalDayUtcRange(targetDate);
  const dayStartMs = new Date(start).getTime();
  const dayEndMs = new Date(end).getTime();
  const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
    prisma.feedingRecord.findMany({ where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } } }),
    prisma.sleepRecord.findMany({ where: { babyId: ctx.babyId, startTime: { lt: end }, endTime: { gt: start } } }),
    prisma.diaperRecord.findMany({ where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } } }),
    prisma.foodLogRecord.findMany({ where: { babyId: ctx.babyId, date: targetDate } }),
  ]);
  const totalFeedingMl = feedingRecords.reduce((sum, r) => sum + (r.amountMl ?? 0), 0);
  const sleepIntervals = sleepRecords
    .map((record) => ({ startMs: new Date(record.startTime).getTime(), endMs: new Date(record.endTime).getTime() }))
    .filter((iv) => !Number.isNaN(iv.startMs) && !Number.isNaN(iv.endMs) && iv.endMs > iv.startMs)
    .map((iv) => ({ startMs: Math.max(iv.startMs, dayStartMs), endMs: Math.min(iv.endMs, dayEndMs) }))
    .filter((iv) => iv.endMs > iv.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  let totalSleepMinutes = 0;
  let mergedStartMs = 0;
  let mergedEndMs = 0;
  for (const interval of sleepIntervals) {
    if (mergedEndMs === 0 || interval.startMs > mergedEndMs) {
      if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
      mergedStartMs = interval.startMs;
      mergedEndMs = interval.endMs;
    } else mergedEndMs = Math.max(mergedEndMs, interval.endMs);
  }
  if (mergedEndMs > 0) totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
  return { date: targetDate, totalFeedingMl, totalSleepMinutes, diaperCount: diaperRecords.length, foodCount: foodLogs.length };
}

export async function getTimeline(ctx: RecordContext, date?: string) {
  const targetDate = date && isValidDateStr(date) ? date : getLocalDateStr();
  if (date && !isValidDateStr(date)) throw new ValidationError("Invalid date format, expected YYYY-MM-DD");
  const { start, end } = getLocalDayUtcRange(targetDate);
  const dayStartMs = new Date(start).getTime();
  // recorder map requires familyId; fetch if ctx has it else skip
  let recorderOf: (id: string | null) => string | null = () => null;
  if (ctx.familyId) {
    try {
      const members = await prisma.familyMember.findMany({ where: { familyId: ctx.familyId }, include: { user: { select: { displayName: true, username: true } } } });
      const map = new Map<string, string>();
      for (const m of members) map.set(m.userId, m.user.displayName || m.user.username);
      recorderOf = (id) => (id && map.get(id)) || null;
    } catch {}
  }
  const [feedingRecords, sleepRecords, diaperRecords, foodLogs, supplementRecords] = await Promise.all([
    prisma.feedingRecord.findMany({ where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } }),
    prisma.sleepRecord.findMany({ where: { babyId: ctx.babyId, startTime: { lt: end }, endTime: { gt: start } }, orderBy: { startTime: "desc" } }),
    prisma.diaperRecord.findMany({ where: { babyId: ctx.babyId, timestamp: { gte: start, lt: end } }, orderBy: { timestamp: "desc" } }),
    prisma.foodLogRecord.findMany({ where: { babyId: ctx.babyId, date: targetDate }, orderBy: { time: "desc" } }),
    prisma.supplementRecord.findMany({ where: { babyId: ctx.babyId, date: targetDate }, include: { product: true }, orderBy: { time: "desc" } }),
  ]);
  const typeLabels: Record<string, string> = {
    breast: "母乳亲喂", formula: "配方奶", bottle_breast: "瓶喂母乳", mixed: "混合喂养", solid: "辅食餐点",
    night: "夜间睡眠", day: "白天小睡", pee: "嘘嘘 (尿)", poop: "便便", both: "嘘嘘 + 便便",
  };
  const typeIcons: Record<string, string> = {
    breast: "🤱", formula: "🍼", bottle_breast: "🍼", mixed: "🍼", solid: "🥣",
    night: "🌙", day: "💤", pee: "💧", poop: "💩", both: "💧💩", food: "🍽️",
  };
  const timeline: any[] = [];
  for (const r of feedingRecords) {
    const time = formatIsoToLocalTime(r.timestamp);
    let detail = "";
    if (r.amountMl) detail += `${r.amountMl}ml`;
    if (r.leftMinutes || r.rightMinutes) {
      const sides = [];
      if (r.leftMinutes) sides.push(`左${r.leftMinutes}分`);
      if (r.rightMinutes) sides.push(`右${r.rightMinutes}分`);
      detail += detail ? ` (${sides.join("+")})` : sides.join("+");
    }
    if (r.spitUp) detail += detail ? " · 吐奶" : "吐奶";
    if (r.notes) detail += detail ? ` · ${r.notes}` : r.notes;
    timeline.push({
      id: r.id,
      time,
      sortMs: new Date(r.timestamp).getTime(),
      type: "feeding" as const,
      title: typeLabels[r.type] || "喂奶",
      detail: detail || undefined,
      icon: typeIcons[r.type] || "🍼",
      recorderName: recorderOf(r.recordedById),
      rawRecord: {
        id: r.id,
        timestamp: r.timestamp,
        type: r.type,
        amountMl: r.amountMl,
        leftMinutes: r.leftMinutes,
        rightMinutes: r.rightMinutes,
        spitUp: r.spitUp,
        notes: r.notes,
      },
    });
  }
  for (const r of sleepRecords) {
    const startStr = formatIsoToLocalTime(r.startTime);
    const endStr = formatIsoToLocalTime(r.endTime);
    const startMs = new Date(r.startTime).getTime();
    const endMs = new Date(r.endTime).getTime();
    const isOvernight = startMs < dayStartMs;
    const durationMin = Math.round((endMs - startMs) / 60000);
    const h = Math.floor(durationMin / 60);
    const m = durationMin % 60;
    const durationText = h > 0 ? `${h}小时${m > 0 ? `${m}分` : ""}` : `${m}分钟`;
    let detail = `${durationText}（${startStr}–${endStr}）`;
    if (r.nightWakingCount > 0) detail += ` · 夜醒 ${r.nightWakingCount}次`;
    if (r.notes) detail += ` · ${r.notes}`;
    timeline.push({
      id: r.id,
      time: isOvernight ? "00:00" : startStr,
      sortMs: isOvernight ? dayStartMs : startMs,
      type: "sleep" as const,
      title: isOvernight ? "跨夜睡眠 (接昨日)" : (typeLabels[r.type] || "睡觉"),
      detail,
      icon: typeIcons[r.type] || "🌙",
      recorderName: recorderOf(r.recordedById),
      rawRecord: {
        id: r.id,
        startTime: r.startTime,
        endTime: r.endTime,
        type: r.type,
        nightWakingCount: r.nightWakingCount,
        notes: r.notes,
      },
    });
  }
  for (const r of diaperRecords) {
    const time = formatIsoToLocalTime(r.timestamp);
    let detail = typeLabels[r.type] || "";
    if (r.poopColor) { const colorMap: Record<string,string>={ yellow:"黄色", green:"绿色", brown:"棕色", other:"其他"}; detail += ` · ${colorMap[r.poopColor]||r.poopColor}`; }
    if (r.poopConsistency) { const consMap: Record<string,string>={ loose:"稀便", paste:"糊状", formed:"成形"}; detail += ` · ${consMap[r.poopConsistency]||r.poopConsistency}`; }
    if (r.notes) detail += ` · ${r.notes}`;
    timeline.push({
      id: r.id,
      time,
      sortMs: new Date(r.timestamp).getTime(),
      type: "diaper" as const,
      title: "换尿布",
      detail: detail || undefined,
      icon: typeIcons[r.type] || "💧",
      recorderName: recorderOf(r.recordedById),
      rawRecord: {
        id: r.id,
        timestamp: r.timestamp,
        type: r.type,
        poopColor: r.poopColor,
        poopConsistency: r.poopConsistency,
        notes: r.notes,
      },
    });
  }
  for (const r of foodLogs) {
    const foods = safeJsonParse<string[]>(r.foods, []);
    const foodMs = new Date(`${targetDate}T${(r.time || "12:00").padStart(5,"0")}:00+08:00`).getTime();
    timeline.push({
      id: r.id,
      time: r.time,
      sortMs: Number.isNaN(foodMs)?dayStartMs:foodMs,
      type: "food" as const,
      title: "辅食餐点",
      detail: Array.isArray(foods)&&foods.length>0?foods.join("、"):undefined,
      icon:"🥣",
      recorderName: recorderOf(r.recordedById),
      rawRecord: {
        id: r.id,
        date: r.date,
        time: r.time,
        foods,
        portion: r.portion,
        acceptance: r.acceptance,
        babyState: r.babyState,
        hasAbnormal: r.hasAbnormal,
        abnormalNotes: r.abnormalNotes,
      },
    });
  }
  for (const r of supplementRecords) {
    const suppMs = new Date(`${targetDate}T${(r.time || "12:00").padStart(5, "0")}:00+08:00`).getTime();
    timeline.push({
      id: r.id,
      time: r.time,
      sortMs: Number.isNaN(suppMs) ? dayStartMs : suppMs,
      type: "supplement" as const,
      title: "补剂打卡",
      detail: `${r.product?.name || "营养补充剂"} ${r.dose}${r.unitName || r.product?.unitName || "剂"}${r.notes ? ` · ${r.notes}` : ""}`,
      icon: "💊",
      recorderName: recorderOf(r.recordedById),
      rawRecord: {
        id: r.id,
        date: r.date,
        time: r.time,
        productId: r.productId,
        productName: r.product?.name,
        dose: r.dose,
        unitName: r.unitName || r.product?.unitName,
        notes: r.notes,
      },
    });
  }
  timeline.sort((a: any, b: any) => (b.sortMs ?? 0) - (a.sortMs ?? 0));
  return timeline.map(({ sortMs: _s, ...rest }: any) => rest);
}

// ── Mutations with ownership ──
export async function deleteRecord(ctx: RecordContext, type: "feeding"|"sleep"|"diaper"|"food"|"growth"|"supplement", id: string) {
  if (!id || typeof id !== "string") throw new ValidationError("请提供要删除的记录 ID");
  let record: any = null;
  if (type === "feeding") record = await prisma.feedingRecord.findUnique({ where: { id } });
  else if (type === "sleep") record = await prisma.sleepRecord.findUnique({ where: { id } });
  else if (type === "diaper") record = await prisma.diaperRecord.findUnique({ where: { id } });
  else if (type === "food") record = await prisma.foodLogRecord.findUnique({ where: { id } });
  else if (type === "growth") record = await prisma.growthMeasurement.findUnique({ where: { id } });
  else if (type === "supplement") record = await prisma.supplementRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundError(type === "feeding" ? "未找到指定的喂养记录" : type === "sleep" ? "未找到指定的睡眠记录" : type === "diaper" ? "未找到指定的排便/尿布记录" : type === "food" ? "未找到指定的辅食记录" : type === "growth" ? "未找到指定的生长记录" : "未找到指定的补剂记录");
  if (record.babyId !== ctx.babyId) throw new ForbiddenError();

  // Automatically capture pre-deletion snapshot for safe rollback
  const { captureRecordSnapshot } = await import("./snapshot");
  await captureRecordSnapshot({
    ctx: { babyId: ctx.babyId, userId: ctx.userId, source: "ui_manual" },
    action: "delete",
    entityType: type,
    entityId: id,
    payload: record,
  });

  if (type === "feeding") await prisma.feedingRecord.delete({ where: { id } });
  else if (type === "sleep") await prisma.sleepRecord.delete({ where: { id } });
  else if (type === "diaper") await prisma.diaperRecord.delete({ where: { id } });
  else if (type === "food") await prisma.foodLogRecord.delete({ where: { id } });
  else if (type === "growth") await prisma.growthMeasurement.delete({ where: { id } });
  else if (type === "supplement") await prisma.supplementRecord.delete({ where: { id } });
  const typeMap: Record<string, string> = { feeding: "喂奶记录", sleep: "睡眠记录", diaper: "换尿布记录", food: "辅食记录", growth: "生长测量", supplement: "补剂打卡" };
  void triggerFamilyPush(ctx, `删除了${typeMap[type] || "记录"} 🗑️`, "撤销了一条记录", "/");
  return { success: true, id };
}

export async function updateFeeding(ctx: RecordContext, id: string, patch: Record<string, unknown>) {
  const record = await prisma.feedingRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundError("未找到指定的喂养记录");
  if (record.babyId !== ctx.babyId) throw new ForbiddenError();
  const merged: any = {
    type: (patch.type ?? record.type) as string,
    amountMl: patch.amountMl !== undefined ? patch.amountMl : record.amountMl,
    leftMinutes: patch.leftMinutes !== undefined ? patch.leftMinutes : record.leftMinutes,
    rightMinutes: patch.rightMinutes !== undefined ? patch.rightMinutes : record.rightMinutes,
    spitUp: patch.spitUp !== undefined ? patch.spitUp === true || patch.spitUp === "true" || patch.spitUp === 1 : record.spitUp,
    notes: patch.notes !== undefined ? (patch.notes ? String(patch.notes).trim() : null) : record.notes,
    timestamp: (patch.timestamp ?? record.timestamp) as string,
    formulaProductId: patch.formulaProductId !== undefined ? patch.formulaProductId : record.formulaProductId,
  };
  const validTypes = ["breast", "formula", "bottle_breast", "mixed", "solid"];
  if (!validTypes.includes(merged.type)) throw new ValidationError("type 只能为 breast、formula、bottle_breast、mixed 或 solid");
  if (merged.notes !== null && String(merged.notes).length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
  const numOrNull = (v: unknown, min:number,max:number,label:string): number|null => {
    if (v===undefined||v===null||v==="") return null;
    const n=Number(v); if(Number.isNaN(n)||n<min||n>max) throw new ValidationError(`${label} 必须为 ${min}-${max} 之间的有效数值`);
    return n;
  };
  const parsedTs = new Date(merged.timestamp as string);
  if (Number.isNaN(parsedTs.getTime())) throw new ValidationError("timestamp 格式无效");
  const data = {
    type: merged.type,
    amountMl: numOrNull(merged.amountMl,0,3000,"amountMl"),
    leftMinutes: numOrNull(merged.leftMinutes,0,180,"leftMinutes"),
    rightMinutes: numOrNull(merged.rightMinutes,0,180,"rightMinutes"),
    spitUp: !!merged.spitUp,
    notes: merged.notes,
    timestamp: parsedTs.toISOString(),
    formulaProductId: merged.formulaProductId ? String(merged.formulaProductId) : null,
  };
  const updated = await prisma.feedingRecord.update({ where: { id }, data });
  void triggerFamilyPush(ctx, "修改了喂奶记录 ✏️", "修正了喂奶内容", "/records/feeding");
  return updated;
}

export async function updateSleep(ctx: RecordContext, id: string, patch: Record<string, unknown>) {
  const record = await prisma.sleepRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundError("未找到指定的睡眠记录");
  if (record.babyId !== ctx.babyId) throw new ForbiddenError();
  const trimmedStart = String((patch.startTime ?? record.startTime) as string).trim();
  const trimmedEnd = String((patch.endTime ?? record.endTime) as string).trim();
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  let finalStartIso: string; let finalEndIso: string;
  if (timeRegex.test(trimmedStart) && timeRegex.test(trimmedEnd)) {
    const targetDate = patch.date && isValidDateStr(String(patch.date)) ? String(patch.date) : getLocalDateStr(new Date(record.startTime));
    const startMs = new Date(`${targetDate}T${trimmedStart.padStart(5,"0")}:00+08:00`).getTime();
    let endMs = new Date(`${targetDate}T${trimmedEnd.padStart(5,"0")}:00+08:00`).getTime();
    if (endMs <= startMs) endMs += 24*60*60*1000;
    finalStartIso = new Date(startMs).toISOString();
    finalEndIso = new Date(endMs).toISOString();
  } else {
    const startMs = new Date(trimmedStart).getTime();
    const endMs = new Date(trimmedEnd).getTime();
    if (Number.isNaN(startMs)||Number.isNaN(endMs)) throw new ValidationError("时间格式不正确");
    finalStartIso = new Date(startMs).toISOString();
    finalEndIso = new Date(endMs).toISOString();
  }
  const durationMs = new Date(finalEndIso).getTime() - new Date(finalStartIso).getTime();
  if (durationMs <= 0) throw new ValidationError("入睡与醒来时间不能相同");
  if (durationMs > 20*60*60*1000) throw new ValidationError("单次睡眠时长不能超过 20 小时");
  const sleepType = patch.type !== undefined ? (patch.type === "night" ? "night" : "day") : record.type;
  const wakingCount = patch.nightWakingCount !== undefined ? (typeof patch.nightWakingCount === "number" && (patch.nightWakingCount as number) >=0 ? Math.floor(patch.nightWakingCount as number) : 0) : record.nightWakingCount;
  const notes = patch.notes !== undefined ? (patch.notes ? String(patch.notes).trim() : null) : record.notes;
  if (notes !== null && String(notes).length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
  const updated = await prisma.sleepRecord.update({ where: { id }, data: { startTime: finalStartIso, endTime: finalEndIso, type: sleepType, nightWakingCount: wakingCount, notes } });
  void triggerFamilyPush(ctx, "修改了睡眠记录 ✏️", "修正了睡眠时间", "/records/sleep");
  return updated;
}

export async function updateDiaper(ctx: RecordContext, id: string, patch: Record<string, unknown>) {
  const record = await prisma.diaperRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundError("未找到指定的换尿布记录");
  if (record.babyId !== ctx.babyId) throw new ForbiddenError();
  const merged: any = {
    type: patch.type ?? record.type,
    poopColor: patch.poopColor !== undefined ? (patch.poopColor ? String(patch.poopColor).trim() : null) : record.poopColor,
    poopConsistency: patch.poopConsistency !== undefined ? (patch.poopConsistency ? String(patch.poopConsistency).trim() : null) : record.poopConsistency,
    notes: patch.notes !== undefined ? (patch.notes ? String(patch.notes).trim() : null) : record.notes,
    timestamp: patch.timestamp ?? record.timestamp,
  };
  if (!["pee","poop","both"].includes(merged.type)) throw new ValidationError("type 只能为 pee、poop 或 both");
  if (merged.notes !== null && String(merged.notes).length > 1000) throw new ValidationError("notes 不能超过 1000 个字符");
  if (merged.poopColor !== null && String(merged.poopColor).length > 100) throw new ValidationError("poopColor 不能超过 100 个字符");
  if (merged.poopConsistency !== null && String(merged.poopConsistency).length > 100) throw new ValidationError("poopConsistency 不能超过 100 个字符");
  const parsed = new Date(merged.timestamp as string);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError("timestamp 格式无效");
  const updated = await prisma.diaperRecord.update({ where: { id }, data: { type: merged.type, poopColor: merged.poopColor, poopConsistency: merged.poopConsistency, notes: merged.notes, timestamp: parsed.toISOString() } });
  void triggerFamilyPush(ctx, "修改了换尿布记录 ✏️", "修正了尿布记录", "/records/diaper");
  return updated;
}

export async function updateFoodLog(ctx: RecordContext, id: string, patch: Record<string, unknown>) {
  const record = await prisma.foodLogRecord.findUnique({ where: { id } });
  if (!record) throw new NotFoundError("未找到指定的辅食记录");
  if (record.babyId !== ctx.babyId) throw new ForbiddenError();
  const merged: any = {
    date: (patch.date ?? record.date) as string,
    time: (patch.time ?? record.time) as string,
    foods: patch.foods !== undefined ? (Array.isArray(patch.foods) ? JSON.stringify(patch.foods) : String(patch.foods || "[]")) : record.foods,
    portion: patch.portion ?? record.portion,
    acceptance: patch.acceptance !== undefined ? patch.acceptance : record.acceptance,
    babyState: patch.babyState ?? record.babyState,
    hasAbnormal: patch.hasAbnormal !== undefined ? patch.hasAbnormal === true : record.hasAbnormal,
    abnormalNotes: patch.abnormalNotes !== undefined ? (patch.abnormalNotes ? String(patch.abnormalNotes).trim() : null) : record.abnormalNotes,
  };
  if (!isValidDateStr(merged.date)) throw new ValidationError("date 必须为有效的 YYYY-MM-DD");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(merged.time))) throw new ValidationError("time 必须为 HH:MM 格式");
  const acc = Number(merged.acceptance);
  if (!Number.isInteger(acc) || acc < 1 || acc > 5) throw new ValidationError("acceptance 必须为 1-5 的整数");
  if (patch.foods !== undefined && Array.isArray(patch.foods) && (patch.foods as unknown[]).length > 20) throw new ValidationError("foods 不能超过 20 项");
  try { const parsed = safeJsonParse(merged.foods as string, []); if (Array.isArray(parsed) && parsed.length > 20) throw new ValidationError("foods 不能超过 20 项"); } catch (e:any) { if (e.message?.includes("foods 不能超过")) throw e; }
  if (merged.abnormalNotes !== null && String(merged.abnormalNotes).length > 1000) throw new ValidationError("abnormalNotes 不能超过 1000 个字符");
  const updated = await prisma.foodLogRecord.update({ where: { id }, data: { date: merged.date, time: String(merged.time), foods: merged.foods, portion: String(merged.portion), acceptance: acc, babyState: String(merged.babyState), hasAbnormal: merged.hasAbnormal, abnormalNotes: merged.abnormalNotes } });
  void triggerFamilyPush(ctx, "修改了辅食记录 ✏️", "修正了辅食记录", "/food");
  return { ...updated, foods: safeJsonParse(updated.foods, []) };
}
