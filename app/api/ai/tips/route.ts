import { NextResponse } from "next/server";

const HERMES_URL = process.env.HERMES_API_URL ?? "http://localhost:8642";
const HERMES_MODEL = "hermes-agent";

const SYSTEM_PROMPT = `你是一个温暖的育儿助手，用中文回答。你叫"小助手"。
你是一个AI助手，所有建议仅供参考，如有问题请咨询专业医生。

请根据宝宝当前月龄，给出2-3条简短的育儿建议，涵盖以下方面：
1. 生长发育建议
2. 日常护理建议
3. 亲子互动建议

要求：
- 语气温暖亲切
- 每条建议1-2句话
- 适合6个月左右的女宝宝
- 不要涉及医疗诊断
- 用中文回答
- 直接返回JSON数组，不要其他文字

示例格式：["建议1", "建议2", "建议3"]`;

export async function GET() {
  try {
    const res = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "请给6个月女宝宝小糖果今天的育儿建议" },
        ],
        max_tokens: 300,
        temperature: 0.8,
      }),
      // Don't cache AI responses - fresh each time
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      console.error(`Hermes API error: ${res.status}`);
      // Fallback to static tips
      return NextResponse.json(getFallbackTips());
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";

    // Try to parse JSON array from the response
    try {
      // Extract JSON array from response (may have markdown code blocks)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const tips = JSON.parse(jsonMatch[0]);
        if (Array.isArray(tips) && tips.length > 0) {
          return NextResponse.json(tips);
        }
      }
    } catch {
      // If JSON parsing fails, split by newlines
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0 && !l.startsWith("#"));
      if (lines.length > 0) {
        return NextResponse.json(lines.slice(0, 3));
      }
    }

    if (content.trim()) {
      return NextResponse.json([content]);
    }
    return NextResponse.json(getFallbackTips());
  } catch (error) {
    console.error("GET /api/ai/tips error:", error);
    // Hermes not available, return fallback tips
    return NextResponse.json(getFallbackTips());
  }
}

function getFallbackTips(): string[] {
  return [
    "小糖果最近睡眠时间比较规律，今天白天可以多安排一些地面自由活动哦～",
    "宝宝今天奶量不错！可以尝试添加一些新的辅食食材，观察宝宝的接受度。",
    "建议今天多和宝宝说话，有助于语言发展。可以读绘本给宝宝听。",
  ];
}
