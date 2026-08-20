import { prisma } from "@/lib/prisma";

const HERMES_URL = process.env.HERMES_API_URL ?? "http://localhost:8642";
const HERMES_MODEL = "hermes-agent";

function getAgeMonths(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  const months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  return Number.isNaN(months) ? 6 : Math.max(0, months);
}

export function getFallbackTips(): string[] {
  return [
    "宝宝最近睡眠时间比较规律，今天白天可以多安排一些地面自由活动哦～",
    "宝宝今天奶量不错！可以尝试添加一些新的辅食食材，观察宝宝的接受度。",
    "建议今天多和宝宝说话，有助于语言发展。可以读绘本给宝宝听。",
  ];
}

export async function getAiTips(): Promise<string[]> {
  try {
    const baby = await prisma.baby.findFirst();
    const ageMonths = baby ? getAgeMonths(baby.birthDate) : 6;
    const nickname = baby?.nickname ?? "宝宝";
    const genderWord = baby?.gender === "male" ? "男" : "女";

    const systemPrompt = `你是一个温暖的育儿助手，用中文回答。你叫"小助手"。
你是一个AI助手，所有建议仅供参考，如有问题请咨询专业医生。

请根据宝宝当前月龄，给出2-3条简短的育儿建议，涵盖以下方面：
1. 生长发育建议
2. 日常护理建议
3. 亲子互动建议

要求：
- 语气温暖亲切
- 每条建议1-2句话
- 适合${ageMonths}个月左右的${genderWord}宝宝
- 不要涉及医疗诊断
- 用中文回答
- 直接返回JSON数组，不要其他文字

示例格式：["建议1", "建议2", "建议3"]`;

    const res = await fetch(`${HERMES_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请给${ageMonths}个月${genderWord}宝宝${nickname}今天的育儿建议`,
          },
        ],
        max_tokens: 300,
        temperature: 0.8,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      console.error(`Hermes API error: ${res.status}`);
      return getFallbackTips();
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "";

    // Try to parse JSON array from the response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const tips = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tips) && tips.length > 0) {
        return tips.map(String).slice(0, 3);
      }
    }

    // If JSON parsing fails, split by newlines
    const lines = content
      .split("\n")
      .filter((l: string) => l.trim().length > 0 && !l.startsWith("#"));
    if (lines.length > 0) {
      return lines.slice(0, 3);
    }

    if (content.trim()) {
      return [content];
    }
    return getFallbackTips();
  } catch (error) {
    console.error("getAiTips error:", error);
    return getFallbackTips();
  }
}
