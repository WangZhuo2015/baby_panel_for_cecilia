import { bffAiJobStore } from "@/lib/growdesk/ai-jobs";
import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireAuth } from "@/lib/api-helpers";
import { GROWDESK_CONFIG, AI_CONFIG } from "@/lib/config";
import { resolveBffSession } from "@/lib/growdesk/session";
import { verifyBffCsrf } from "@/lib/growdesk/csrf";
import { growdeskFetch } from "@/lib/growdesk/client";
import { loadWebBaby } from "@/lib/growdesk/bridge-identity";
import { requireData, pathId, BridgeError, bridgeErrorResponse } from "@/lib/growdesk/bridge-protocol";
import { validateUploadedImage } from "@/lib/upload";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

interface OcrResult {
  date?: string;
  weightKg?: number;
  heightCm?: number;
  headCircumferenceCm?: number;
  imageUrl?: string;
  attachmentId?: string;
}

export const maxDuration = 120;

export async function POST(request: Request) {
  if (GROWDESK_CONFIG.enabled) {
    const csrfErr = verifyBffCsrf(request);
    if (csrfErr) return csrfErr;

    const session = await resolveBffSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: 会话无效或已过期" }, { status: 401 });
    }

    const limit = checkRateLimit(`growth_ocr:${session.user.id}`, 15, 60_000);
    if (!limit.success) return NextResponse.json({ error: "请求过于频繁" }, { status: 429, headers: { "retry-after": String(limit.resetSeconds) } });
    try {
      const formData = await request.formData();
      const file = (formData.get("image") || formData.get("file")) as File | null;
      if (!(file instanceof File) || file.size === 0 || file.size > 20 * 1024 * 1024) {
        return NextResponse.json({ error: "请选择不超过 20 MB 的测量记录照片" }, { status: 400 });
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const validation = validateUploadedImage(file, bytes);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error || "图片格式不合法" }, { status: 400 });
      }

      const babyIdParam = formData.get("babyId");
      const baby = await loadWebBaby(growdeskFetch, session.accessToken, babyIdParam || undefined);
      if (!baby) throw new BridgeError(404, "BABY_NOT_FOUND", "请先选择宝宝");
      const familyId = baby.familyId;

      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      const mime = validation.mime || "image/jpeg";

      const created = requireData(
        await growdeskFetch<{ id: string; uploadUrl: string }>("/api/v1/attachments", {
          method: "POST",
          accessToken: session.accessToken,
          body: {
            purpose: "medical_report",
            mimeType: mime,
            byteSize: bytes.length,
            sha256,
            ownerScope: { familyId, ...(baby ? { babyId: baby.id } : {}) },
          },
        })
      );

      const uploaded = await fetch(created.uploadUrl, {
        method: "PUT",
        body: bytes,
        headers: { "content-type": mime },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!uploaded.ok) {
        return NextResponse.json({ error: "图片上传失败，请重试" }, { status: 502 });
      }

      requireData(
        await growdeskFetch(`/api/v1/attachments/${pathId(created.id)}/complete`, {
          method: "POST",
          accessToken: session.accessToken,
          body: { byteSize: bytes.length, sha256 },
        })
      );

      const job = await bffAiJobStore.createJob({
        userId: session.user.id, babyId: baby.id, type: "growth_ocr",
        attachmentId: created.id,
        clientRequestId: String(formData.get("clientRequestId") || crypto.randomUUID()),
        accessToken: session.accessToken,
      });
      return NextResponse.json({ jobId: job.id, status: "processing", babyId: baby.id,
        imageUrl: `/api/attachments/${created.id}` }, { status: 202, headers: { "cache-control": "no-store" } });
    } catch (err: unknown) {
      return bridgeErrorResponse(err);
    }
  }

  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;
  const { user } = auth;

  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`growth_ocr:${user.id || ip}`, 15, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
      { status: 429 }
    );
  }

  let imageBase64: string | null = null;
  let mime = "image/jpeg";
  let savedImageUrl: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      const file = formData.get("image");
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json(
          { error: "请选择测量记录照片" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const validation = validateUploadedImage(file, buffer);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error || "图片格式不合法" }, { status: 400 });
      }

      mime = validation.mime || "image/jpeg";
      imageBase64 = buffer.toString("base64");

      // Archive verified photo
      const ext = validation.ext || ".jpg";
      const filename = `growth_${Date.now()}_${crypto.randomBytes(16).toString("hex")}${ext}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "medical");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), buffer);
      savedImageUrl = `/uploads/medical/${filename}`;
    } catch {
      return NextResponse.json(
        { error: "图片读取失败，请重试" },
        { status: 400 }
      );
    }
  } else {
    return NextResponse.json({ error: "请通过 multipart/form-data 上传照片文件" }, { status: 400 });
  }


  try {
    const res = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: AI_CONFIG.headers,
      body: JSON.stringify({
        model: AI_CONFIG.visionModel,
        messages: [
          {
            role: "system",
            content:
              '你是儿童保健记录识别助手。从照片中识别测量记录，只输出严格的 JSON：{"date":"YYYY-MM-DD","weightKg":数字,"heightCm":数字,"headCircumferenceCm":数字}。无法识别的字段省略。不要输出其他内容。',
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "请识别这张儿童生长测量记录照片中的测量日期、体重(kg)、身长(cm)、头围(cm)。",
              },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 1500,
        temperature: 0,
        ...AI_CONFIG.completionExtras,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(100000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`OCR service error (${res.status}):`, errBody);
      return NextResponse.json(
        {
          error: `识别服务暂时不可用 (${res.status})，请手动输入测量数据`,
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "未从照片中识别到有效生长记录，请手动输入" },
        { status: 422 }
      );
    }

    const parsed: OcrResult = JSON.parse(jsonMatch[0]);
    const result: OcrResult = {};
    if (typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
      result.date = parsed.date;
    }
    if (typeof parsed.weightKg === "number" && parsed.weightKg > 0) {
      result.weightKg = Math.round(parsed.weightKg * 100) / 100;
    }
    if (typeof parsed.heightCm === "number" && parsed.heightCm > 0) {
      result.heightCm = Math.round(parsed.heightCm * 10) / 10;
    }
    if (typeof parsed.headCircumferenceCm === "number" && parsed.headCircumferenceCm > 0) {
      result.headCircumferenceCm = Math.round(parsed.headCircumferenceCm * 10) / 10;
    }
    if (savedImageUrl) {
      result.imageUrl = savedImageUrl;
    }

    if (Object.keys(result).length === 0) {
      return NextResponse.json(
        { error: "照片中未找到清晰的身高、体重或头围数据，请手动输入" },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("POST /api/growth/ocr error:", error);
    return NextResponse.json(
      { error: error?.message || "识别服务连接超时或失败，请手动输入" },
      { status: 503 }
    );
  }
}
