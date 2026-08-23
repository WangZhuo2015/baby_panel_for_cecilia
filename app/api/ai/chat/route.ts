import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthSession, getActiveBabyForUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const AI_BASE_URL = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "http://127.0.0.1:8642/v1";
const AI_API_KEY = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || process.env.OPENAI_MODEL || "hermes-agent";

function calculateAgeDetail(birthDateStr: string) {
  const birth = new Date(birthDateStr);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const birthDateInMonth = birth.getDate();
  const currentDateInMonth = now.getDate();
  let days = currentDateInMonth - birthDateInMonth;
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    days += prevMonth.getDate();
  }
  const totalDays = Math.floor((now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24));
  return {
    months: Math.max(0, months),
    days: Math.max(0, days),
    totalDays: Math.max(0, totalDays),
    label: `${Math.max(0, months)}个月${Math.max(0, days)}天 (第${Math.max(0, totalDays)}天)`,
  };
}

const CONTEXT_ROLE_MAP: Record<string, string> = {
  food: "你是一位资深的婴幼儿辅食与营养顾问。擅长根据宝宝月龄提供科学的辅食引入、食材性状处理（防窒息/防噎）、辅食过敏排查与排便观察、营养搭配及挑食应对建议。",
  growth: "你是一位专业的儿保与生长发育专家。擅长结合 WHO 0-3岁儿童生长发育标准曲线，解读体重、身长、头围百分位（如 P3-P97），分析生长速率与追赶生长策略。",
  development: "你是一位婴幼儿早期发展与早教专家。擅长评估大运动、精细动作、语言、认知和社交里程碑，提供简单易行、高质量的家庭亲子互动与大运动早教指导。",
  vaccine: "你是一位儿童预防接种与儿科健康顾问。熟悉国家免疫规划（一类苗）与非免疫规划（二类自费苗，如13价肺炎、手足口EV71、水痘、轮状病毒等）接种程序，能清晰解答接种禁忌、接种后低烧/红肿护理以及生病推迟接种策略。",
  medical: "你是一位儿科化验单与体检档案智能辅助顾问。能通俗易懂地解读血常规（白细胞、淋巴细胞、CRP）、微量元素、骨密度等指标意义，说明可能的原因与日常观察要点，并明确给出需要立即就医的红旗信号。",
  feeding: "你是一位婴儿喂养与日常护理顾问。擅长解答母乳与配方奶喂养、防吐奶溢奶手法、排气操拍嗝防胀气、每日奶量标准与夜奶管理。",
  sleep: "你是一位婴幼儿睡眠顾问。擅长解答清醒间隔把控、落地醒、接觉困难、抱睡奶睡改善、昼夜颠倒与月龄并觉期作息调整。",
  diaper: "你是一位婴儿排便与臀部护理专家。擅长辨别大便形态颜色（奶瓣、粘液、水便、绿便等可能原因）、排尿量判断以及红屁屁/尿布疹的温和清洁与护臀霜使用要点。",
  general: "你是一位温暖、科学、专业的全能育儿助手小助手。用通俗易懂、温暖且条理分明的语言为新手父母答疑解惑。",
};

export async function POST(request: Request) {
  try {
    const user = await getAuthSession(request);
    const body = await request.json();
    const { messages, contextType = "general", contextDetail, babyId } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    }

    // Get target baby info
    let targetBaby = null;
    if (babyId) {
      targetBaby = await prisma.baby.findUnique({ where: { id: babyId } });
    } else if (user) {
      const active = await getActiveBabyForUser(user.id);
      targetBaby = active?.baby;
    }
    if (!targetBaby) {
      targetBaby = await prisma.baby.findFirst();
    }

    const babyName = targetBaby?.nickname || "宝宝";
    const gender = targetBaby?.gender === "male" ? "男宝宝（小王子）" : "女宝宝（小公主）";
    const ageInfo = targetBaby?.birthDate ? calculateAgeDetail(targetBaby.birthDate) : null;
    const gestationalAge = targetBaby?.gestationalAge;
    const isPreterm = gestationalAge != null && gestationalAge < 37;

    const rolePrompt = CONTEXT_ROLE_MAP[contextType] || CONTEXT_ROLE_MAP.general;

    let babyContextPrompt = `【当前宝宝档案】\n- 昵称：${babyName}\n- 性别：${gender}`;
    if (ageInfo) {
      babyContextPrompt += `\n- 当前实际月龄：${ageInfo.label}（出生于 ${targetBaby?.birthDate}）`;
    }
    if (isPreterm) {
      const corrMonths = Math.max(0, (ageInfo?.months || 0) - Math.round((40 - gestationalAge!) / 4.345));
      babyContextPrompt += `\n- 胎龄：${gestationalAge}周（早产），矫正月龄约 ${corrMonths} 个月，评估发育时请优先参考矫正月龄`;
    }
    if (contextDetail) {
      babyContextPrompt += `\n- 当前页面背景与数据：${typeof contextDetail === "string" ? contextDetail : JSON.stringify(contextDetail)}`;
    }

    const systemPrompt = `${rolePrompt}

${babyContextPrompt}

【回答要求与原则】
1. 态度温暖亲切、条理清晰，多用通俗生动的比喻，避免晦涩难懂的医学术语。
2. 建议应紧密结合宝宝当前的具体月龄(${ageInfo?.label || "当前月龄"})，给出具体可实操的方法（如具体做法、步骤、注意事项）。
3. 采用 Markdown 格式排版，多用要点列表（- ）、加粗重点，必要时分为「💡 核心结论」、「📋 实用操作/建议步骤」、「⚠️ 注意事项与就医警示」。
4. 恪守安全底线：如涉及高危症状（如高烧超38.5度持续不退、精神萎靡、剧烈呕吐、呼吸急促、便血等），务必提醒家长及时就医面诊。
5. 纯文本回答，禁止包含 markdown 代码块包裹整个回答。`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AI_API_KEY) {
      headers["Authorization"] = `Bearer ${AI_API_KEY}`;
    }

    const payloadMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-6).map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content),
      })),
    ];

    // Call Hermes with stream: true and 120s generous timeout
    const upstreamRes = await fetch(`${AI_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: AI_MODEL,
        messages: payloadMessages,
        max_tokens: 1500,
        temperature: 0.7,
        stream: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120000),
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => "");
      console.error(`AI Gateway error (${upstreamRes.status}):`, errText);
      const fallbackContent = `AI 助手服务暂时繁忙 (${upstreamRes.status})。针对 ${babyName} 当前月龄的疑问，建议先保持规律作息与观察；如有发热或精神不佳等异常情况，请及时前往医院儿科就诊。`;
      return new Response(`data: ${JSON.stringify({ text: fallbackContent })}\n\ndata: [DONE]\n\n`, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Pipe upstream SSE stream to client
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstreamRes.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) continue;

              if (trimmed === "data: [DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }

              if (trimmed.startsWith("data: ")) {
                try {
                  const json = JSON.parse(trimmed.slice(6));
                  const deltaText = json.choices?.[0]?.delta?.content || "";
                  if (deltaText) {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ text: deltaText })}\n\n`)
                    );
                  }
                } catch {
                  // Partial JSON or unparseable SSE line, ignore
                }
              }
            }
          }
        } catch (err) {
          console.error("Error streaming from Hermes:", err);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ text: "\n\n(网络连接中断，请稍后重试)" })}\n\ndata: [DONE]\n\n`
            )
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("POST /api/ai/chat exception:", error);
    const errText = "网络连接暂时超时，请稍后重新提问。若宝宝身体有明显不适，请以专业医生诊断为准。";
    return new Response(`data: ${JSON.stringify({ text: errText })}\n\ndata: [DONE]\n\n`, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  }
}
