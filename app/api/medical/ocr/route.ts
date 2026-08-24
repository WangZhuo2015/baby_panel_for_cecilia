import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getAuthSession } from "@/lib/auth";
import { AI_CONFIG } from "@/lib/config";

export const maxDuration = 45;

const SYSTEM_PROMPT = `
你是一位专业的儿科医生与医学化验单智能识别专家。
请仔细识别并提取用户上传的儿童医学单据图片（如血常规、体检记录单、微量元素、骨密度、过敏原检测、尿常规、大便常规等）。

输出必须为严格的标准 JSON 对象，结构如下：
{
  "title": "单据名称，如：末梢血常规化验单 / 6月龄儿童保健体检表 / 微量元素五项检测报告",
  "category": "blood | growth | trace_element | allergy | general",
  "date": "YYYY-MM-DD (若无年份则推断合理年份或留空)",
  "hospital": "医院或机构名称",
  "doctorNotes": "报告单上医生填写的诊断、体格评价或处理建议",
  "aiSummary": "结合婴儿各月龄临床标准的简要通俗解读与家长注意事项（100字以内）",
  "growthData": {
    "weightKg": 数字或null,
    "heightCm": 数字或null,
    "headCircumferenceCm": 数字或null
  },
  "items": [
    {
      "name": "检测项目名称，如 白细胞计数(WBC) / 血红蛋白(HGB) / 钙(Ca) / 锌(Zn)",
      "value": "检测结果数值或定性描述，如 9.6 或 阴性",
      "unit": "单位，如 10^9/L, g/L, mmol/L (无单位填空字符串)",
      "referenceRange": "参考区间，如 4.0-10.0, 110-140",
      "status": "normal | high | low | abnormal | positive | negative",
      "interpretation": "该指标含义简述，如：反映机体感染与免疫状态"
    }
  ]
}

判断规则：
1. category 分类：
   - "blood": 血常规、CRP、凝血、血型等
   - "growth": 儿保体检、生长发育测量、骨龄、囟门体检
   - "trace_element": 钙/铁/锌/镁/铜、维生素D、铁蛋白等
   - "allergy": IgE、食物不耐受、过敏原特异性抗体
   - "general": 其他化验、B超、脑电图、听力筛查等
2. status 标识：根据单据上的箭头提示（↑ / ↓ / H / L / + / -）或参考区间判断，超出上限标 "high"，低于下限标 "low"，阳性标 "positive"，正常标 "normal"。
3. 务必严格输出合法的 JSON 格式，不要包含 markdown \`\`\` 以外的无关文字。
`;

export async function POST(request: Request) {
  const user = await getAuthSession(request);
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let imageBase64: string | null = null;
  let mime = "image/jpeg";
  let savedImageUrl: string | null = null;

  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("image") as File | null;
      if (!file || file.size === 0) {
        return NextResponse.json({ error: "请提供清晰的单据照片" }, { status: 400 });
      }
      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "图片过大，请控制在 15MB 以内" }, { status: 400 });
      }

      mime = file.type || "image/jpeg";
      const buffer = Buffer.from(await file.arrayBuffer());
      imageBase64 = buffer.toString("base64");

      // Save image to permanent storage
      const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
      const rawExt = path.extname(file.name || "").toLowerCase();
      const ext = ALLOWED_EXTENSIONS.includes(rawExt) ? rawExt : ".jpg";
      const filename = `medical_${Date.now()}_${crypto.randomBytes(16).toString("hex")}${ext}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "medical");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), buffer);
      savedImageUrl = `/uploads/medical/${filename}`;
    } else {
      const json = await request.json();
      if (json.imageBase64) {
        imageBase64 = json.imageBase64;
        mime = json.mime || "image/jpeg";
      } else if (json.imageUrl) {
        savedImageUrl = json.imageUrl;
      }
    }

    if (!imageBase64 && !savedImageUrl) {
      return NextResponse.json({ error: "未能获取图片数据" }, { status: 400 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AI_CONFIG.apiKey) {
      headers["Authorization"] = `Bearer ${AI_CONFIG.apiKey}`;
    }

    const imageUrlPayload = imageBase64
      ? `data:${mime};base64,${imageBase64}`
      : savedImageUrl;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "请结构化识别这张化验单/体检报告/生长记录单，提取所有指标项、参考值、异常标记和临床总结，输出为 JSON。",
          },
          {
            type: "image_url",
            image_url: { url: imageUrlPayload },
          },
        ],
      },
    ];

    // Attempt OpenAI Vision request
    const response = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: AI_CONFIG.visionModel,
        messages,
        temperature: 0.1,
        max_tokens: 2500,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!response.ok) {
      // If response_format json_object caused issue with older vision models, retry once without response_format
      const retryResponse = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: AI_CONFIG.visionModel,
          messages,
          temperature: 0.1,
          max_tokens: 2500,
        }),
        signal: AbortSignal.timeout(35000),
      });

      if (!retryResponse.ok) {
        const errorText = await retryResponse.text().catch(() => "");
        console.error("OpenAI OCR API failed:", retryResponse.status, errorText);
        return NextResponse.json(
          {
            error: `AI 识别服务暂时不可用 (${retryResponse.status})，请检查 AI_API_KEY / AI_BASE_URL 设置`,
          },
          { status: 503 }
        );
      }

      const retryData = await retryResponse.json();
      return processOcrResult(retryData, savedImageUrl);
    }

    const data = await response.json();
    return processOcrResult(data, savedImageUrl);
  } catch (error: any) {
    console.error("POST /api/medical/ocr error:", error);
    return NextResponse.json(
      { error: error?.message || "识别处理超时或网络连接失败，请重试" },
      { status: 500 }
    );
  }
}

function processOcrResult(data: any, savedImageUrl: string | null) {
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "AI 未能解析出单据结构化数据，请手动输入或重新拍摄更清晰的照片" },
      { status: 422 }
    );
  }

  try {
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

    return NextResponse.json({
      title: parsed.title || "化验与体检记录",
      category: ["blood", "growth", "trace_element", "allergy", "general"].includes(parsed.category)
        ? parsed.category
        : "general",
      date: parsed.date || new Date().toISOString().slice(0, 10),
      hospital: parsed.hospital || "",
      doctorNotes: parsed.doctorNotes || "",
      aiSummary: parsed.aiSummary || "",
      growthData: parsed.growthData || undefined,
      items,
      imageUrl: savedImageUrl,
    });
  } catch (err: any) {
    console.error("JSON parse OCR error:", err);
    return NextResponse.json(
      { error: "单据结构化数据解析失败，请重试" },
      { status: 422 }
    );
  }
}
