import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr } from "@/lib/date";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { TIME_RE, hhmmToIso, optionalNumber, ok, type Params } from "./helpers";

export function makeRecordFeedingTool(ctx: { userId: string; baby: Baby }): AgentTool {
  return {
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
      const amountMl = optionalNumber(params.amountMl ?? (params as any).amount_ml ?? (params as any).amount ?? (params as any).ml, 0, 3000, "amountMl");
      let leftMinutes = optionalNumber(params.leftMinutes ?? (params as any).left_minutes, 0, 180, "leftMinutes");
      const rightMinutes = optionalNumber(params.rightMinutes ?? (params as any).right_minutes, 0, 180, "rightMinutes");
      if (leftMinutes == null && (typeof params.durationMinutes === "number" || typeof (params as any).duration_minutes === "number")) {
        leftMinutes = optionalNumber((params as any).durationMinutes ?? (params as any).duration_minutes, 0, 180, "durationMinutes");
      }
      let recordTimestamp: string | undefined;
      const rawTime = (params.timestamp ?? (params as any).time ?? (params as any).startTime ?? (params as any).start_time) as unknown;
      if (typeof rawTime === "string" && rawTime.trim()) {
        const trimmed = rawTime.trim();
        if (TIME_RE.test(trimmed)) {
          recordTimestamp = hhmmToIso(trimmed, getLocalDateStr());
        } else {
          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) recordTimestamp = parsed.toISOString();
        }
      }
      let typeStr = String((params.type ?? "formula") as string).toLowerCase();
      if (typeStr === "bottle" || typeStr === "milk" || typeStr === "formula_milk") typeStr = "formula";
      if (typeStr === "breast_milk" || typeStr === "bottle_breast_milk") typeStr = "bottle_breast";
      if (!["breast", "formula", "bottle_breast", "mixed"].includes(typeStr)) typeStr = "formula";

      const record = await records.createFeeding(
        { userId: ctx.userId, babyId: ctx.baby.id, baby: ctx.baby },
        {
          type: typeStr,
          amountMl,
          leftMinutes,
          rightMinutes,
          spitUp: false,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
          timestamp: recordTimestamp,
        }
      );
      return ok(`已记录喂养：${typeStr}${amountMl != null ? ` ${amountMl}ml` : ""}`, { id: (record as any).id, recordId: (record as any).id });
    },
  };
}
