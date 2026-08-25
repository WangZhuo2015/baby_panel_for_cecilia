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
      type: Type.Union([
        Type.Literal("breast"),
        Type.Literal("formula"),
        Type.Literal("bottle_breast"),
        Type.Literal("mixed"),
      ]),
      amountMl: Type.Optional(Type.Number({ description: "奶量毫升" })),
      durationMinutes: Type.Optional(Type.Number({ description: "喂养时长分钟" })),
      leftMinutes: Type.Optional(Type.Number({ description: "左侧亲喂分钟" })),
      rightMinutes: Type.Optional(Type.Number({ description: "右侧亲喂分钟" })),
      notes: Type.Optional(Type.String()),
      timestamp: Type.Optional(Type.String({ description: "ISO 时间，默认现在" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const amountMl = optionalNumber(params.amountMl, 0, 3000, "amountMl");
      let leftMinutes = optionalNumber(params.leftMinutes, 0, 180, "leftMinutes");
      const rightMinutes = optionalNumber(params.rightMinutes, 0, 180, "rightMinutes");
      if (leftMinutes == null && typeof params.durationMinutes === "number") {
        leftMinutes = optionalNumber(params.durationMinutes, 0, 180, "durationMinutes");
      }
      let recordTimestamp = new Date().toISOString();
      if (typeof params.timestamp === "string" && params.timestamp.trim()) {
        const parsed = new Date(params.timestamp);
        if (Number.isNaN(parsed.getTime())) fail("timestamp 格式无效");
        recordTimestamp = parsed.toISOString();
      }
      const record = await prisma.feedingRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          timestamp: recordTimestamp,
          type: String(params.type),
          amountMl,
          leftMinutes,
          rightMinutes,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        },
      });
      return ok(`已记录喂养：${params.type}${amountMl != null ? ` ${amountMl}ml` : ""}`, { id: record.id });
    },
  };

  const recordSleep: AgentTool = {
    name: "record_sleep",
    label: "记录睡眠",
    description: "记录一次睡眠。startTime/endTime 为 HH:mm（上海时区）。跨夜会自动加一天。",
    parameters: Type.Object({
      startTime: Type.String({ description: "入睡 HH:mm" }),
      endTime: Type.String({ description: "醒来 HH:mm" }),
      type: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("night")])),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      notes: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const start = String(params.startTime || "").trim();
      const end = String(params.endTime || "").trim();
      if (!TIME_RE.test(start) || !TIME_RE.test(end)) fail("时间须为 HH:mm，如 14:00");
      const date =
        typeof params.date === "string" && isValidDateStr(params.date)
          ? params.date
          : getLocalDateStr();
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
      return ok(`已记录睡眠 ${start}–${end}`, { id: record.id });
    },
  };

  const recordDiaper: AgentTool = {
    name: "record_diaper",
    label: "记录尿布",
    description: "记录一次换尿布。type: pee/poop/both。",
    parameters: Type.Object({
      type: Type.Union([Type.Literal("pee"), Type.Literal("poop"), Type.Literal("both")]),
      poopColor: Type.Optional(
        Type.Union([
          Type.Literal("yellow"),
          Type.Literal("green"),
          Type.Literal("brown"),
          Type.Literal("other"),
        ])
      ),
      poopConsistency: Type.Optional(
        Type.Union([
          Type.Literal("soft"),
          Type.Literal("watery"),
          Type.Literal("hard"),
          Type.Literal("seedy"),
        ])
      ),
      notes: Type.Optional(Type.String()),
      timestamp: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      let recordTimestamp = new Date().toISOString();
      if (typeof params.timestamp === "string" && params.timestamp.trim()) {
        const parsed = new Date(params.timestamp);
        if (Number.isNaN(parsed.getTime())) fail("timestamp 格式无效");
        recordTimestamp = parsed.toISOString();
      }
      const record = await prisma.diaperRecord.create({
        data: {
          babyId,
          recordedById: ctx.userId,
          timestamp: recordTimestamp,
          type: String(params.type),
          poopColor: typeof params.poopColor === "string" ? params.poopColor : null,
          poopConsistency: typeof params.poopConsistency === "string" ? params.poopConsistency : null,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        },
      });
      return ok(`已记录尿布：${params.type}`, { id: record.id });
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

  return [
    getBabyProfile,
    getDailySummary,
    recordFeeding,
    recordSleep,
    recordDiaper,
    recordGrowth,
    getVaccineSchedule,
    saveMedicalReport,
  ];
}
