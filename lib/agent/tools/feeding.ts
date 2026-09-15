import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { toGrowDeskFeedingCreatePayload } from "@/lib/growdesk/feeding-compat";
import { resolveFormulaProductId } from "@/lib/mcp/server";
import { TIME_RE, hhmmToIso, optionalNumber, ok, fail, type Params } from "./helpers";

export function makeRecordFeedingTool(ctx: {
  userId: string;
  baby: Baby;
  accessToken?: string;
  familyId?: string;
}): AgentTool {
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
      formulaName: Type.Optional(Type.String({ description: "配方奶粉名称或品牌，如'爱他美'、'飞鹤'" })),
      formulaProductId: Type.Optional(Type.String({ description: "指定的奶粉档案 ID" })),
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

      if (amountMl == null && leftMinutes == null && rightMinutes == null && !params.notes) {
        fail("喂养记录缺少关键数据（奶量 ml 或亲喂时长分钟），请先向家长追问确认具体数值后再记录");
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

      // Match formula product if formula / mixed
      let matchedFormulaId: string | undefined = typeof params.formulaProductId === "string" ? params.formulaProductId : undefined;

      if (GROWDESK_CONFIG.enabled) {
        const famId = ctx.familyId || ctx.baby.familyId;
        const resolved = await resolveFormulaProductId(
          famId,
          typeStr,
          params.formulaProductId as string,
          params.formulaName as string,
          ctx.accessToken
        );
        if (resolved) matchedFormulaId = resolved;

        const payload = toGrowDeskFeedingCreatePayload({
          babyId: ctx.baby.id,
          type: typeStr,
          amountMl,
          leftMinutes,
          rightMinutes,
          spitUp: false,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
          timestamp: recordTimestamp,
          formulaProductId: matchedFormulaId,
        });

        let newId = `feeding_${Date.now()}`;
        if (ctx.accessToken) {
          try {
            const res = await growdeskFetch<{ id: string }>(
              `/api/v1/babies/${ctx.baby.id}/records/feeding`,
              {
                method: "POST",
                accessToken: ctx.accessToken,
                body: payload,
              }
            );
            if (res.data?.id) newId = res.data.id;
          } catch {}
        }

        return ok(`已记录喂养：${typeStr}${amountMl != null ? ` ${amountMl}ml` : ""}`, {
          id: newId,
          recordId: newId,
        });
      }

      if (!matchedFormulaId && (typeStr === "formula" || typeStr === "mixed") && typeof params.formulaName === "string" && params.formulaName.trim()) {
        const formulaName = params.formulaName.trim();
        const f = await prisma.formulaProduct.findFirst({
          where: {
            familyId: ctx.baby.familyId,
            isActive: true,
            OR: [
              { name: { contains: formulaName } },
              { brand: { contains: formulaName } },
            ],
          },
        });
        if (f) matchedFormulaId = f.id;
      }
      if (!matchedFormulaId && (typeStr === "formula" || typeStr === "mixed")) {
        // Use active default formula
        const activeF = await prisma.formulaProduct.findFirst({
          where: { familyId: ctx.baby.familyId, isActive: true },
        });
        if (activeF) matchedFormulaId = activeF.id;
      }

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
          formulaProductId: matchedFormulaId,
        }
      );
      return ok(`已记录喂养：${typeStr}${amountMl != null ? ` ${amountMl}ml` : ""}`, { id: (record as any).id, recordId: (record as any).id });
    },
  };
}
