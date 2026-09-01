import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr, getLocalTimeStr, isValidDateStr } from "@/lib/date";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { TIME_RE, hhmmToIso, ok, fail, type Params } from "./helpers";

export function makeRecordSleepTool(ctx: { userId: string; baby: Baby }): AgentTool {
  return {
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
      let start = String((params.startTime ?? (params as any).start_time ?? (params as any).start ?? "") as string).trim();
      let end = String((params.endTime ?? (params as any).end_time ?? (params as any).end ?? "") as string).trim();
      const hasExplicitTime = TIME_RE.test(start) && TIME_RE.test(end);
      const hasDuration = typeof (params as any).durationMinutes === "number" || typeof (params as any).duration_minutes === "number" || typeof (params as any).duration === "number";

      if (!hasExplicitTime && !hasDuration && !params.notes) {
        fail("睡眠记录缺少具体入睡与醒来时间（或睡眠时长），请先向家长追问确认后再记录");
      }

      if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
        const duration = Number((params as any).durationMinutes ?? (params as any).duration_minutes ?? (params as any).duration ?? 60);
        const now = new Date();
        const startD = new Date(now.getTime() - duration * 60 * 1000);
        start = getLocalTimeStr(startD);
        end = getLocalTimeStr(now);
      }
      const date = typeof params.date === "string" && isValidDateStr(params.date) ? params.date : getLocalDateStr();
      const startIso = hhmmToIso(start, date);
      let endIso = hhmmToIso(end, date);
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        endIso = new Date(new Date(endIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
      }
      const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime();
      if (durationMs <= 0) fail("入睡与醒来时间不能相同");
      if (durationMs > 20 * 60 * 60 * 1000) fail("单次睡眠不能超过 20 小时");
      const record = await records.createSleep(
        { userId: ctx.userId, babyId: ctx.baby.id, baby: ctx.baby },
        {
          startTime: startIso,
          endTime: endIso,
          type: (params.type as string) === "night" ? "night" : "day",
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
          date,
        }
      );
      return ok(`已记录睡眠 ${start}–${end}`, { id: (record as any).id, recordId: (record as any).id });
    },
  };
}
