import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr } from "@/lib/date";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { TIME_RE, hhmmToIso, ok, type Params } from "./helpers";

export function makeRecordDiaperTool(ctx: { userId: string; baby: Baby }): AgentTool {
  return {
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
      let recordTimestamp: string | undefined;
      const rawTime = (params.timestamp ?? (params as any).time) as unknown;
      if (typeof rawTime === "string" && rawTime.trim()) {
        const trimmed = rawTime.trim();
        if (TIME_RE.test(trimmed)) recordTimestamp = hhmmToIso(trimmed, getLocalDateStr());
        else {
          const parsed = new Date(trimmed);
          if (!Number.isNaN(parsed.getTime())) recordTimestamp = parsed.toISOString();
        }
      }
      let typeStr = String((params.type ?? "both") as string).toLowerCase();
      if (!["pee", "poop", "both"].includes(typeStr)) typeStr = "both";
      const poopColor = ((params as any).poopColor ?? (params as any).poop_color ?? (params as any).color) as string | undefined;
      const poopConsistency = ((params as any).poopConsistency ?? (params as any).poop_consistency ?? (params as any).texture ?? (params as any).poop_texture ?? (params as any).consistency) as string | undefined;
      const record = await records.createDiaper(
        { userId: ctx.userId, babyId: ctx.baby.id, baby: ctx.baby },
        {
          type: typeStr,
          poopColor: typeof poopColor === "string" ? poopColor : null,
          poopConsistency: typeof poopConsistency === "string" ? poopConsistency : null,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
          timestamp: recordTimestamp,
        }
      );
      return ok(`已记录尿布：${typeStr}`, { id: (record as any).id, recordId: (record as any).id });
    },
  };
}
