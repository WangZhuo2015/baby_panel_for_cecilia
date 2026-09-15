import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { getLocalDateStr, isValidDateStr, addDays } from "@/lib/date";
import { calculateAgeDetail } from "@/lib/age";
import { estimatePercentile } from "@/lib/who-growth-standards";
import * as records from "@/lib/records/service";
import type { Baby } from "@/generated/prisma/client";
import { GROWDESK_CONFIG } from "@/lib/config";
import { growdeskFetch } from "@/lib/growdesk/client";
import { toGrowDeskGrowthCreatePayload } from "@/lib/growdesk/growth-compat";
import { optionalNumber, ok, fail, type Params } from "./helpers";

export function makeRecordGrowthTool(ctx: {
  userId: string;
  baby: Baby;
  accessToken?: string;
  familyId?: string;
}): AgentTool {
  return {
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
      const date = typeof params.date === "string" && isValidDateStr(params.date) ? params.date : getLocalDateStr();
      const today = getLocalDateStr();
      if (date > addDays(today, 1)) fail("测量日期不能是未来");
      if (ctx.baby.birthDate && date < ctx.baby.birthDate) fail("测量日期不能早于出生日期");
      const weightKg = optionalNumber((params as any).weightKg, 0.5, 50, "体重kg");
      const heightCm = optionalNumber((params as any).heightCm, 20, 150, "身长cm");
      const headCircumferenceCm = optionalNumber((params as any).headCircumferenceCm, 20, 60, "头围cm");
      if (weightKg == null && heightCm == null && headCircumferenceCm == null) {
        fail("生长记录缺少测量数值（体重/身长/头围），请先向家长追问确认具体数值后再记录");
      }
      // Use service for idempotency + percentile, but compute percentile for message
      const ageDetail = calculateAgeDetail(ctx.baby.birthDate, date);
      const gender = ctx.baby.gender || "female";
      let percentile: number | null = null;
      if (weightKg != null) percentile = estimatePercentile(gender, "weight", ageDetail.months, weightKg);
      else if (heightCm != null) percentile = estimatePercentile(gender, "height", ageDetail.months, heightCm);
      else if (headCircumferenceCm != null) percentile = estimatePercentile(gender, "headCircumference", ageDetail.months, headCircumferenceCm);

      if (GROWDESK_CONFIG.enabled) {
        const payload = toGrowDeskGrowthCreatePayload({
          babyId: ctx.baby.id,
          date,
          weightKg,
          heightCm,
          headCircumferenceCm,
          notes: typeof params.notes === "string" ? params.notes.trim() : null,
        });

        let newId = `growth_${Date.now()}`;
        if (ctx.accessToken) {
          try {
            const res = await growdeskFetch<{ id: string }>(
              `/api/v1/babies/${ctx.baby.id}/growth-measurements`,
              {
                method: "POST",
                accessToken: ctx.accessToken,
                body: payload,
              }
            );
            if (res.data?.id) newId = res.data.id;
          } catch {}
        }
        return ok(
          `已记录生长 ${date}${weightKg != null ? ` 体重${weightKg}kg` : ""}${heightCm != null ? ` 身长${heightCm}cm` : ""}${headCircumferenceCm != null ? ` 头围${headCircumferenceCm}cm` : ""}${percentile != null ? ` 约P${percentile}` : ""}`,
          { id: newId, recordId: newId, percentile }
        );
      }

      const record = await records.createGrowth(
        { userId: ctx.userId, babyId: ctx.baby.id, baby: ctx.baby },
        { date, weightKg, heightCm, headCircumferenceCm }
      );
      return ok(
        `已记录生长 ${date}${weightKg != null ? ` 体重${weightKg}kg` : ""}${heightCm != null ? ` 身长${heightCm}cm` : ""}${headCircumferenceCm != null ? ` 头围${headCircumferenceCm}cm` : ""}${percentile != null ? ` 约P${percentile}` : ""}`,
        { id: (record as any).id, percentile }
      );
    },
  };
}
