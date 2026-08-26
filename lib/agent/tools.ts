import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { prisma } from "@/lib/prisma";
import { calculateAgeDetail } from "@/lib/age";
import {
  getLocalDateStr,
  getLocalDayUtcRange,
  isValidDateStr,
  addDays,
} from "@/lib/date";
import { estimatePercentile } from "@/lib/who-growth-standards";
import { performWebSearch } from "@/lib/agent/search";
import type { Baby } from "@/generated/prisma/client";

export interface BabyToolContext {
  userId: string;
  baby: Baby;
}

function ok(text: string, details: unknown = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

function fail(message: string) {
  throw new Error(message);
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function hhmmToIso(time: string, date: string): string {
  const ms = new Date(`${date}T${time}:00+08:00`).getTime();
  if (Number.isNaN(ms)) fail(`无效时间 ${time}`);
  return new Date(ms).toISOString();
}

type Params = Record<string, unknown>;

function optionalNumber(raw: unknown, min: number, max: number, label: string): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < min || n > max) fail(`${label} 必须在 ${min}-${max} 之间`);
  return n;
}

export function createBabyPanelTools(ctx: BabyToolContext): AgentTool[] {
  const babyId = ctx.baby.id;

  const getBabyProfile: AgentTool = {
    name: "get_baby_profile",
    label: "宝宝档案",
    description: "获取宝宝基本档案：昵称、性别、出生日期、精准月龄、胎龄/早产信息。",
    parameters: Type.Object({}),
    execute: async () => {
      const age = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate) : null;
      return ok(
        JSON.stringify(
          {
            nickname: ctx.baby.nickname,
            gender: ctx.baby.gender,
            birthDate: ctx.baby.birthDate,
            gestationalAge: ctx.baby.gestationalAge,
            age,
          },
          null,
          2
        )
      );
    },
  };

  const getDailySummary: AgentTool = {
    name: "get_daily_summary",
    label: "今日汇总",
    description: "获取指定日期的累计奶量(ml)、睡眠时长(分钟)、换尿布次数、辅食次数。日期默认今天。",
    parameters: Type.Object({
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const { start, end } = getLocalDayUtcRange(date);
      const dayStartMs = new Date(start).getTime();
      const dayEndMs = new Date(end).getTime();

      const [feedingRecords, sleepRecords, diaperRecords, foodLogs] = await Promise.all([
        prisma.feedingRecord.findMany({
          where: { babyId, timestamp: { gte: start, lt: end } },
        }),
        prisma.sleepRecord.findMany({
          where: { babyId, startTime: { lt: end }, endTime: { gt: start } },
        }),
        prisma.diaperRecord.findMany({
          where: { babyId, timestamp: { gte: start, lt: end } },
        }),
        prisma.foodLogRecord.findMany({ where: { babyId, date } }),
      ]);

      const totalFeedingMl = feedingRecords.reduce((sum, r) => sum + (r.amountMl ?? 0), 0);
      const sleepIntervals = sleepRecords
        .map((record) => ({
          startMs: new Date(record.startTime).getTime(),
          endMs: new Date(record.endTime).getTime(),
        }))
        .filter((iv) => !Number.isNaN(iv.startMs) && !Number.isNaN(iv.endMs) && iv.endMs > iv.startMs)
        .map((iv) => ({
          startMs: Math.max(iv.startMs, dayStartMs),
          endMs: Math.min(iv.endMs, dayEndMs),
        }))
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
        } else {
          mergedEndMs = Math.max(mergedEndMs, interval.endMs);
        }
      }
      if (mergedEndMs > 0) {
        totalSleepMinutes += Math.round((mergedEndMs - mergedStartMs) / 60000);
      }

      return ok(
        JSON.stringify({
          date,
          totalFeedingMl,
          totalSleepMinutes,
          diaperCount: diaperRecords.length,
          foodCount: foodLogs.length,
        })
      );
    },
  };

  const recordFeeding: AgentTool = {
    name: "record_feeding",
    label: "记录喂养",
    description: "记录一次喂养。type: breast(亲喂)/formula(配方奶)/bottle_breast(瓶喂母乳)/mixed(混合)。",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "breast, formula, bottle_breast, mixed" })),
      amountMl: Type.Optional(Type.Number({ description: "奶量毫升" })),
      durationMinutes: Type.Optional(Type.Number({ description: "喂养时长分钟" })),
      leftMinutes: Type.Optional(Type.Number({ description: "左侧亲喂分钟" })),
      rightMinutes: Type.Optional(Type.Number({ description: "右侧亲喂分钟" })),
      notes: Type.Optional(Type.String()),
      timestamp: Type.Optional(Type.String({ description: "HH:mm 或 ISO 时间，默认现在" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const amountMl = optionalNumber(params.amountMl ?? params.amount_ml ?? params.amount ?? params.ml, 0, 3000, "amountMl");
      let leftMinutes = optionalNumber(params.leftMinutes ?? params.left_minutes, 0, 180, "leftMinutes");
      const rightMinutes = optionalNumber(params.rightMinutes ?? params.right_minutes, 0, 180, "rightMinutes");
      if (leftMinutes == null && (typeof params.durationMinutes === "number" || typeof params.duration_minutes === "number")) {
        leftMinutes = optionalNumber(params.durationMinutes ?? params.duration_minutes, 0, 180, "durationMinutes");
      }

      let recordTimestamp = new Date().toISOString();
      const rawTime = params.timestamp ?? params.time ?? params.startTime ?? params.start_time;
      if (typeof rawTime === "string" && rawTime.trim()) {
        const trimmed = rawTime.trim();
        if (TIME_RE.test(trimmed)) {
          recordTimestamp = hhmmToIso(trimmed, getLocalDateStr());
        } else {
          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) recordTimestamp = parsed.toISOString();
        }
      }

      let typeStr = String(params.type ?? "formula").toLowerCase();
      if (typeStr === "bottle" || typeStr === "milk" || typeStr === "formula_milk") typeStr = "formula";
      if (typeStr === "breast_milk" || typeStr === "bottle_breast_milk") typeStr = "bottle_breast";
      if (!["breast", "formula", "bottle_breast", "mixed"].includes(typeStr)) typeStr = "formula";

      const record = await prisma.feedingRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          timestamp: recordTimestamp,
          type: typeStr,
          amountMl,
          leftMinutes,
          rightMinutes,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        },
      });
      return ok(`已记录喂养：${typeStr}${amountMl != null ? ` ${amountMl}ml` : ""}`, { id: record.id, recordId: record.id });
    },
  };

  const recordSleep: AgentTool = {
    name: "record_sleep",
    label: "记录睡眠",
    description: "记录一次睡眠。startTime/endTime 为 HH:mm（上海时区）。跨夜会自动加一天。",
    parameters: Type.Object({
      startTime: Type.Optional(Type.String({ description: "入睡 HH:mm" })),
      endTime: Type.Optional(Type.String({ description: "醒来 HH:mm" })),
      type: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("night")])),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      notes: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      let start = String(params.startTime ?? params.start_time ?? params.start ?? "").trim();
      let end = String(params.endTime ?? params.end_time ?? params.end ?? "").trim();
      
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();

      if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
        // Fallback for relative or duration-based sleep
        const duration = Number(params.durationMinutes ?? params.duration_minutes ?? params.duration ?? 60);
        const now = new Date();
        const endD = new Date(now);
        const startD = new Date(now.getTime() - duration * 60 * 1000);
        start = `${String(startD.getHours()).padStart(2, "0")}:${String(startD.getMinutes()).padStart(2, "0")}`;
        end = `${String(endD.getHours()).padStart(2, "0")}:${String(endD.getMinutes()).padStart(2, "0")}`;
      }

      const startIso = hhmmToIso(start, date);
      let endIso = hhmmToIso(end, date);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        endIso = new Date(new Date(endIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
      const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
      if (durationMs <= 0) fail("入睡与醒来时间不能相同");
      if (durationMs > 20 * 60 * 60 * 1000) fail("单次睡眠不能超过 20 小时");
      const record = await prisma.sleepRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          startTime: startIso,
          endTime: endIso,
          type: params.type === "night" ? "night" : "day",
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        },
      });
      return ok(`已记录睡眠 ${start}–${end}`, { id: record.id, recordId: record.id });
    },
  };

  const recordDiaper: AgentTool = {
    name: "record_diaper",
    label: "记录尿布",
    description: "记录一次换尿布。type: pee/poop/both。",
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: "pee, poop, both" })),
      poopColor: Type.Optional(Type.String({ description: "yellow, green, brown, other" })),
      poopConsistency: Type.Optional(Type.String({ description: "soft, watery, hard, seedy" })),
      notes: Type.Optional(Type.String()),
      timestamp: Type.Optional(Type.String({ description: "HH:mm 或 ISO 时间" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      let recordTimestamp = new Date().toISOString();
      const rawTime = params.timestamp ?? params.time;
      if (typeof rawTime === "string" && rawTime.trim()) {
        const trimmed = rawTime.trim();
        if (TIME_RE.test(trimmed)) {
          recordTimestamp = hhmmToIso(trimmed, getLocalDateStr());
        } else {
          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) recordTimestamp = parsed.toISOString();
        }
      }

      let typeStr = String(params.type ?? "both").toLowerCase();
      if (!["pee", "poop", "both"].includes(typeStr)) typeStr = "both";

      const poopColor = (params.poopColor ?? params.poop_color ?? params.color) as string | undefined;
      const poopConsistency = (params.poopConsistency ?? params.poop_consistency ?? params.texture ?? params.poop_texture ?? params.consistency) as string | undefined;

      const record = await prisma.diaperRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          timestamp: recordTimestamp,
          type: typeStr,
          poopColor: typeof poopColor === "string" ? poopColor : null,
          poopConsistency: typeof poopConsistency === "string" ? poopConsistency : null,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        },
      });
      return ok(`已记录尿布：${typeStr}`, { id: record.id, recordId: record.id });
    },
  };

  const recordGrowth: AgentTool = {
    name: "record_growth",
    label: "记录生长",
    description: "记录体重(kg)/身长(cm)/头围(cm)，至少一项。",
    parameters: Type.Object({
      weightKg: Type.Optional(Type.Number()),
      heightCm: Type.Optional(Type.Number()),
      headCircumferenceCm: Type.Optional(Type.Number()),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      notes: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const today = getLocalDateStr();
      if (date > addDays(today, 1)) fail("测量日期不能是未来");
      if (ctx.baby.birthDate && date < ctx.baby.birthDate) fail("测量日期不能早于出生日期");
      const weightKg = optionalNumber(params.weightKg, 0.5, 50, "体重kg");
      const heightCm = optionalNumber(params.heightCm, 20, 150, "身长cm");
      const headCircumferenceCm = optionalNumber(params.headCircumferenceCm, 20, 60, "头围cm");
      if (weightKg == null && heightCm == null && headCircumferenceCm == null) {
        fail("请至少提供体重、身长或头围一项");
      }
      const ageDetail = calculateAgeDetail(ctx.baby.birthDate, date);
      const gender = ctx.baby.gender || "female";
      let percentile: number | null = null;
      if (weightKg != null) percentile = estimatePercentile(gender, "weight", ageDetail.months, weightKg);
      else if (heightCm != null) percentile = estimatePercentile(gender, "height", ageDetail.months, heightCm);
      else if (headCircumferenceCm != null) {
        percentile = estimatePercentile(gender, "headCircumference", ageDetail.months, headCircumferenceCm);
      }
      const record = await prisma.growthMeasurement.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          date,
          ageInMonths: ageDetail.months,
          ageLabel: `${ageDetail.months}月${ageDetail.days}天`,
          weightKg,
          heightCm,
          headCircumferenceCm,
          percentile,
        },
      });
      return ok(
        `已记录生长 ${date}${weightKg != null ? ` 体重${weightKg}kg` : ""}${heightCm != null ? ` 身长${heightCm}cm` : ""}${headCircumferenceCm != null ? ` 头围${headCircumferenceCm}cm` : ""}${percentile != null ? ` 约P${percentile}` : ""}`,
        { id: record.id, percentile }
      );
    },
  };

  const getVaccineSchedule: AgentTool = {
    name: "get_vaccine_schedule",
    label: "疫苗计划",
    description: "查询当前月龄附近的疫苗接种日程（含一类/二类）。",
    parameters: Type.Object({}),
    execute: async () => {
      const ageMonths = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate).months : 0;
      const [entries, vaccines] = await Promise.all([
        prisma.vaccineScheduleEntry.findMany({
          where: { ageMonths: { lte: ageMonths + 2 } },
          orderBy: [{ ageMonths: "asc" }, { doseNumber: "asc" }],
          take: 40,
        }),
        prisma.vaccine.findMany({
          select: { id: true, vaccineId: true, name: true, shortName: true, programType: true },
        }),
      ]);
      const byUuid = new Map(vaccines.map((v) => [v.id, v]));
      const byCode = new Map(vaccines.map((v) => [v.vaccineId, v]));
      const upcoming = entries.map((e) => {
        const v = byUuid.get(e.vaccineId) || byCode.get(e.vaccineId);
        return {
          ageMonths: e.ageMonths,
          ageLabel: e.ageLabel,
          doseNumber: e.doseNumber,
          vaccineName: v?.shortName || v?.name || e.vaccineId,
          programType: v?.programType,
          isOptional: e.isOptional,
          notes: e.notes,
        };
      });
      return ok(JSON.stringify({ ageMonths, nearbyDoses: upcoming }, null, 2));
    },
  };

  const saveMedicalReport: AgentTool = {
    name: "save_medical_report",
    label: "保存化验单",
    description: "保存化验单/体检档案。category: blood/growth/trace_element/allergy/general。",
    parameters: Type.Object({
      title: Type.String(),
      category: Type.Union([
        Type.Literal("blood"),
        Type.Literal("growth"),
        Type.Literal("trace_element"),
        Type.Literal("allergy"),
        Type.Literal("general"),
      ]),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      hospital: Type.Optional(Type.String()),
      aiSummary: Type.Optional(Type.String()),
      items: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String(),
            value: Type.String(),
            unit: Type.Optional(Type.String()),
            referenceRange: Type.Optional(Type.String()),
            status: Type.Optional(
              Type.Union([
                Type.Literal("normal"),
                Type.Literal("high"),
                Type.Literal("low"),
                Type.Literal("abnormal"),
              ])
            ),
          })
        )
      ),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      if (ctx.baby.birthDate && date < ctx.baby.birthDate) fail("报告日期不能早于出生日期");
      const title = String(params.title || "").trim();
      if (!title) fail("请填写报告标题");
      const record = await prisma.medicalReport.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          title,
          category: String(params.category),
          date,
          hospital: typeof params.hospital === "string" ? params.hospital.trim() : null,
          aiSummary: typeof params.aiSummary === "string" ? params.aiSummary.trim() : null,
          itemsJson: JSON.stringify(Array.isArray(params.items) ? params.items : []),
        },
      });
      return ok(`已保存化验单「${title}」`, { id: record.id });
    },
  };

  const recordFood: AgentTool = {
    name: "record_food",
    label: "记录辅食",
    description:
      "记录一次辅食。foods 为食材名称数组（如 [\"高铁米粉\", \"胡萝卜泥\"]），portion: little(少量)/half(半碗)/most(大部分)/all(全部)，acceptance(喜欢程度 1-5)，babyState: happy(开心)/neutral(一般)/rejected(抗拒)，hasAbnormal(是否有过敏等异常)。",
    parameters: Type.Object({
      foods: Type.Array(Type.String({ description: "食材名称，如米粉、苹果泥、胡萝卜泥" })),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      time: Type.Optional(Type.String({ description: "HH:mm，如 12:30，默认当前时间" })),
      portion: Type.Optional(
        Type.Union([
          Type.Literal("little"),
          Type.Literal("half"),
          Type.Literal("most"),
          Type.Literal("all"),
        ])
      ),
      acceptance: Type.Optional(Type.Number({ description: "喜欢程度 1-5" })),
      babyState: Type.Optional(
        Type.Union([
          Type.Literal("happy"),
          Type.Literal("neutral"),
          Type.Literal("rejected"),
        ])
      ),
      hasAbnormal: Type.Optional(Type.Boolean({ description: "是否有过敏或不适等异常" })),
      abnormalNotes: Type.Optional(Type.String({ description: "异常情况或补充说明" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      let time =
        typeof params.time === "string" && TIME_RE.test(params.time.trim())
          ? params.time.trim()
          : new Date().toTimeString().slice(0, 5);

      let rawFoods = params.foods ?? params.food ?? params.foodName ?? params.food_name ?? params.name;
      let foods: string[] = [];
      if (Array.isArray(rawFoods)) {
        foods = rawFoods.map((f) => String(f || "").trim()).filter(Boolean);
      } else if (typeof rawFoods === "string" && rawFoods.trim()) {
        foods = rawFoods.split(/[,，、\s]+/).map((f) => f.trim()).filter(Boolean);
      }
      if (foods.length === 0) foods = ["辅食"];

      const portion = typeof params.portion === "string" ? params.portion : "most";
      const acceptance =
        typeof params.acceptance === "number"
          ? Math.min(5, Math.max(1, Math.round(params.acceptance)))
          : 3;
      const babyState = typeof params.babyState === "string" ? params.babyState : "happy";
      const hasAbnormal = Boolean(params.hasAbnormal);
      const abnormalNotes =
        typeof params.abnormalNotes === "string" ? params.abnormalNotes.trim() : null;

      const record = await prisma.foodLogRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          date,
          time,
          foods: JSON.stringify(foods),
          portion,
          acceptance,
          babyState,
          hasAbnormal,
          abnormalNotes,
        },
      });

      return ok(`已记录辅食：${foods.join("、")}（${date} ${time}）`, {
        id: record.id,
        recordId: record.id,
        foods,
        date,
        time,
      });
    },
  };

  const getRecentRecords: AgentTool = {
    name: "get_recent_records",
    label: "查询记录明细",
    description: "查询宝宝今日或近期的具体活动时间轴记录（吃奶明细、睡眠开始/结束时间、换尿布/排便记录、辅食明细）。",
    parameters: Type.Object({
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      type: Type.Optional(
        Type.Union([
          Type.Literal("all"),
          Type.Literal("feeding"),
          Type.Literal("sleep"),
          Type.Literal("diaper"),
          Type.Literal("food"),
        ])
      ),
      limit: Type.Optional(Type.Number({ description: "返回条数限制，默认 20" })),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const type = typeof params.type === "string" ? params.type : "all";
      const limit = typeof params.limit === "number" ? Math.min(50, Math.max(1, params.limit)) : 20;

      const { start, end } = getLocalDayUtcRange(date);

      const [feedings, sleeps, diapers, foods] = await Promise.all([
        type === "all" || type === "feeding"
          ? prisma.feedingRecord.findMany({
              where: { babyId, timestamp: { gte: start, lt: end } },
              orderBy: { timestamp: "desc" },
              take: limit,
            })
          : [],
        type === "all" || type === "sleep"
          ? prisma.sleepRecord.findMany({
              where: { babyId, startTime: { lt: end }, endTime: { gt: start } },
              orderBy: { startTime: "desc" },
              take: limit,
            })
          : [],
        type === "all" || type === "diaper"
          ? prisma.diaperRecord.findMany({
              where: { babyId, timestamp: { gte: start, lt: end } },
              orderBy: { timestamp: "desc" },
              take: limit,
            })
          : [],
        type === "all" || type === "food"
          ? prisma.foodLogRecord.findMany({
              where: { babyId, date },
              orderBy: { time: "desc" },
              take: limit,
            })
          : [],
      ]);

      const items: Array<{ type: string; time: string; summary: string; detail: unknown }> = [];

      for (const f of feedings) {
        const time = new Date(f.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const typeLabel = f.type === "breast" ? "母乳亲喂" : f.type === "formula" ? "配方奶" : "母乳瓶喂";
        const amountStr = f.amountMl ? `${f.amountMl}ml` : f.leftMinutes || f.rightMinutes ? `左${f.leftMinutes || 0}分/右${f.rightMinutes || 0}分` : "";
        items.push({
          type: "feeding",
          time,
          summary: `${typeLabel} ${amountStr}${f.spitUp ? " (有吐奶)" : ""}`,
          detail: f,
        });
      }

      for (const s of sleeps) {
        const startT = new Date(s.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const endT = new Date(s.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const durationMin = Math.round((new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000);
        items.push({
          type: "sleep",
          time: startT,
          summary: `${s.type === "night" ? "夜间睡眠" : "白天小睡"} ${startT} - ${endT} (共${durationMin}分钟)${s.nightWakingCount > 0 ? ` 夜醒${s.nightWakingCount}次` : ""}`,
          detail: s,
        });
      }

      for (const d of diapers) {
        const time = new Date(d.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const typeLabel = d.type === "pee" ? "仅嘘嘘" : d.type === "poop" ? "大便" : "嘘嘘+大便";
        const poopStr = d.poopColor || d.poopConsistency ? ` (${[d.poopColor, d.poopConsistency].filter(Boolean).join("/")})` : "";
        items.push({
          type: "diaper",
          time,
          summary: `换尿布: ${typeLabel}${poopStr}`,
          detail: d,
        });
      }

      for (const fd of foods) {
        let foodNames = "辅食";
        try {
          const parsed = JSON.parse(fd.foods);
          if (Array.isArray(parsed)) foodNames = parsed.join("、");
        } catch {}
        items.push({
          type: "food",
          time: fd.time,
          summary: `辅食: ${foodNames} (食量:${fd.portion}, 喜欢度:${fd.acceptance}星)${fd.hasAbnormal ? " ⚠️有异常" : ""}`,
          detail: fd,
        });
      }

      items.sort((a, b) => b.time.localeCompare(a.time));

      return ok(
        items.length === 0
          ? `${date} 暂无${type === "all" ? "" : type}相关记录。`
          : JSON.stringify({ date, totalCount: items.length, records: items.slice(0, limit) }, null, 2)
      );
    },
  };

  const queryFoodItem: AgentTool = {
    name: "query_food_item",
    label: "查询食材库",
    description: "从宝宝食材库中查询某食材的适宜月龄、防噎处理方法、过敏原指引与营养搭配要点。",
    parameters: Type.Object({
      name: Type.String({ description: "食材名称，如'牛油果'、'鸡蛋'、'南瓜'、'草莓'等" }),
    }),
    execute: async (_id, raw) => {
      const { name } = raw as { name: string };
      const trimmed = (name || "").trim();
      if (!trimmed) fail("请输入要查询的食材名称");

      const items = await prisma.foodItem.findMany({
        where: {
          OR: [
            { name: { contains: trimmed } },
            { foodGroup: { contains: trimmed } },
            { category: { contains: trimmed } },
          ],
        },
        take: 5,
      });

      if (items.length === 0) {
        return ok(`食材库中未查到关于「${trimmed}」的条目，请结合通用月龄防噎与过敏排查指南为家长解答。`);
      }

      const results = items.map((item) => {
        let prep = [];
        let nutrients = [];
        try { prep = JSON.parse(item.preparationJson || "[]"); } catch {}
        try { nutrients = JSON.parse(item.nutritionJson || "[]"); } catch {}
        return {
          name: item.name,
          icon: item.icon,
          category: item.category,
          recommendedFromMonth: item.recommendedFromMonth ? `${item.recommendedFromMonth}月龄+` : "无特定限制",
          avoidBeforeMonths: item.avoidBeforeMonths ? `${item.avoidBeforeMonths}月前避免` : null,
          chokingRisk: item.chokingRisk ? `⚠️ 有防噎风险: ${item.chokingNotes || "需妥善切分加工"}` : "低风险",
          isCommonAllergen: item.isCommonAllergen ? `⚠️ 常见过敏原: ${item.allergenIntroductionGuidance || "建议初次微量单独引入，观察3天"}` : "非高危过敏原",
          guidance: item.guidance,
          preparation: prep,
          nutrition: nutrients,
        };
      });

      return ok(JSON.stringify(results, null, 2));
    },
  };

  const recordFoodPlan: AgentTool = {
    name: "record_food_plan",
    label: "制定辅食计划",
    description: "为宝宝保存一日辅食计划食谱（包含餐点名称、主要食材、制作步骤与营养要点）。",
    parameters: Type.Object({
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天或明天" })),
      name: Type.String({ description: "食谱/餐点名称，如'高铁牛肉胡萝卜米糊'" }),
      ingredients: Type.Array(Type.String({ description: "食材列表，如['牛肉末 15g', '胡萝卜 20g', '强化铁米粉 20g']" })),
      steps: Type.Array(Type.String({ description: "制作步骤，如['胡萝卜蒸熟压泥', '牛肉煮熟搅打细腻', '温水调米粉后混合']" })),
      nutrition: Type.String({ description: "营养要点，如'富含血红素铁与β-胡萝卜素，促进铁吸收'" }),
      tags: Type.Optional(Type.Array(Type.String({ description: "标签，如['高铁', '易吞咽', '过敏低敏']" }))),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
      const name = String(params.name || "").trim() || "辅食餐点";
      const ingredients = Array.isArray(params.ingredients) ? params.ingredients : [];
      const steps = Array.isArray(params.steps) ? params.steps : [];
      const nutrition = String(params.nutrition || "营养均衡，适合当前月龄");
      const tags = Array.isArray(params.tags) ? params.tags : ["营养辅食"];

      const plan = await prisma.foodPlan.create({
        data: {
          babyId,
          date,
          name,
          ingredients: JSON.stringify(ingredients),
          steps: JSON.stringify(steps),
          nutrition,
          tags: JSON.stringify(tags),
        },
      });

      return ok(`已成功保存【${date}】辅食计划食谱「${name}」✨`, {
        id: plan.id,
        date,
        name,
      });
    },
  };

  const getDevelopmentMilestones: AgentTool = {
    name: "get_development_milestones",
    label: "查询发育里程碑",
    description: "查询指定月龄或领域的国家卫健委儿童发育里程碑（大运动、精细动作、语言、认知、社交）。",
    parameters: Type.Object({
      month: Type.Optional(Type.Number({ description: "评估月龄（1-36），默认当前月龄" })),
      category: Type.Optional(
        Type.Union([
          Type.Literal("gross_motor"),
          Type.Literal("fine_motor"),
          Type.Literal("language"),
          Type.Literal("cognitive"),
          Type.Literal("social_emotional"),
        ])
      ),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const ageInfo = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate) : null;
      const month = typeof params.month === "number" ? Math.max(1, Math.min(36, params.month)) : ageInfo?.months || 6;
      const category = typeof params.category === "string" ? params.category : undefined;

      const milestones = await prisma.developmentMilestone.findMany({
        where: {
          assessmentAgeMonths: month,
          ...(category ? { category } : {}),
        },
        take: 15,
      });

      if (milestones.length === 0) {
        return ok(`第 ${month} 个月暂无特定里程碑条目，可参考相邻月龄指标。`);
      }

      const formatted = milestones.map((m) => ({
        category: m.category,
        title: m.title,
        description: m.description,
        observationMethod: m.observationMethod,
      }));

      return ok(JSON.stringify({ assessmentMonth: month, milestones: formatted }, null, 2));
    },
  };

  const getWarningSigns: AgentTool = {
    name: "get_warning_signs",
    label: "查询发育预警红线",
    description: "查询指定月龄的发育迟缓预警信号与就医指征（如抬头/独坐/抓握/互动异常）。",
    parameters: Type.Object({
      month: Type.Optional(Type.Number({ description: "月龄（1-36），默认当前月龄" })),
      category: Type.Optional(Type.String({ description: "领域分类" })),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const ageInfo = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate) : null;
      const month = typeof params.month === "number" ? Math.max(1, Math.min(36, params.month)) : ageInfo?.months || 6;

      const signs = await prisma.developmentWarningSign.findMany({
        where: {
          ageMonths: { lte: month },
          ...(params.category ? { category: String(params.category) } : {}),
        },
        orderBy: { ageMonths: "desc" },
        take: 10,
      });

      if (signs.length === 0) {
        return ok(`当前月龄暂无明显预警信号条目。如有持续异常表现，请结合儿科医生临床查体。`);
      }

      const formatted = signs.map((s) => ({
        ageMonths: `${s.ageMonths}月龄预警`,
        category: s.category,
        description: s.description,
        recommendedAction: s.recommendedAction,
        urgency: s.urgency,
      }));

      return ok(JSON.stringify({ month, warningSigns: formatted }, null, 2));
    },
  };

  const recordVaccine: AgentTool = {
    name: "record_vaccine",
    label: "记录疫苗接种",
    description: "记录宝宝已接种的疫苗剂次（如'乙肝疫苗第2剂'、'五联疫苗第1剂'）。",
    parameters: Type.Object({
      name: Type.String({ description: "疫苗名称，如'乙肝疫苗'、'五联疫苗'、'脊灰灭活疫苗'" }),
      dose: Type.String({ description: "剂次，如'第1剂'、'第2剂'" }),
      completedDate: Type.Optional(Type.String({ description: "YYYY-MM-DD 接种日期，默认今天" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const name = String(params.name || "").trim();
      const dose = String(params.dose || "").trim() || "第1剂";
      const completedDate =
        typeof params.completedDate === "string" && isValidDateStr(params.completedDate)
          ? params.completedDate
          : getLocalDateStr();

      if (!name) fail("请输入疫苗名称");

      const record = await prisma.vaccineRecord.create({
        data: {
          babyId,
          name,
          dose,
          scheduledDate: completedDate,
          completedDate,
          isCompleted: true,
          countdownDays: 0,
        },
      });

      return ok(`已记录【${name} ${dose}】于 ${completedDate} 完成接种 💉✨`, {
        id: record.id,
        name,
        dose,
        completedDate,
      });
    },
  };

  const getRecommendedBooks: AgentTool = {
    name: "get_recommended_books",
    label: "精选绘本推荐",
    description: "查询精选绘本馆中适合当前宝宝月龄的绘本、评分、适读要点及亲子共读互动建议。",
    parameters: Type.Object({
      tag: Type.Optional(Type.String({ description: "主题标签或关键词，如'动物'、'习惯'、'认知'、'触觉'等" })),
      month: Type.Optional(Type.Number({ description: "适读月龄，默认当前月龄" })),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const ageInfo = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate) : null;
      const month = typeof params.month === "number" ? params.month : ageInfo?.months || 6;
      const tag = typeof params.tag === "string" ? params.tag.trim() : "";

      const books = await prisma.book.findMany({
        where: {
          ...(tag ? { OR: [{ title: { contains: tag } }, { description: { contains: tag } }, { categoriesJson: { contains: tag } }] } : {}),
        },
        take: 6,
      });

      if (books.length === 0) {
        return ok(`绘本馆暂未查到特定绘本，可根据月龄（${month}个月）选择黑白卡、布书、洞洞书、触摸书或简单拟声词绘本。`);
      }

      const formatted = books.map((b) => {
        let authors = [];
        let suggestions = [];
        try { authors = JSON.parse(b.authorJson || "[]"); } catch {}
        try { suggestions = JSON.parse(b.interactionSuggestionsJson || "[]"); } catch {}
        return {
          title: b.title,
          author: authors.join("、"),
          ageRange: `${b.ageMinMonths || 0}-${b.ageMaxMonths || 36}月`,
          ratingScore: b.ratingScore,
          description: b.description,
          whyAgeAppropriate: b.whyAgeAppropriate,
          interactionSuggestions: suggestions,
        };
      });

      return ok(JSON.stringify(formatted, null, 2));
    },
  };

  const getActivityRecommendations: AgentTool = {
    name: "get_activity_recommendations",
    label: "早教互动游戏推荐",
    description: "查询适合当前宝宝月龄的家庭早教与亲子互动游戏、安全指引与发展目标。",
    parameters: Type.Object({
      month: Type.Optional(Type.Number({ description: "月龄，默认当前月龄" })),
      category: Type.Optional(Type.String({ description: "领域，如'大运动'、'精细动作'、'语言'、'感官'" })),
    }),
    execute: async (_id, raw) => {
      const params = raw as Params;
      const ageInfo = ctx.baby.birthDate ? calculateAgeDetail(ctx.baby.birthDate) : null;
      const month = typeof params.month === "number" ? params.month : ageInfo?.months || 6;

      const activities = await prisma.activityRecommendation.findMany({
        where: {
          targetMonthMin: { lte: month },
          targetMonthMax: { gte: month },
        },
        take: 5,
      });

      if (activities.length === 0) {
        return ok(`当前月龄（${month}月）可进行亲子对视抚触、躲猫猫（Peekaboo）、俯卧抬头抓握练习等基础早教互动。`);
      }

      const formatted = activities.map((a) => {
        let steps = [];
        let safety = [];
        try { steps = JSON.parse(a.stepsJson || "[]"); } catch {}
        try { safety = JSON.parse(a.safetyJson || "[]"); } catch {}
        return {
          title: a.title,
          goal: a.goal,
          duration: a.durationMinutes ? `${a.durationMinutes}分钟` : "5-10分钟",
          steps,
          safety,
        };
      });

      return ok(JSON.stringify(formatted, null, 2));
    },
  };

  const webSearch: AgentTool = {
    name: "web_search",
    label: "联网搜索",
    description:
      "通过互联网实时搜索最新的育儿科普、儿科临床指南、权威医学建议、药品说明、疫苗接种政策或特定辅食品牌做法。当家长询问最新权威医学常识、特定品牌/症状细节或本地库未涵盖的内容时使用。",
    parameters: Type.Object({
      query: Type.String({
        description: "搜索关键词，支持中文。例如：'婴儿发烧38.5退热贴'、'13价肺炎疫苗接种禁忌'、'辅食油怎么选'等",
      }),
      limit: Type.Optional(Type.Number({ description: "返回结果条数（1-8，默认 5）" })),
    }),
    execute: async (_id, raw) => {
      const { query, limit } = raw as { query: string; limit?: number };
      const trimmed = (query || "").trim();
      if (!trimmed) fail("请输入要搜索的关键词");

      try {
        const results = await performWebSearch(trimmed, limit || 5);
        if (results.length === 0) {
          return ok(`未检索到与「${trimmed}」直接相关的网页结果，请根据专业儿科知识为家长解答。`);
        }
        return ok(JSON.stringify({ query: trimmed, totalResults: results.length, results }, null, 2));
      } catch (err: any) {
        return ok(`联网搜索暂时不可用（${err?.message || "网络波动"}），请结合既有专业医学知识解答。`);
      }
    },
  };

  return [
    getBabyProfile,
    getDailySummary,
    getRecentRecords,
    recordFeeding,
    recordFood,
    recordFoodPlan,
    recordSleep,
    recordDiaper,
    recordGrowth,
    recordVaccine,
    queryFoodItem,
    getVaccineSchedule,
    getDevelopmentMilestones,
    getWarningSigns,
    getRecommendedBooks,
    getActivityRecommendations,
    webSearch,
    saveMedicalReport,
  ];
}
