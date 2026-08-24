import { NextResponse } from "next/server";
import { requireAuth, requireBaby } from "@/lib/api-helpers";
import { AI_CONFIG } from "@/lib/config";
import { calculateAgeDetail } from "@/lib/age";
import { getLocalDateStr } from "@/lib/date";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";


export const dynamic = "force-dynamic";



const CONTEXT_ROLE_MAP: Record<string, string> = {
  food: "你是一位资深的婴幼儿辅食与营养顾问。擅长根据宝宝月龄提供科学的辅食引入、食材性状处理（防窒息/防噎）、辅食过敏排查与排便观察、营养搭配及挑食应对建议。",
  growth: "你是一位专业的儿保与生长发育专家。擅长结合 WHO 0-3岁儿童生长发育标准曲线，解读体重、身长、头围百分位（如 P3-P97），分析生长速率与追赶生长策略。",
  development: "你是一位婴幼儿早期发展与早教专家。擅长评估大运动、精细动作、语言、认知和社交里程碑，提供简单易行、高质量的家庭亲子互动与大运动早教指导。",
  vaccine: "你是一位儿童预防接种与儿科健康顾问。熟悉国家免疫规划（一类苗）与非免疫规划（二类自费苗，如13价肺炎、手足口EV71、水痘、轮状病毒等）接种程序，能清晰解答接种禁忌、接种后低烧/红肿护理以及生病推迟接种策略。",
  medical: "你是一位儿科化验单与体检档案智能辅助专家。擅长多模态识别分析血常规、微量元素、儿保体检、过敏原等单据，提取指标并给出温暖科学的儿科解读。",
  feeding: "你是一位婴儿喂养与日常护理顾问。擅长解答母乳与配方奶喂养、防吐奶溢奶手法、排气操拍嗝防胀气、每日奶量标准与夜奶管理。",
  sleep: "你是一位婴幼儿睡眠顾问。擅长解答清醒间隔把控、落地醒、接觉困难、抱睡奶睡改善、昼夜颠倒与月龄并觉期作息调整。",
  diaper: "你是一位婴儿排便与臀部护理专家。擅长辨别大便形态颜色（奶瓣、粘液、水便、绿便等可能原因）、排尿量判断以及红屁屁/尿布疹的温和清洁与护臀霜使用要点。",
  general: "你是一位温暖、科学、专业的全能智能育儿顾问。能够理解家长自然语言和拍照上传的单据，答疑解惑并提取结构化记录。",
};

const ACTION_PROTOCOL_PROMPT = `
【Agentic 智能结构化数据录入协议（Action Cards）】
当且仅当用户上传了化验单据图片、或者在对话中明确希望记录日常数据（化验单、喂养、睡眠、排便、生长测量）时，你必须在给出文字解答与分析之后，在回答末尾追加一个特制的标准 JSON 代码块（语言标识为 \`\`\`json:action ），以便前端为家长渲染“一键确认存入档案卡片”。

【格式规范要求（非常严格）】：
- 所有的 date 字段必须严格为标准 "YYYY-MM-DD" 格式（如 "2026-08-23"），禁止使用斜杠或中文年月日。
- 所有的 startTime / endTime 字段必须严格为 24小时制 "HH:mm" 格式（如 "14:30"），禁止附带秒或 AM/PM。
- 数值类型字段（如 amountMl, weightKg, heightCm）必须为纯数字，不要带单位字符串。

支持的 Action 类型及数据结构如下：

1. 化验单 / 体检报告单据 (medical_report)：
\`\`\`json:action
{
  "type": "medical_report",
  "data": {
    "title": "单据名称，如：末梢血常规化验单 / 6月龄儿保体检记录",
    "category": "blood | growth | trace_element | allergy | general",
    "date": "YYYY-MM-DD (严格标准格式)",
    "hospital": "医院/机构名称 (可选)",
    "aiSummary": "简明儿科解读总结",
    "growthData": { "weightKg": 8.2, "heightCm": 68.5, "headCircumferenceCm": 43.0 },
    "items": [
      {
        "name": "白细胞计数 (WBC)",
        "value": "6.8",
        "unit": "10^9/L",
        "referenceRange": "4.0-10.0",
        "status": "normal | high | low | abnormal"
      }
    ]
  }
}
\`\`\`

2. 喂养记录 (feeding)：
\`\`\`json:action
{
  "type": "feeding",
  "data": {
    "type": "breast | formula | bottle_breast | mixed",
    "amountMl": 150,
    "durationMinutes": 20,
    "notes": "备注说明，如：拍嗝顺畅",
    "timestamp": "YYYY-MM-DDTHH:mm:ss.000Z"
  }
}
\`\`\`

3. 睡眠记录 (sleep)：
\`\`\`json:action
{
  "type": "sleep",
  "data": {
    "startTime": "HH:mm (24小时制，如 14:00)",
    "endTime": "HH:mm (24小时制，如 15:30)",
    "type": "day | night",
    "notes": "入睡/醒来状态备注"
  }
}
\`\`\`

4. 排便记录 (diaper)：
\`\`\`json:action
{
  "type": "diaper",
  "data": {
    "type": "pee | poop | both",
    "poopColor": "yellow | green | brown | other",
    "poopConsistency": "soft | watery | hard | seedy",
    "notes": "形态备注",
    "timestamp": "YYYY-MM-DDTHH:mm:ss.000Z"
  }
}
\`\`\`

5. 生长测量 (growth)：
\`\`\`json:action
{
  "type": "growth",
  "data": {
    "weightKg": 8.2,
    "heightCm": 68.5,
    "headCircumferenceCm": 43.0,
    "date": "YYYY-MM-DD (严格标准格式)",
    "notes": "社区体检"
  }
}
\`\`\`

注意：如果是普通育儿咨询或闲聊，无需输出 \`\`\`json:action 代码块。
`;

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const ip = getClientIp(request);
    const rateLimit = checkRateLimit(`chat:${user.id || ip}`, 20, 60_000);
    if (!rateLimit.success) {
      return NextResponse.json(
        { error: `提问过于频繁，请 ${rateLimit.resetSeconds} 秒后再试` },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const { messages, contextType = "general", contextDetail, babyId, image } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "消息内容不能为空" }, { status: 400 });
    }

    if (messages.length > 50) {
      return NextResponse.json({ error: "消息历史记录过多，请开启新会话" }, { status: 400 });
    }

    let totalChars = 0;
    for (const m of messages) {
      if (typeof m.content === "string") {
        if (m.content.length > 8000) {
          return NextResponse.json({ error: "单条消息长度不能超过 8000 字符" }, { status: 400 });
        }
        totalChars += m.content.length;
      }
    }
    if (totalChars > 30000) {
      return NextResponse.json({ error: "消息总长度超出限制" }, { status: 400 });
    }

    // Require and verify baby ownership
    const babyResult = await requireBaby(user.id, babyId);
    if (babyResult.errorResponse) return babyResult.errorResponse;
    const targetBaby = babyResult.baby;

    const babyName = targetBaby.nickname || "宝宝";
    const gender = targetBaby.gender === "male" ? "男宝宝（小王子）" : "女宝宝（小公主）";
    const ageInfo = targetBaby.birthDate ? calculateAgeDetail(targetBaby.birthDate) : null;
    const gestationalAge = targetBaby.gestationalAge;
    const isPreterm = gestationalAge != null && gestationalAge < 37;

    const rolePrompt = CONTEXT_ROLE_MAP[contextType] || CONTEXT_ROLE_MAP.general;

    let babyContextPrompt = `【当前宝宝档案】\n- 昵称：${babyName}\n- 性别：${gender}`;
    if (ageInfo) {
      babyContextPrompt += `\n- 当前实际月龄：${ageInfo.label}（出生于 ${targetBaby.birthDate}）`;
    }
    if (isPreterm) {
      const corrMonths = Math.max(0, (ageInfo?.months || 0) - Math.round((40 - gestationalAge!) / 4.345));
      babyContextPrompt += `\n- 胎龄：${gestationalAge}周（早产），矫正月龄约 ${corrMonths} 个月，评估发育时请优先参考矫正月龄`;
    }
    if (contextDetail) {
      const sanitizedDetail = typeof contextDetail === "string" ? contextDetail.slice(0, 1000) : JSON.stringify(contextDetail).slice(0, 1000);
      babyContextPrompt += `\n- 当前页面背景与数据：${sanitizedDetail}`;
    }

    const todayDate = getLocalDateStr();
    const systemPrompt = `${rolePrompt}


${babyContextPrompt}
- 今天日期：${todayDate}

${ACTION_PROTOCOL_PROMPT}

【回答要求与原则】
1. 态度温暖亲切、条理清晰，多用通俗生动的比喻，避免晦涩难懂的医学术语。
2. 建议应紧密结合宝宝当前的具体月龄(${ageInfo?.label || "当前月龄"})，给出具体可实操的方法。
3. 采用 Markdown 格式排版，多用要点列表（- ），加粗重点，必要时分为「💡 核心结论」、「📋 实用操作/建议步骤」、「⚠️ 注意事项与就医警示」。
4. 若识别单据或记录，请在文字解读后附带 \`\`\`json:action 代码块。
5. 恪守安全底线：如涉及高危症状，务必提醒家长及时就医面诊。`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (AI_CONFIG.apiKey) {
      headers["Authorization"] = `Bearer ${AI_CONFIG.apiKey}`;
    }

    // Build payload messages, handling image if present in the latest message
    const formattedMessages = messages.slice(-8).map((m: any, idx: number, arr: any[]) => {
      const isLatestUser = idx === arr.length - 1 && m.role === "user";
      if (isLatestUser && (image || m.image)) {
        const imgUrl = image || m.image;
        // 仅允许 data:image base64 或 https 外链，防止内网 SSRF 与任意协议注入
        const safeImg = (() => {
          if (typeof imgUrl !== "string" || imgUrl.length > 16_000_000) return null;
          if (/^data:image\/(png|jpe?g|webp|heic|heif);base64,[A-Za-z0-9+/=]+$/.test(imgUrl)) {
            return imgUrl;
          }
          try {
            const u = new URL(imgUrl);
            // 仅允许无凭据的 https 外链，防内网 SSRF 与任意协议注入
            if (u.protocol === "https:" && !u.username && !u.password && u.hostname) {
              return imgUrl;
            }
          } catch {
            /* 非法 URL */
          }
          return null;
        })();
        if (safeImg) {
          return {
            role: "user",
            content: [
              { type: "text", text: String(m.content || "请帮我识别并解读这张图片/单据") },
              { type: "image_url", image_url: { url: safeImg } },
            ],
          };
        }
      }
      return {
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || ""),
      };
    });

    const payloadMessages = [
      { role: "system", content: systemPrompt },
      ...formattedMessages,
    ];

    // Call Hermes with stream: true
    const upstreamRes = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: payloadMessages,
        max_tokens: 2000,
        temperature: 0.5,
        stream: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120000),
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      const errText = await upstreamRes.text().catch(() => "");
      console.error(`AI Gateway error (${upstreamRes.status}):`, errText);
      const fallbackContent = `AI 助手服务暂时繁忙 (${upstreamRes.status})。针对 ${babyName} 当前月龄的疑问，建议先保持规律作息与观察；如有异常情况请及时就医。`;
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
