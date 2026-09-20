import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { safeJsonParse } from "@/lib/json";
import { calculateCorrectedAge } from "@/lib/age";
import { estimatePercentile } from "@/lib/who-growth-standards";
import { isValidDateStr, getLocalDateStr } from "@/lib/date";
import { GROWDESK_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import {
  toGrowDeskMedicalCreatePayload,
  fromGrowDeskMedicalRecord,
  type GrowDeskMedicalReport,
} from "@/lib/growdesk/medical-compat";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import crypto from "node:crypto";
import { projectLegacyMedicalRecord, wantsExtendedRepresentation } from "@/lib/growdesk/legacy-projections";

export async function GET(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }
      const { searchParams } = new URL(request.url);
      const extended = wantsExtendedRepresentation(request);
      let requestedBabyId = searchParams.get("babyId");
      if (!requestedBabyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        requestedBabyId = baby?.id || null;
      }
      if (!requestedBabyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }
      const category = searchParams.get("category");
      const limit = searchParams.get("limit") || "50";
      const res = await growdeskFetch<Array<GrowDeskMedicalReport>>(
        `/api/v1/babies/${requestedBabyId}/medical/reports?limit=${limit}`,
        {
          method: "GET",
          accessToken: bffSession.accessToken,
        },
      );
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error?.message || "获取健康单据失败" },
          { status: res.status },
        );
      }
      const rawList = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      const legacyList = rawList.map(fromGrowDeskMedicalRecord);
      const filtered = category && category !== "all"
        ? legacyList.filter((item: any) => item.category === category)
        : legacyList;
      return NextResponse.json(extended ? filtered : filtered.map(projectLegacyMedicalRecord));
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const requestedBabyId = searchParams.get("babyId");
    const category = searchParams.get("category");

    const babyResult = await requireBaby(user.id, requestedBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    const whereClause: any = { babyId: baby.id };
    if (category && category !== "all") {
      whereClause.category = category;
    }

    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const reports = await prisma.medicalReport.findMany({
      where: whereClause,
      orderBy: { date: "desc" },
      take: limit,
    });

    const formatted = reports.map((r) => ({
      ...r,
      items: safeJsonParse(r.itemsJson, []),
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("GET /api/medical/reports error:", error);
    return NextResponse.json({ error: "获取健康单据失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (GROWDESK_CONFIG.enabled) {
      const csrfErr = verifyBffCsrf(request);
      if (csrfErr) return csrfErr;

      const bffSession = await resolveBffSession(request);
      if (!bffSession) {
        return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
      }

      const body = await request.json().catch(() => ({}));
      let babyId = body.babyId;
      if (!babyId) {
        const baby = await loadWebBaby(growdeskFetch, bffSession.accessToken);
        babyId = baby?.id || null;
      }
      if (!babyId) {
        return NextResponse.json({ error: "请提供 babyId" }, { status: 400 });
      }

      const payload = toGrowDeskMedicalCreatePayload(body);
      const idempotencyKey =
        body.clientId || request.headers.get("idempotency-key") || crypto.randomUUID();

      const res = await growdeskFetch<GrowDeskMedicalReport>(
        `/api/v1/babies/${babyId}/medical/reports`,
        {
          method: "POST",
          accessToken: bffSession.accessToken,
          idempotencyKey,
          body: payload,
        },
      );

      if (!res.ok || !res.data) {
        return NextResponse.json(
          { error: res.error?.message || "保存报告失败，请重试" },
          { status: res.status },
        );
      }

      const created = fromGrowDeskMedicalRecord(res.data);
      return NextResponse.json(created, { status: 201 });
    }

    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      babyId: reqBabyId,
      title,
      category,
      date,
      hospital,
      doctorNotes,
      aiSummary,
      items,
      imageUrl,
      growthData,
    } = body;

    const babyResult = await requireBaby(user.id, reqBabyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const baby = babyResult.baby;

    const cleanTitle = typeof title === "string" ? title.trim() : "";
    const cleanDate = typeof date === "string" ? date.trim() : "";

    if (!cleanTitle || !cleanDate || !isValidDateStr(cleanDate)) {
      return NextResponse.json(
        { error: "请填写报告标题和有效的日期（YYYY-MM-DD）" },
        { status: 400 }
      );
    }

    if (cleanDate > getLocalDateStr()) {
      return NextResponse.json({ error: "报告日期不能是未来" }, { status: 400 });
    }
    if (baby.birthDate && cleanDate < baby.birthDate) {
      return NextResponse.json(
        { error: "报告日期不能早于宝宝出生日期" },
        { status: 400 }
      );
    }

    if (cleanTitle.length > 100) {
      return NextResponse.json({ error: "title 不能超过 100 个字符" }, { status: 400 });
    }

    const itemsJson = JSON.stringify(Array.isArray(items) ? items : []);
    if (Array.isArray(items) && items.length > 40) {
      return NextResponse.json({ error: "items 不能超过 40 项" }, { status: 400 });
    }
    const cleanHospital = (hospital && typeof hospital === "string" && hospital.trim()) || null;
    if (cleanHospital && cleanHospital.length > 100) {
      return NextResponse.json({ error: "hospital 不能超过 100 个字符" }, { status: 400 });
    }
    const cleanDoctorNotes = (doctorNotes && typeof doctorNotes === "string" && doctorNotes.trim()) || null;
    if (cleanDoctorNotes && cleanDoctorNotes.length > 1000) {
      return NextResponse.json({ error: "doctorNotes 不能超过 1000 个字符" }, { status: 400 });
    }
    const cleanAiSummary = (aiSummary && typeof aiSummary === "string" && aiSummary.trim()) || null;
    if (cleanAiSummary && cleanAiSummary.length > 5000) {
      return NextResponse.json({ error: "aiSummary 不能超过 5000 个字符" }, { status: 400 });
    }
    const cleanImageUrl = (imageUrl && typeof imageUrl === "string" && imageUrl.trim()) || null;
    if (cleanImageUrl && !/^\/uploads\/medical\/[^/]+\.(jpg|jpeg|png|webp|heic)$/i.test(cleanImageUrl)) {
      return NextResponse.json({ error: "imageUrl 仅支持本站 /uploads/medical/ 路径的图片" }, { status: 400 });
    }

    // 校验必须先于任何写入：越界直接 400，避免孤儿报告
    let weightKg: number | null = null;
    let heightCm: number | null = null;
    let headCircumferenceCm: number | null = null;
    if (growthData && typeof growthData === "object") {
      const numericInRange = (
        raw: unknown,
        min: number,
        max: number,
        label: string
      ): number | null => {
        if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
        const v = Number(raw);
        if (Number.isNaN(v) || v < min || v > max) {
          throw new RangeError(`${label} 必须在 ${min}-${max} 之间`);
        }
        return v;
      };

      try {
        weightKg = numericInRange(growthData.weightKg, 0.5, 50.0, "体重(kg)");
        heightCm = numericInRange(growthData.heightCm, 20.0, 150.0, "身高(cm)");
        headCircumferenceCm = numericInRange(growthData.headCircumferenceCm, 20.0, 60.0, "头围(cm)");
      } catch (error: any) {
        if (error instanceof RangeError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        throw error;
      }
    }

    // 报告与测量原子化写入
    const createdReport = await prisma.$transaction(async (tx) => {
      const report = await tx.medicalReport.create({
        data: {
          babyId: baby.id,
          recordedById: user.id,
          title: cleanTitle,
          category: category || "general",
          date: cleanDate,
          hospital: cleanHospital,
          doctorNotes: cleanDoctorNotes,
          aiSummary: cleanAiSummary,
          itemsJson,
          imageUrl: cleanImageUrl,
        },
      });

      if (weightKg != null || heightCm != null || headCircumferenceCm != null) {
        const ageSummary = calculateCorrectedAge(baby.birthDate, baby.gestationalAge, cleanDate);
        const gender = baby.gender || "female";
        let percentile: number | null = null;
        if (weightKg != null) {
          percentile = estimatePercentile(gender, "weight", ageSummary.correctedDecimalMonths, weightKg);
        } else if (heightCm != null) {
          percentile = estimatePercentile(gender, "height", ageSummary.correctedDecimalMonths, heightCm);
        } else if (headCircumferenceCm != null) {
          percentile = estimatePercentile(gender, "headCircumference", ageSummary.correctedDecimalMonths, headCircumferenceCm);
        }

        await tx.growthMeasurement.create({
          data: {
            babyId: baby.id,
            recordedById: user.id,
            date: cleanDate,
            ageInMonths: ageSummary.correctedMonths,
            ageLabel: ageSummary.label,
            weightKg,
            heightCm,
            headCircumferenceCm,
            percentile,
            imageUrl: cleanImageUrl,
          },
        });
      }

      return report;
    });

    return NextResponse.json(
      {
        ...createdReport,
        items: safeJsonParse(createdReport.itemsJson, []),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("POST /api/medical/reports error:", error);
    return NextResponse.json({ error: "保存报告失败，请重试" }, { status: 500 });
  }
}
