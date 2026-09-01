import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { AI_CONFIG } from "@/lib/config";
import { getLocalDateStr } from "@/lib/date";
import { extractActionCards } from "@/lib/extract-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HINT: Record<string, string> = {
  feeding: "当前在喂养记录页，优先输出 feeding。",
  sleep: "当前在睡眠记录页，优先输出 sleep。",
  diaper: "当前在尿布记录页，优先输出 diaper。",
  food: "当前在辅食记录页，优先输出 food。",
  growth: "当前在生长测量页，优先输出 growth。",
  medical: "当前在化验单页，优先输出 medical_report。",
};

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth.errorResponse) return auth.errorResponse;

  const rateLimit = checkRateLimit(`parse_record:${auth.user.id || getClientIp(request)}`, 20, 60_000);
  if (!rateLimit.success) {
    return NextResponse.json(
      { error: `提问过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
      { status: 429 }
    );
  }

  if (!AI_CONFIG.apiKey) {
    return NextResponse.json({ error: "未配置大模型，无法整理语音记录" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const contextType = typeof body.contextType === "string" ? body.contextType : "general";
  const babyId = typeof body.babyId === "string" ? body.babyId : undefined;
  if (!text || text.length > 2000) {
    return NextResponse.json({ error: "请先说出一条记录" }, { status: 400 });
  }

  const babyResult = await requireBaby(auth.user.id, babyId);
  if (babyResult.errorResponse) return babyResult.errorResponse;

  const system = `你把家长口述整理成待确认的日常记录。只输出 JSON，不要 markdown。
今天日期 ${getLocalDateStr()}。宝宝昵称 ${babyResult.baby.nickname || "宝宝"}。
${HINT[contextType] || "按实际内容选择类型。"}
一句话里有多件事就输出多条。不确定的字段省略。
时间 HH:mm，日期 YYYY-MM-DD。

输出：{"actions":[{"type":"feeding|sleep|diaper|growth|food|medical_report","data":{...}}]}

feeding.data: type(breast|formula|bottle_breast|mixed), amountMl?, durationMinutes?, timestamp?(HH:mm), notes?
sleep.data: startTime(HH:mm), endTime(HH:mm), type(day|night), notes?
diaper.data: type(pee|poop|both), poopColor?(yellow|green|brown|other), poopConsistency?(loose|paste|formed), timestamp?(HH:mm), notes?
growth.data: weightKg?, heightCm?, headCircumferenceCm?, date?, notes?
food.data: date?, time?(HH:mm), foods(string[]), portion?(little|half|most|all), acceptance?(1-5), babyState?(happy|neutral|rejected), hasAbnormal?, abnormalNotes?
不要假装已经保存。`;

  try {
    const res = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: AI_CONFIG.headers,
      body: JSON.stringify({
        model: AI_CONFIG.model,
        temperature: 0.1,
        max_tokens: 1200,
        ...AI_CONFIG.completionExtras,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("parse-record upstream", res.status, errText.slice(0, 300));
      return NextResponse.json({ error: "整理记录失败，请稍后重试" }, { status: 502 });
    }
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    const content = (choice?.content || choice?.reasoning_content || "");
    const actions = extractActionCards(content);
    return NextResponse.json({ transcript: text, actions });
  } catch (err) {
    console.error("POST /api/ai/parse-record", err);
    return NextResponse.json({ error: "整理记录失败，请稍后重试" }, { status: 502 });
  }
}
