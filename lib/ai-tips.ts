import { prisma } from "@/lib/prisma";

const AI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || "deepseek-chat";

function getAgeMonths(birthDate: string): number {
  const birth = new Date(birthDate);
  const now = new Date();
  const months =
    (now.getFullYear() - birth.getFullYear()) * 12 +
    (now.getMonth() - birth.getMonth());
  return Number.isNaN(months) ? 6 : Math.max(0, months);
}

export async function getAiTips(babyId?: string): Promise<string[]> {
  const baby = babyId
    ? await prisma.baby.findUnique({ where: { id: babyId } })
    : await prisma.baby.findFirst();

  if (!baby) {
    throw new Error("尚未创建宝宝档案，请先完善宝宝信息");
  }

  const ageMonths = getAgeMonths(baby.birthDate);
  const nickname = baby.nickname || "宝宝";
  const genderWord = baby.gender === "male" ? "男" : "女";

  const systemPrompt = `你是一个温暖、专业的育儿助手，用中文回答。你叫"小助手"。
你是一个AI助手，所有建议仅供参考，如有问题请咨询专业医生。

请根据宝宝当前月龄，给出2-3条简短实用的育儿建议，涵盖以下方面：
1. 生长发育建议
2. 日常护理建议
3. 亲子互动建议

要求：
- 语气温暖亲切
- 每条建议1-2句话
- 适合${ageMonths}个月左右的${genderWord}宝宝
- 不要涉及医疗诊断
- 用中文回答
- 直接返回严格的JSON字符串数组，如：["建议1", "建议2", "建议3"]`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (AI_API_KEY) {
    headers["Authorization"] = `Bearer ${AI_API_KEY}`;
  }

  const res = await fetch(`${AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `请给${ageMonths}个月${genderWord}宝宝${nickname}今天的育儿建议`,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI 服务响应异常 (${res.status}): ${errText.slice(0, 150) || res.statusText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";

  // Try parsing JSON array from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const tips = JSON.parse(jsonMatch[0]);
      if (Array.isArray(tips) && tips.length > 0) {
        return tips.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 3);
      }
    } catch {
      // Continue to line split
    }
  }

  // Fallback to line split if LLM didn't format as strict json
  const lines = content
    .split("\n")
    .map((l: string) => l.replace(/^[\d+.\-•*#\s]+/, "").trim())
    .filter((l: string) => l.length > 0);

  if (lines.length > 0) {
    return lines.slice(0, 3);
  }

  throw new Error("AI 返回了无法解析的建议内容");
}
