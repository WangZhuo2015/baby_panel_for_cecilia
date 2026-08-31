import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireAuth } from "@/lib/api-helpers";
import { AI_CONFIG } from "@/lib/config";
import { validateImageMagicBytes, ALLOWED_IMAGE_MIMES } from "@/lib/upload";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { ParsedNutritionLabel } from "@/types/nutrition";

export const maxDuration = 120;

const SYSTEM_PROMPT = `你是一名儿科与营养品标签识别专家。你的任务是从用户上传的婴儿配方奶粉成分表或营养补充剂包装照片中，精准提取结构化营养素数据。

请严格仅输出一个符合以下格式的 JSON 对象，不要包裹 markdown 代码块，不要添加额外闲聊：
{
  "type": "formula" | "supplement",
  "brand": "品牌名 (如 爱他美、飞鹤、星鲨、Ddrops、Ostelin 等)",
  "name": "产品全称 (如 爱他美卓萃婴儿配方奶粉 1段 或 Ostelin 婴幼儿液体乳钙)",
  "stage": 1, // 仅奶粉有，1/2/3段，若无填 null
  "dosageForm": "drops" | "capsule" | "liquid_ml" | "sachet" | "tablet", // 补剂剂型
  "unitName": "滴" | "粒" | "ml" | "袋" | "片",
  "defaultDose": 1.0, // 推荐单次剂量
  "scoopWeightG": 4.3, // 奶粉单勺粉重(克)，通常为4.3~5.0g
  "waterPerScoopMl": 30.0, // 奶粉单勺对应水毫升数，通常为30ml
  "reconstitutionRatio": 0.135, // 冲调浓度比例(约 0.13~0.15)
  "servingSizeUnit": "per_100g", // 标称基准: "per_100g" | "per_100ml" | "per_100kJ"
  "nutrients": {
    // 标准键名说明 (数值提取纯数字，单位标准填写)：
    // 能量与宏量: energy_kcal, energy_kj, protein, fat, carbohydrate, dietary_fiber
    // 脂肪酸: dha, ara, linoleic_acid, alpha_linolenic_acid
    // 维生素: vitamin_a, vitamin_d (单位写 IU 或 mcg), vitamin_e, vitamin_k, vitamin_b1, vitamin_b2, vitamin_b6, vitamin_b12, vitamin_c, folate, niacin, pantothenic_acid, biotin, choline
    // 矿物质: calcium, phosphorus, potassium, sodium, magnesium, iron, zinc, copper, manganese, iodine, selenium
    // 其它: taurine, nucleotides, lutein
    // 示例:
    // "protein": { "amount": 9.8, "unit": "g" },
    // "vitamin_d": { "amount": 380, "unit": "IU" },
    // "calcium": { "amount": 340, "unit": "mg" }
  }
}

注意：
1. 奶粉成分表若给出 "每100kJ" 和 "每100g"，请优先提取【每100g (per 100g)】的数值。
2. 补剂如果为复合配方（如液体钙含维生素D3与K2），必须将包含的所有有效成分完整提取到 nutrients 中。
3. 务必保证数值准确，禁止幻觉编造。
`;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const user = auth.user;

    const rateLimit = checkRateLimit(`nutrition_ocr:${user.id || getClientIp(request)}`, 15, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(rateLimit.resetSeconds) } }
      );
    }

    let imageBase64: string | null = null;
    let mime = "image/jpeg";
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("image") as File | null;
      if (!file || file.size === 0) {
        return NextResponse.json({ error: "请提供清晰的成分表照片" }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length < 12 || !validateImageMagicBytes(buf).valid) {
        return NextResponse.json({ error: "图片内容或签名不合法" }, { status: 400 });
      }

      mime = (ALLOWED_IMAGE_MIMES as readonly string[]).includes(file.type) ? file.type : "image/jpeg";
      const extMap: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic" };
      const ext = extMap[mime] || ".jpg";
      const filename = `nutrition_${Date.now()}_${crypto.randomBytes(16).toString("hex")}${ext}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "nutrition");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, filename), buf);
      imageBase64 = buf.toString("base64");
    } else {
      const json = await request.json().catch(() => ({}));
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
      }
    }

    if (!imageBase64) {
      return NextResponse.json({ error: "未能获取图片数据" }, { status: 400 });
    }

    const imageDataUrl = `data:${mime};base64,${imageBase64}`;
    const headers = AI_CONFIG.headers;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "请识别这张营养成分表/配方表，提取所有营养素含量、冲调比例或补剂规格，输出标准 JSON。" },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ];

    const upstreamRes = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: AI_CONFIG.visionModel,
        messages,
        temperature: 0.1,
        max_tokens: 4000,
        ...AI_CONFIG.completionExtras,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      console.error("Upstream OCR vision error:", upstreamRes.status, errText);
      return NextResponse.json({ error: "AI 视觉服务暂时不可用，请稍后重试" }, { status: 502 });
    }

    const data = await upstreamRes.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: "未能解析出结构化成分表，请手动输入或拍摄更清晰的角度" }, { status: 422 });
    }

    const parsedJson = JSON.parse(jsonMatch[0]);

    // 格式清洗与标准化
    const parsed: ParsedNutritionLabel = {
      type: parsedJson.type === "supplement" ? "supplement" : "formula",
      brand: String(parsedJson.brand || "").trim(),
      name: String(parsedJson.name || "").trim(),
      stage: typeof parsedJson.stage === "number" ? parsedJson.stage : undefined,
      dosageForm: parsedJson.dosageForm || "drops",
      unitName: parsedJson.unitName || (parsedJson.type === "supplement" ? "滴" : "g"),
      defaultDose: typeof parsedJson.defaultDose === "number" ? parsedJson.defaultDose : 1.0,
      scoopWeightG: typeof parsedJson.scoopWeightG === "number" ? parsedJson.scoopWeightG : 4.3,
      waterPerScoopMl: typeof parsedJson.waterPerScoopMl === "number" ? parsedJson.waterPerScoopMl : 30.0,
      reconstitutionRatio: typeof parsedJson.reconstitutionRatio === "number" ? parsedJson.reconstitutionRatio : 0.135,
      servingSizeUnit: parsedJson.servingSizeUnit || "per_100g",
      nutrients: typeof parsedJson.nutrients === "object" && parsedJson.nutrients ? parsedJson.nutrients : {},
      rawOcrText: content.slice(0, 1000),
    };

    return NextResponse.json({
      success: true,
      parsed,
    });
  } catch (error: any) {
    console.error("POST /api/ai/parse-nutrition error:", error);
    return NextResponse.json({ error: "成分表解析失败，请重试" }, { status: 500 });
  }
}
