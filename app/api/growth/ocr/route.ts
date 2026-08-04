import { NextResponse } from "next/server";

const HERMES_URL = process.env.HERMES_API_URL ?? "http://localhost:8642";
const HERMES_MODEL = process.env.HERMES_VISION_MODEL ?? "hermes-vision";

interface OcrResult {
  date?: string;
  weightKg?: number;
  heightCm?: number;
  headCircumferenceCm?: number;
}

export const maxDuration = 30;

export async function POST(request: Request) {
  let imageBase64: string | null = null;
  let mime = "image/jpeg";

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
      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { error: "图片过大，请选择 10MB 以内的照片" },
          { status: 400 }
        );
      }
      mime = file.type || "image/jpeg";
      const buffer = Buffer.from(await file.arrayBuffer());
      imageBase64 = buffer.toString("base64");
    } catch {
      return NextResponse.json(
        { error: "图片读取失败，请重试" },
        { status: 400 }
      );
    }
  } else {
    // fallback: raw image body
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return NextResponse.json(
        { error: "请选择测量记录照片" },
        { status: 400 }
      );
    }
    imageBase64 = Buffer.from(body).toString("base64");
  }

  try {
    const res = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages: [
          {
            role: "system",
            content:
              '你是儿童保健记录识别助手。从照片中识别测量记录，只输出 JSON：{"date":"YYYY-MM-DD","weightKg":数字,"heightCm":数字,"headCircumferenceCm":数字}。无法识别的字段省略。不要输出其他内容。',
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
        max_tokens: 200,
        temperature: 0,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`OCR service error: ${res.status}`);
      return NextResponse.json(
        {
          error:
            "识别服务暂不可用，请手动输入（照片不会被保存，请放心）",
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "未从照片中识别到有效数据，请手动输入" },
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

    if (Object.keys(result).length === 0) {
      return NextResponse.json(
        { error: "未从照片中识别到有效数据，请手动输入" },
        { status: 422 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/growth/ocr error:", error);
    return NextResponse.json(
      { error: "识别服务连接失败，请手动输入（照片不会被保存）" },
      { status: 503 }
    );
  }
}
