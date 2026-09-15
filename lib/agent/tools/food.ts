import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr, getLocalTimeStr, isValidDateStr } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { toGrowDeskFoodCreatePayload } from "@/lib/growdesk/food-compat";
import { TIME_RE, ok, fail, type Params } from "./helpers";

export function makeRecordFoodTool(ctx: {
  userId: string;
  baby: Baby;
  accessToken?: string;
  familyId?: string;
}): AgentTool {
  return {
    name: "record_food",
    label: "记录辅食",
    description: "记录一次辅食。foods 为食材名称数组（如 [\"高铁米粉\", \"胡萝卜泥\"]），portion: little(少量)/half(半碗)/most(大部分)/all(全部)，acceptance(喜欢程度 1-5)，babyState: happy(开心)/neutral(一般)/rejected(抗拒)，hasAbnormal(是否有过敏等异常)。",
    parameters: Type.Object({
      foods: Type.Array(Type.String({ description: "食材名称，如米粉、苹果泥、胡萝卜泥" })),
      date: Type.Optional(Type.String({ description: "YYYY-MM-DD，默认今天" })),
      time: Type.Optional(Type.String({ description: "HH:mm，如 12:30，默认当前时间" })),
      portion: Type.Optional(Type.Union([Type.Literal("little"), Type.Literal("half"), Type.Literal("most"), Type.Literal("all")])),
      acceptance: Type.Optional(Type.Number({ description: "喜欢程度 1-5" })),
      babyState: Type.Optional(Type.Union([Type.Literal("happy"), Type.Literal("neutral"), Type.Literal("rejected")])),
      hasAbnormal: Type.Optional(Type.Boolean({ description: "是否有过敏或不适等异常" })),
      abnormalNotes: Type.Optional(Type.String({ description: "异常情况或补充说明" })),
    }),
    executionMode: "sequential",
    execute: async (_id, raw) => {
      const params = raw as Params;
      const date = typeof params.date === "string" && isValidDateStr(params.date) ? params.date : getLocalDateStr();
      let time = typeof (params as any).time === "string" && TIME_RE.test((params as any).time.trim()) ? (params as any).time.trim() : getLocalTimeStr();
      let rawFoods = (params as any).foods ?? (params as any).food ?? (params as any).foodName ?? (params as any).food_name ?? (params as any).name;
      let foods: string[] = [];
      if (Array.isArray(rawFoods)) foods = (rawFoods as unknown[]).map((f) => String(f || "").trim().slice(0, 20)).filter(Boolean).slice(0, 8) as string[];
      else if (typeof rawFoods === "string" && rawFoods.trim()) foods = rawFoods.split(/[,，、\s]+/).map((f) => f.trim().slice(0, 20)).filter(Boolean).slice(0, 8);
      if (foods.length === 0 || (foods.length === 1 && ["辅食", "吃辅食", "辅食餐点", "食物", "开饭"].includes(foods[0]))) {
        fail("辅食记录缺少具体食材名称（如高铁米粉、胡萝卜泥等），请先向家长追问吃了什么食材后再记录");
      }

      if (GROWDESK_CONFIG.enabled) {
        const payload = toGrowDeskFoodCreatePayload({
          babyId: ctx.baby.id,
          foods,
          date,
          time,
          portion: typeof (params as any).portion === "string" ? (params as any).portion : "most",
          acceptance: typeof (params as any).acceptance === "number" ? Math.round((params as any).acceptance) : 3,
          babyState: typeof (params as any).babyState === "string" ? (params as any).babyState : "happy",
          hasAbnormal: Boolean((params as any).hasAbnormal),
          abnormalNotes: typeof (params as any).abnormalNotes === "string" ? (params as any).abnormalNotes : null,
        });

        let newId = `food_${Date.now()}`;
        if (ctx.accessToken) {
          try {
            const res = await growdeskFetch<{ id: string }>(
              `/api/v1/babies/${ctx.baby.id}/records/food`,
              {
                method: "POST",
                accessToken: ctx.accessToken,
                body: payload,
              }
            );
            if (res.data?.id) newId = res.data.id;
          } catch {}
        }
        return ok(`已记录辅食：${foods.join("、")}（${date} ${time}）`, {
          id: newId,
          recordId: newId,
          foods,
          date,
          time,
        });
      }

      const record = await records.createFoodLog(
        { userId: ctx.userId, babyId: ctx.baby.id, baby: ctx.baby },
        {
          date,
          time,
          foods,
          portion: typeof (params as any).portion === "string" ? (params as any).portion : "most",
          acceptance: typeof (params as any).acceptance === "number" ? Math.round((params as any).acceptance) : 3,
          babyState: typeof (params as any).babyState === "string" ? (params as any).babyState : "happy",
          hasAbnormal: Boolean((params as any).hasAbnormal),
          abnormalNotes: typeof (params as any).abnormalNotes === "string" ? (params as any).abnormalNotes : null,
        }
      );
      return ok(`已记录辅食：${foods.join("、")}（${date} ${time}）`, { id: (record as any).id, recordId: (record as any).id, foods, date, time });
    },
  };
}

export function makeRecordFoodPlanTool(ctx: {
  userId: string;
  baby: Baby;
  accessToken?: string;
  familyId?: string;
}): AgentTool {
  return {
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
      const date = typeof (params as any).date === "string" && isValidDateStr((params as any).date) ? (params as any).date : getLocalDateStr();
      const name = String((params as any).name || "").trim().slice(0, 100) || "辅食餐点";
      const ingredients = Array.isArray((params as any).ingredients) ? (params as any).ingredients.map((s: unknown) => String(s).slice(0, 50)).slice(0, 10) : [];
      const steps = Array.isArray((params as any).steps) ? (params as any).steps.map((s: unknown) => String(s).slice(0, 200)).slice(0, 10) : [];
      const nutrition = String((params as any).nutrition || "营养均衡，适合当前月龄").slice(0, 500);
      const tags = Array.isArray((params as any).tags) ? (params as any).tags.map((s: unknown) => String(s).slice(0, 20)).slice(0, 10) : ["营养辅食"];

      if (GROWDESK_CONFIG.enabled) {
        let planId = `food_plan_${Date.now()}`;
        if (ctx.accessToken) {
          try {
            const planData = { date, name, ingredients, steps, nutrition, tags };
            const res = await growdeskFetch<{ id: string }>(`/api/v1/babies/${ctx.baby.id}/food-plan`, {
              method: "PUT",
              accessToken: ctx.accessToken,
              body: { planData },
            });
            if (res.data?.id) planId = res.data.id;
          } catch {}
        }
        return ok(`已成功保存【${date}】辅食计划食谱「${name}」✨`, { id: planId, date, name });
      }

      const plan = await prisma.foodPlan.create({ data: { babyId: ctx.baby.id, date, name, ingredients: JSON.stringify(ingredients), steps: JSON.stringify(steps), nutrition, tags: JSON.stringify(tags) } });
      return ok(`已成功保存【${date}】辅食计划食谱「${name}」✨`, { id: plan.id, date, name });
    },
  };
}
