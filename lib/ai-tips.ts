import { prisma } from "@/lib/prisma";
import { calculateAge } from "@/lib/age";
import { AI_CONFIG } from "@/lib/config";

function getCuratedTips(ageMonths: number, nickname: string, _genderWord: string): string[] {
  if (ageMonths <= 1) {
    return [
      `${nickname}当前处于新生儿期，按需喂养为主，每次喂奶后记得竖抱轻拍嗝防止吐奶。`,
      `出生数天后记得每日按时补充 400IU 维生素D，肚脐部位保持清洁干爽。`,
      `清醒时可与宝宝进行眼神对视（距离约20-30厘米），轻柔说话促进安全感与视觉发育。`,
    ];
  }
  if (ageMonths <= 3) {
    return [
      `清醒时多引导${nickname}练习趴卧（Tummy Time），有助于锻炼颈部与背部肌肉力量。`,
      `${nickname}开始展现社交微笑并发出咿呀元音，多对视互动、学他发音给予热情回应。`,
      `建立规律的睡前仪式（如温水洗澡、轻柔抚触、轻缓摇篮曲），帮助建立昼夜节律。`,
    ];
  }
  if (ageMonths <= 5) {
    return [
      `${nickname}正在练习翻身与双手抱握，换尿布台及床边务必做好防跌落保护。`,
      `处于口欲期的宝宝喜欢探索物品，提供安全的牙胶玩具并注意定期清洁消毒。`,
      `多带宝宝照镜子或玩‘躲猫猫’（Peek-a-boo）互动游戏，培养空间感知与亲子情感。`,
    ];
  }
  if (ageMonths <= 8) {
    return [
      `满6个月后可逐步引入高铁米粉等第一道辅食，遵循‘由少到多、由稀到稠、单一到混合’原则。`,
      `开始练习稳稳独坐与双手倒物，可准备软质手指食物锻炼手眼协调与精细动作。`,
      `宝宝开始萌牙可能伴随流口水，可用干净柔软湿纱布轻柔清洁擦拭牙龈。`,
    ];
  }
  if (ageMonths <= 11) {
    return [
      `辅食质地可过渡到碎末与颗粒状，鼓励${nickname}用小手尝试自主抓食，享受进食乐趣。`,
      `宝宝进入爬行探索黄金期，地面环境做好安全防护，收起电线、尖锐物品与细小物件。`,
      `此阶段可能出现轻微分离焦虑，离开时温和告别并守时返回，给予宝宝充足信任感。`,
    ];
  }
  if (ageMonths <= 18) {
    return [
      `1岁后每日奶量保持约400-500ml，一日三餐与家庭日常饮食接轨，坚持低盐清淡。`,
      `多与${nickname}共读互动绘本，指认生活用品与动物名称，刺激语言表达潜能。`,
      `鼓励独立扶走与迈步探索，选择包跟防滑且鞋底前段易弯折的学步鞋。`,
    ];
  }
  return [
    `鼓励${nickname}用完整短句表达需求与情绪，耐心地倾听并给予正面引导。`,
    `每天保证至少1-2小时的户外活动与大肌肉运动，促进骨骼健康与体能发展。`,
    `引导宝宝自主尝试洗手、收拾玩具等日常小事，培养独立自信的生活好习惯。`,
  ];
}

export async function getAiTips(babyId?: string): Promise<string[]> {
  const baby = babyId
    ? await prisma.baby.findUnique({ where: { id: babyId } })
    : await prisma.baby.findFirst();

  if (!baby) {
    throw new Error("尚未创建宝宝档案，请先完善宝宝信息");
  }

  const ageMonths = calculateAge(baby.birthDate).months;
  const nickname = baby.nickname || "宝宝";
  const genderWord = baby.gender === "male" ? "男" : "女";

  // If no AI API key is configured, return professional curated pediatric tips directly
  if (!AI_CONFIG.apiKey) {
    return getCuratedTips(ageMonths, nickname, genderWord);
  }

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

  try {
    const res = await fetch(`${AI_CONFIG.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: AI_CONFIG.headers,
      body: JSON.stringify({
        model: AI_CONFIG.model,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `请给${ageMonths}个月${genderWord}宝宝${nickname}今天的育儿建议`,
          },
        ],
        max_tokens: 800,
        temperature: 0.7,
        ...AI_CONFIG.completionExtras,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`AI API returned status ${res.status}, falling back to curated tips.`);
      return getCuratedTips(ageMonths, nickname, genderWord);
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
        // Fallback to line split
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

    return getCuratedTips(ageMonths, nickname, genderWord);
  } catch (err) {
    console.warn("AI API call failed, using curated pediatric tips:", err);
    return getCuratedTips(ageMonths, nickname, genderWord);
  }
}
