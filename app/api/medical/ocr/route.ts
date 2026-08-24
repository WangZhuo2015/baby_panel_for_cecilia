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

export const maxDuration = 120;

const SYSTEM_PROMPT = `你是一位专业的儿科检验解读助手。任务：从化验单/体检报告照片中提取全部信息，并输出严格的标准 JSON 对象，随后（如需记录）输出 action 卡片。

【提取总则】：
- 单据上的每一个检测项目都必须提取，一行不漏（血常规通常有 20+ 项）。
- 所有的 date 字段必须严格为标准 "YYYY-MM-DD"；startTime / endTime 为 24小时制 "HH:mm"。
- 数值字段为纯数字，不带单位；单位单独放 unit 字段。

【items[].referenceRange 参考区间 —— 最高优先级】：
1. 单据上几乎都印有「参考区间/参考范围」列——必须逐项原样提取（如 "4.0-10.0"、"120-160"）。
2. 若某项单据确实未印参考区间，你必须按中国儿科通用参考值填入并在末尾追加 "(通用)"，例如 "3.5-9.5 (通用)"。
3. 禁止任何一项的 referenceRange 为空字符串或缺失。

【items[].interpretation 逐项解读】：
- status 为 high / low / abnormal 的项必填 1~2 句：实测值与参考区间的对比 + 该月龄婴幼儿最常见的 2~3 种可能原因（先讲常见的良性情况如生理性变化、采血时哭闹血液浓缩，再提需要警惕的情况）。
- normal 项可写 "" 或一句"在参考范围内"。

【aiSummary 综合解读——要求详细，不少于 250 字，按以下结构】：
1. 总体印象：整体如何、有无需重点关注的项目。
2. 异常项逐条展开：「实测值 vs 参考区间」+ 该月龄常见可能原因至少 2 种（先良性后警惕）+ 建议动作。
3. 正常项一句话汇总带过。
4. 复查与就医建议：明确到多久后复查什么项目、出现什么症状挂哪个科。
5. 固定结尾："以上分析仅供家长参考，不能替代医生面诊；如宝宝有发热、精神差等症状请及时就医。"

【多事件规则（非常重要）】：家长经常一次性口述多件事，例如「刚才十二点半睡了四十分钟，下午三点醒了，醒来喝了150ml奶」。此时必须把每件事分别输出为独立的 \`\`\`json:action 块（本例应为：1个 sleep + 1个 feeding），多个块连续排列即可，禁止合并成一条记录，也禁止遗漏任何一件明确提到的事。时间不明确的字段留空让家长在卡片里补填。

【支持的 Action 类型及数据结构如下】：

1. 化验单 / 体检报告单据 (medical_report)：
\`\`\`json:action
{
  "type": "medical_report",
  "data": {
    "title": "单据名称",
    "category": "blood | growth | trace_element | allergy | general",
    "date": "YYYY-MM-DD",
    "hospital": "医院名称(可选)",
    "aiSummary": "按上述要求的详细综合解读",
    "growthData": { "weightKg": 8.2, "heightCm": 68.5, "headCircumferenceCm": 43.0 },
    "items": [
      { "name": "白细胞计数 (WBC)", "value": "6.8", "unit": "10^9/L", "referenceRange": "4.0-10.0", "status": "normal | high | low | abnormal", "interpretation": "异常项必填解读" }
    ]
  }
}
\`\`\`

2. 喂养记录 (feeding)：
\`\`\`json:action
{ "type": "feeding", "data": { "type": "breast | formula | bottle_breast | mixed", "amountMl": 150, "durationMinutes": 20, "notes": "备注", "timestamp": "YYYY-MM-DDTHH:mm:ss.000Z" } }
\`\`\`

3. 睡眠记录 (sleep)：
\`\`\`json:action
{ "type": "sleep", "data": { "startTime": "HH:mm", "endTime": "HH:mm", "type": "day | night", "notes": "备注" } }
\`\`\`
时间不明确时 startTime/endTime 留空字符串，家长会在卡片上补填。

4. 排便记录 (diaper)：
\`\`\`json:action
{ "type": "diaper", "data": { "type": "pee | poop | both", "poopColor": "yellow | green | brown | other", "poopConsistency": "soft | watery | hard | seedy", "notes": "形态备注", "timestamp": "YYYY-MM-DDTHH:mm:ss.000Z" } }
\`\`\`

5. 生长测量 (growth)：
\`\`\`json:action
{ "type": "growth", "data": { "weightKg": 8.2, "heightCm": 68.5, "headCircumferenceCm": 43.0, "date": "YYYY-MM-DD", "notes": "备注" } }
\`\`\`

注意：如果是普通育儿咨询或闲聊，无需输出 \`\`\`json:action 代码块。
再次强调：几件事就输出几个独立的 action 块；宁多多拆分，不可合并。
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
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AI_CONFIG.apiKey) headers["Authorization"] = `Bearer ${AI_CONFIG.apiKey}`;

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
          max_tokens: 3500,
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

function parseOcrSuccess(data: any, savedImageUrl: string | null) {
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI 未能解析出单据结构化数据，请手动输入或重新拍摄更清晰的照片");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  const items = Array.isArray(parsed.items)
    ? parsed.items.map((item: any, idx: number) => ({
        id: `item_${Date.now()}_${idx}`,
        name: String(item.name || "").trim(),
        value: item.value ?? "",
        unit: item.unit || "",
        referenceRange: item.referenceRange || "",
        status: ["normal", "high", "low", "abnormal", "positive", "negative"].includes(item.status)
          ? item.status
          : "normal",
        interpretation: item.interpretation || "",
      }))
    : [];

  return {
    title: parsed.title || "化验与体检记录",
    category: ["blood", "growth", "trace_element", "allergy", "general"].includes(parsed.category)
      ? parsed.category
      : "general",
    date: parsed.date || getLocalDateStr(),
    hospital: parsed.hospital || "",
    doctorNotes: parsed.doctorNotes || "",
    aiSummary: parsed.aiSummary || "",
    growthData: parsed.growthData || undefined,
    items,
    imageUrl: savedImageUrl,
  };
}
