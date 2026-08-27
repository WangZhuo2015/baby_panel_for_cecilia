import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireAuth } from "@/lib/api-helpers";
import { AI_CONFIG } from "@/lib/config";
import { getLocalDateStr } from "@/lib/date";
import { validateImageMagicBytes, ALLOWED_IMAGE_MIMES } from "@/lib/upload";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { archiveBuffer, archiveText } from "@/lib/archive";
import { composeMedicalAiSummary } from "@/lib/medical-summary";

export const maxDuration = 120;

const SYSTEM_PROMPT = `你是儿科检验单 OCR 助手。只输出一个 JSON 对象，不要 markdown，不要把字段包进 type/data。

顶层字段必须按这个顺序写，且 aiSummary 禁止空字符串：
- title: 单据名称
- category: blood | growth | trace_element | allergy | general
- date: YYYY-MM-DD（检验/报告日期）
- hospital: 医院或机构名
- aiSummary: 必填 Markdown 字符串（写在 JSON 的 items 之前，禁止空）。结构固定为：
  ## 总体印象
  （一段话）
  ## 需要关注
  - **项目名** \`实测值单位\`（参考 x-y）：一句话原因与建议
  ## 复查与就医
  （何时复查、何时就医）
  并以「以上分析仅供家长参考，不能替代医生面诊」结尾。可用加粗、列表，不要用 HTML。
- growthData: 仅当单据含体重/身长/头围时给出 {weightKg, heightCm, headCircumferenceCm}
- items: 数组，单据上每一个检测项目都要有，血常规通常 20+ 项，禁止漏行

items[]：
- name, value（纯数字字符串，不要带箭头或单位）, unit, referenceRange（单据原样，如 "4.00-10.00"）, status（normal|high|low|abnormal）, interpretation（high/low/abnormal 写 1 句；normal 用空字符串）
- 参考区间必须从单据提取；没有印刷区间时填儿科通用值并加 " (通用)"
`;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const user = auth.user;

    const rateLimit = checkRateLimit(`medical_ocr:${user.id || getClientIp(request)}`, 15, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    let imageBase64: string | null = null;
    let mime = "image/jpeg";
    let savedImageUrl: string | null = null;
    let inputBuffer: Buffer | null = null;

    const contentType = request.headers.get("content-type") ?? "";

    try {
      if (contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        const file = formData.get("image") as File | null;
        if (!file || file.size === 0) {
          return NextResponse.json({ error: "请提供清晰的单据照片" }, { status: 400 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        if (buf.length < 12 || !validateImageMagicBytes(buf).valid) {
          return NextResponse.json({ error: "图片内容或签名不合法" }, { status: 400 });
        }
        inputBuffer = buf;

        // 公开副本（报告 imageUrl 引用）
        mime = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type) ? file.type : "image/jpeg";
        const extMap: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic" };
        const ext = extMap[mime] || ".jpg";
        const filename = `medical_${Date.now()}_${crypto.randomBytes(16).toString("hex")}${ext}`;
        const uploadDir = path.join(process.cwd(), "public", "uploads", "medical");
        await mkdir(uploadDir, { recursive: true });
        await writeFile(path.join(uploadDir, filename), buf);
        savedImageUrl = `/uploads/medical/${filename}`;
        imageBase64 = buf.toString('base64');
      } else {
        const json = await request.json();
        if (json.imageBase64) {
          if (typeof json.imageBase64 !== "string" || json.imageBase64.length > 20_000_000) {
            return NextResponse.json({ error: "图片数据过大或格式无效" }, { status: 400 });
          }
          const decoded = Buffer.from(json.imageBase64, "base64");
          if (decoded.length === 0 || !validateImageMagicBytes(decoded).valid) {
            return NextResponse.json({ error: "图片内容或签名不合法" }, { status: 400 });
          }
          imageBase64 = json.imageBase64;
          mime = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(json.mime) ? json.mime : "image/jpeg";
        } else if (json.imageUrl) {
          if (typeof json.imageUrl !== "string" || !json.imageUrl.startsWith("/uploads/")) {
            return NextResponse.json({ error: "imageUrl 仅支持本站 /uploads/ 路径" }, { status: 400 });
          }
          savedImageUrl = json.imageUrl;
        }
      }

      if (!imageBase64 && !savedImageUrl && !inputBuffer) {
        return NextResponse.json({ error: "未能获取图片数据" }, { status: 400 });
      }

      // ===== 异步任务：立即返回 jobId，后台识别 =====
      let inputArchiveId: string | null = null;
      if (inputBuffer) {
        try {
          const arch = await archiveBuffer("input_image", inputBuffer, ".jpg");
          inputArchiveId = arch.id;
        } catch (e) {
          console.warn("archive input image failed:", e);
        }
      }

      const job = await prisma.aiJob.create({
        data: {
          userId: user.id,
          type: "medical_ocr",
          status: "processing",
          imageUrl: savedImageUrl,
          inputArchiveId,
        },
      });

      const imageDataUrl =
        imageBase64 ? `data:${mime};base64,${imageBase64}` : "";
      void runMedicalOcrJob(job.id, imageDataUrl, savedImageUrl).catch((e) =>
        console.error("runMedicalOcrJob crashed:", e)
      );

      return NextResponse.json(
        { jobId: job.id, status: "processing", imageUrl: savedImageUrl },
        { status: 202 }
      );
    } catch (error: any) {
      if (error instanceof NextResponse) throw error;
      console.error("OCR prepare error:", error);
      return NextResponse.json({ error: "图片预处理失败" }, { status: 500 });
    }
  } catch (error: any) {
    console.error("POST /api/medical/ocr error:", error);
    return NextResponse.json({ error: "识别任务创建失败，请重试" }, { status: 500 });
  }
}

// ===== 后台执行：调上游视觉模型 → 归档输出 → 更新任务状态（约 45~55s）=====
async function runMedicalOcrJob(jobId: string, imageDataUrl: string, savedImageUrl: string | null) {
  try {
    const headers = AI_CONFIG.headers;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "请结构化识别这张化验单/体检报告/生长记录单，提取所有指标项、参考值、异常标记和临床总结，输出为 JSON。" },
          ...(imageDataUrl
            ? [{ type: "image_url", image_url: { url: imageDataUrl } }]
            : [{ type: "text", text: `(单据照片已存档: ${savedImageUrl})` }]),
        ],
      },
    ];

    const fetchOnce = (withFormat: boolean) =>
      fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: AI_CONFIG.visionModel,
          messages,
          temperature: 0.1,
          max_tokens: 8000,
          ...AI_CONFIG.completionExtras,
          ...(withFormat ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(100000),
      }).then(async (r) => {
        if (!r.ok) throw Object.assign(new Error(`upstream ${r.status}`), { status: r.status });
        return r.json();
      });

    let data: any;
    try {
      data = await fetchOnce(true);
    } catch (e: any) {
      if (e?.status && e.status < 500 && e.status !== 408) {
        data = await fetchOnce(false);
      } else {
        throw e;
      }
    }

    const parsed = parseOcrSuccess(data, savedImageUrl);
    await archiveText("output_json", JSON.stringify(parsed));
    await prisma.aiJob.update({
      where: { id: jobId },
      data: { status: "done", resultJson: JSON.stringify(parsed), finishedAt: new Date() },
    });
  } catch (error: any) {
    const msg = error?.message || "识别失败";
    console.error(`OCR job ${jobId} failed:`, msg);
    await archiveText("output_error", msg).catch(() => {});
    await prisma.aiJob
      .update({
        where: { id: jobId },
        data: { status: "failed", errorMessage: msg.slice(0, 300), finishedAt: new Date() },
      })
      .catch(() => {});
  }
}

function unwrapOcrPayload(parsed: any): any {
  if (!parsed || typeof parsed !== "object") return parsed;
  if (Array.isArray(parsed.items)) return parsed;
  for (const key of ["data", "answer", "result", "report"]) {
    const inner = parsed[key];
    if (inner && typeof inner === "object") return unwrapOcrPayload(inner);
  }
  return parsed;
}

function normalizeMedicalItemStatus(rawStatus: unknown): string {
  const str = String(rawStatus || "").trim().toLowerCase();
  if (["high", "↑", "▲", "偏高", "升高", "增高"].includes(str) || str.includes("偏高") || str.includes("升高") || str.includes("↑")) {
    return "high";
  }
  if (["low", "↓", "▼", "偏低", "降低", "减少"].includes(str) || str.includes("偏低") || str.includes("降低") || str.includes("↓")) {
    return "low";
  }
  if (["positive", "阳性", "+", "++", "+++"].includes(str) || str === "+") {
    return "positive";
  }
  if (["negative", "阴性"].includes(str)) {
    return "negative";
  }
  if (["abnormal", "异常", "+-", "弱阳性"].includes(str)) {
    return "abnormal";
  }
  if (["normal", "正常", "未见异常", "—", "-"].includes(str)) {
    return "normal";
  }
  return ["normal", "high", "low", "abnormal", "positive", "negative"].includes(str) ? str : "normal";
}

function parseOcrSuccess(data: any, savedImageUrl: string | null) {
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI 未能解析出单据结构化数据，请手动输入或重新拍摄更清晰的照片");
  }
  const parsed = unwrapOcrPayload(JSON.parse(jsonMatch[0]));
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((item: any, idx: number) => ({
        id: `item_${Date.now()}_${idx}`,
        name: String(item.name || "").trim(),
        value: item.value ?? "",
        unit: item.unit || "",
        referenceRange: item.referenceRange || "",
        status: normalizeMedicalItemStatus(item.status),
        interpretation: item.interpretation || "",
      }))
    : [];

  const aiSummary =
    (typeof parsed.aiSummary === "string" && parsed.aiSummary.trim()) ||
    composeMedicalAiSummary(items);

  return {
    title: parsed.title || "化验与体检记录",
    category: ["blood", "growth", "trace_element", "allergy", "general"].includes(parsed.category)
      ? parsed.category
      : "general",
    date: parsed.date || getLocalDateStr(),
    hospital: parsed.hospital || "",
    doctorNotes: parsed.doctorNotes || "",
    aiSummary,
    growthData: parsed.growthData || undefined,
    items,
    imageUrl: savedImageUrl,
  };
}
